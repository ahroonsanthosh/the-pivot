// Run with: node --test sim/test
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../src/engine.js");
const C = require("../src/catalog.js");

const lib = E.makeLibrary(C.PARTS);
const scen = { ...C.DEFAULT_SCENARIO };
const sysOf = (patch) => E.derive({ ...C.DEFAULT_BUILD, ...patch }, lib, scen, C);
const threat = (id) => C.THREATS.find((t) => t.id === id);

test("catalogue: ids unique, categories known, ratings in range", () => {
  const ids = new Set();
  for (const p of C.PARTS) {
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`); ids.add(p.id);
    assert.ok(C.CATEGORIES[p.cat], `unknown category ${p.cat}`);
    if (p.rating != null) assert.ok(p.rating >= 0 && p.rating <= 10, `${p.id} rating`);
    for (const f of C.CATEGORIES[p.cat].fields) if (f.type === "num" && !(f.hide && f.hide(p))) assert.equal(typeof p[f.k], "number", `${p.id}.${f.k}`);
  }
  for (const b of C.EXAMPLE_BUILDS) for (const slot of ["camera", "lens", "compute", "controller"]) assert.ok(lib.byId[b[slot]], `${b.name} ${slot}`);
});

test("ballistics: closed forms are mutually consistent and match numeric integration", () => {
  const th = E.threatSI(threat("556"));
  assert.ok(th.lam > 500 && th.lam < 1500, `drag length ${th.lam}`);
  for (const s of [10, 100, 300]) {
    const t = E.tAtDist(s, th.v0, th.lam);
    assert.ok(Math.abs(E.distAtT(t, th.v0, th.lam) - s) < 1e-6);
  }
  let x = 0, v = th.v0, t = 0; const dt = 1e-5, k = (E.velAtDist(0, 1, th.lam) - E.velAtDist(1, 1, th.lam));
  while (x < 300) { const a = -(1.225 * th.cd * Math.PI * th.dM * th.dM / 4) * v * v / (2 * th.mKg); v += a * dt; x += v * dt; t += dt; }
  assert.ok(Math.abs(t - E.tAtDist(300, th.v0, th.lam)) < 2e-4, `numeric ${t} vs closed ${E.tAtDist(300, th.v0, th.lam)}`);
  assert.ok(k > 0);
  const rpg = E.threatSI(threat("rpg"));
  assert.equal(rpg.lam, Infinity);
  assert.equal(E.tAtDist(250, rpg.v0, rpg.lam), 1);
});

test("normal tail is accurate far out", () => {
  assert.ok(Math.abs(E.Q(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(E.Q(5) / 2.866515719e-7 - 1) < 1e-4);
  assert.ok(Math.abs(E.Phi(1) - 0.8413447461) < 1e-6);
});

test("coverage: four 100° pods cover the horizon; one pod covers about a third or less", () => {
  assert.ok(sysOf({ pods: 4 }).covGround > 0.99);
  const one = sysOf({ pods: 1 }).covGround;
  assert.ok(one > 0.2 && one < 0.32, `one pod ${one}`);
  const radar = sysOf({}).radGround;
  assert.ok(Math.abs(radar - 1 / 3) < 0.02, `radar ${radar}`);
});

test("more pods never reduce coverage", () => {
  let prev = 0;
  for (let n = 1; n <= 8; n++) { const c = sysOf({ pods: n, lens: "m12-40" }).covGround; assert.ok(c >= prev - 1e-9, `${n} pods`); prev = c; }
});

test("higher SNR threshold lowers false alarms and detection range", () => {
  const lo = sysOf({ k: 4, radars: 0 }), hi = sysOf({ k: 6, radars: 0 });
  assert.ok(hi.farH < lo.farH);
  assert.ok(E.camRange50(hi.cam, threat("556")) < E.camRange50(lo.cam, threat("556")));
});

test("narrower lens extends camera detection range", () => {
  const w = sysOf({ lens: "m12-100" }), n = sysOf({ lens: "m12-40" });
  assert.ok(E.camRange50(n.cam, threat("556")) > 2 * E.camRange50(w.cam, threat("556")));
});

test("night blinds visible cameras but not thermal", () => {
  const nightScen = { ...scen, env: "night" };
  const vis = E.derive({ ...C.DEFAULT_BUILD }, lib, nightScen, C);
  const ir = E.derive({ ...C.DEFAULT_BUILD, camera: "flir-boson-640", lens: "ge-50" }, lib, nightScen, C);
  assert.ok(E.camRange50(vis.cam, threat("rpg")) < 1);
  assert.ok(E.camRange50(ir.cam, threat("rpg")) > 20);
});

test("consumer FMCW radar loses range on bullets through range migration; ballistic radar does not", () => {
  const ti = sysOf({}).rad;
  const fast = E.radRange(ti, threat("556")), slow = E.radRange(ti, threat("556"), 5);
  assert.ok(fast < slow * 0.5, `fast ${fast} slow ${slow}`);
  const ariel = sysOf({ radar: "ariel-wband-2025" }).rad;
  assert.equal(E.radRange(ariel, threat("556")), E.radRange(ariel, threat("556"), 5));
});

test("bandwidth saturation throttles frame rate", () => {
  const s = sysOf({ camera: "daheng-mer2-160", pods: 6 });
  assert.ok(s.cam.throttle > 1.5);
  assert.ok(s.cam.fps < 227);
  assert.ok(s.issues.some((i) => /saturated/.test(i.msg)));
});

test("MIPI pods beyond the host's CSI ports are flagged and dropped", () => {
  const s = sysOf({ camera: "imx296-ancile", compute: "pi5", pods: 4 });
  assert.equal(s.cam.active, 2);
  assert.ok(s.issues.some((i) => /CSI ports/.test(i.msg)));
});

test("drive compatibility: stepper needs a step driver; GRBL needs an Uno", () => {
  assert.ok(sysOf({ aim: "nema17-pancake", driver: "direct" }).issues.some((i) => /step\/dir/.test(i.msg)));
  assert.ok(!sysOf({ aim: "nema17-pancake", driver: "tmc2209" }).issues.some((i) => i.level === "bad"));
  assert.ok(sysOf({ aim: "nema17-pancake", driver: "cnc-grbl", controller: "teensy41" }).issues.some((i) => /atmega328p/.test(i.msg)));
});

test("Monte Carlo is deterministic for a seed", () => {
  const s = sysOf({});
  const a = E.runThreat(s, threat("rpg"), scen, 300, 42), b = E.runThreat(s, threat("rpg"), scen, 300, 42);
  assert.deepEqual(a.counts, b.counts);
});

test("outcome counts add up and slow threats get warning", () => {
  const s = sysOf({});
  const r = E.runScenario(s, C.THREATS, scen, 300, 3);
  for (const p of r.per) assert.equal(Object.values(p.counts).reduce((a, b) => a + b, 0), 300);
  const rpg = r.per.find((p) => p.id === "rpg");
  assert.ok(rpg.pNeed > 0.9 && rpg.medWarn > 50);
});

test("heavier protective element deploys slower pneumatically", () => {
  const light = sysOf({ deploy: "pneumatic", shield: "ancile-kevlar-100" }).resp.deployMs;
  const heavy = sysOf({ deploy: "pneumatic", shield: "uhmwpe-iii-250x300" }).resp.deployMs;
  assert.ok(heavy > light * 2, `${light} vs ${heavy}`);
});

test("static shield protects without any cue when the path crosses it", () => {
  const s = sysOf({ shield: "uhmwpe-iii-250x300", radars: 0, pods: 0 });
  const r = E.runThreat(s, threat("762r"), { ...scen, bearing: "front" }, 400, 9);
  assert.ok(r.counts.protected > 0);
  assert.equal(r.counts.undetected + r.counts.uncovered, 0);
});
