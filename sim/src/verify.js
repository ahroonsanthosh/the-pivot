/* Wearable APS Sim: verification checks.
 *
 * Each check takes one finding from the team's desk research and tests it with targeted simulations: a fixed build,
 * a fixed scenario, a Monte Carlo per threat, and then a sweep of the parameters that are still estimates to see
 * whether the verdict holds or flips. Pure logic: runs in the page (window.APSVerify) and in Node.
 *
 * Verdicts:
 *   pass     the sim supports the part for the role it is tested in
 *   fail     the sim says it cannot do the job, and the estimates would have to be far off to change that
 *   depends  the verdict flips inside the uncertainty of estimated values, or the evidence is incomplete
 *   info     reference result to inform a choice, no verdict
 *   na       a part the check needs is missing from the library
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./engine.js"), require("./catalog.js"));
  else root.APSVerify = factory(root.APSEngine, root.APSCatalog);
})(typeof globalThis !== "undefined" ? globalThis : this, function (E, C) {
"use strict";

const VERDICTS = { pass: "Supported", fail: "Not supported", depends: "Depends on unknowns", info: "Reference", na: "Not run" };
const BASE = { ...C.DEFAULT_BUILD, camera: "none", pods: 0, radar: "none", radars: 0, aim: "none", aimAxes: 1, frame: "none", gearing: "none", deploy: "none", shield: "none", fusion: "or" };

/* ------------------------------------------------------------------ formatting */
const pct = (p) => (p == null || !Number.isFinite(p) ? "—" : Math.round(p * 100) + "%");
function ms(m) {
  if (m == null || !Number.isFinite(m)) return "—";
  if (m >= 10000) return (m / 1000).toFixed(1) + " s";
  if (m >= 1000) return (m / 1000).toFixed(2) + " s";
  if (m >= 10) return Math.round(m) + " ms";
  if (m >= 1) return m.toFixed(1) + " ms";
  return m.toFixed(2) + " ms";
}
const metres = (x) => (x == null || !Number.isFinite(x) ? "—" : x >= 100 ? Math.round(x) + " m" : x >= 10 ? x.toFixed(0) + " m" : x >= 1 ? x.toFixed(1) + " m" : x.toFixed(2) + " m");
const grams = (x) => (x >= 1000 ? (x / 1000).toFixed(2) + " kg" : Math.round(x) + " g");
const dB = (m) => (m == null ? "more than +139 dB" : `+${Math.round(40 * Math.log10(m))} dB`);

/* ------------------------------------------------------------------ helpers */
function context(opts = {}) {
  const parts = opts.parts || C.PARTS, threats = opts.threats || C.THREATS;
  const scen = { ...C.DEFAULT_SCENARIO, ...(opts.scen || {}) };
  return { parts, threats, lib: E.makeLibrary(parts), scen, req: { ...C.DEFAULT_REQ, ...(opts.req || {}) }, rounds: opts.rounds || 400 };
}
const libWith = (ctx, id, patch) => E.makeLibrary(ctx.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)));
const thr = (ctx, id) => ctx.threats.find((t) => t.id === id);
const has = (ctx, id) => !!ctx.lib.byId[id];
function sim(ctx, build, scenPatch, lib) {
  const scen = { ...ctx.scen, ...(scenPatch || {}) };
  return { sys: E.derive({ ...C.DEFAULT_BUILD, ...build }, lib || ctx.lib, scen, C), scen };
}
function run(ctx, build, threatOrId, scenPatch, opt = {}) {
  const { sys, scen } = sim(ctx, build, scenPatch, opt.lib);
  const th = typeof threatOrId === "string" ? thr(ctx, threatOrId) : threatOrId;
  return E.runThreat(sys, th, scen, opt.N || ctx.rounds, opt.seed || 11);
}
/* Smallest x in [lo, hi] where ok(x) is true, for ok increasing in x. Geometric steps for multipliers. */
function bisect(ok, lo, hi, geometric, iters = 13) {
  if (ok(lo)) return lo;
  if (!ok(hi)) return null;
  for (let i = 0; i < iters; i++) { const mid = geometric ? Math.sqrt(lo * hi) : (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
  return hi;
}
const intercept = (r) => ((r.counts.protected || 0) + (r.counts.stop || 0)) / r.N;   // in place in time and across the path
const exampleBuild = (pred) => { const b = C.EXAMPLE_BUILDS.find(pred); return b ? { ...b } : null; };
const ANCILE_BUILD = () => exampleBuild((b) => b.camera === "imx296-ancile");
function na(missing) { return { verdict: "na", headline: `Needs ${missing.join(", ")} in the library.`, table: null, findings: [], sens: [] }; }

/* ------------------------------------------------------------------ checks */
const CHECKS = [
  {
    id: "ti-radar", title: "TI IWR6843AOP as a threat cue", parts: ["ti-iwr6843aop"],
    question: "With the radar alone, facing the threat, how often does a cue arrive with at least the required warning? How much more sensitivity would small arms need?",
    method: "Radar-only build, one unit on the chest, threats from the front ±60°. Monte Carlo per threat, then a search for the sensitivity that would give a 5.56 mm round a timely cue in half of all rounds, with the point-cloud waveform and with a waveform that keeps coherent gain on fast targets.",
    run(ctx) {
      const id = "ti-iwr6843aop"; if (!has(ctx, id)) return na([id]);
      const P = ctx.lib.byId[id], b = { ...BASE, radar: id, radars: 1, fusion: "radar" }, sc = { bearing: "front" };
      const { sys } = sim(ctx, b, sc);
      const ids = ["9mm", "556", "762n", "127", "40mm", "fpv", "rpg"].filter((t) => thr(ctx, t)), res = {};
      const rows = ids.map((t) => {
        const th = thr(ctx, t), r = (res[t] = run(ctx, b, t, sc));
        return [th.name, metres(E.radRange(sys.rad, th)), metres(E.radRange(sys.rad, th, 5)), pct(r.pCue), pct(r.pNeed), ms(r.medWarn)];
      });
      const small = ids.filter((t) => thr(ctx, t).group === "small"), best = small.length ? Math.max(...small.map((t) => res[t].pNeed)) : 0;
      let mNom = null, mBal = null;
      if (thr(ctx, "556")) {
        const ok = (patch) => run(ctx, b, "556", sc, { lib: libWith(ctx, id, patch), N: 160 }).pNeed >= 0.5;
        mNom = bisect((m) => ok({ rRef: P.rRef * m }), 1, 3000, true);
        mBal = bisect((m) => ok({ rRef: P.rRef * m, ballistic: true }), 1, 3000, true);
      }
      const t556 = thr(ctx, "556"), units = Math.ceil(360 / (2 * P.fovAz));
      const slowTxt = ["fpv", "40mm"].filter((t) => res[t]).map((t) => `${thr(ctx, t).short} ${pct(res[t].pNeed)}`).join(", ");
      return {
        verdict: best < 0.1 ? "fail" : best < 0.5 ? "depends" : "pass",
        headline: `Small arms not supported: at best ${pct(best)} of rounds get ${ctx.scen.needMs} ms of warning. To cue a 5.56 mm round in half of shots the radar needs ${dB(mNom)} more link budget as configured, or ${dB(mBal)} with a ballistic waveform.${slowTxt ? ` Slower, larger targets: ${slowTxt}.` : ""}`,
        table: { head: ["Threat", "Detection range at speed", "Same target, slow", "Any cue", `Cue ≥ ${ctx.scen.needMs} ms`, "Median warning"], rows },
        findings: [
          t556 ? `The point-cloud waveform smears a ${t556.v0} m/s round across range bins: detection range on 5.56 mm falls from ${metres(E.radRange(sys.rad, t556, 5))} for a slow target of the same size to ${metres(E.radRange(sys.rad, t556))}.` : null,
          `One unit watches ${pct(sys.radGround)} of the ground band; ${units} units are needed round the body.`,
        ].filter(Boolean),
        sens: [
          "Range goes as the fourth root of RCS × sensitivity: a ×10 error in the estimated bullet RCS moves range by ×1.8 (10 dB). Neither the 10 m reference range nor the bullet RCS has been measured; a range-gated bench recording of a fired round would settle both.",
        ],
      };
    },
  },
  {
    id: "ariel-radar", title: "Ariel 2025 W-band radar run in real time", parts: ["ariel-wband-2025"],
    question: "If the demonstrated radar ran in real time on the wearer, would it cue in time, and how much of the surroundings does its beam watch?",
    method: "Radar-only build with rounds arriving inside the beam. Processing latency is swept because the paper processed recordings offline. The simulated detection range is compared with the paper, where data began only a few metres out.",
    run(ctx) {
      const id = "ariel-wband-2025"; if (!has(ctx, id)) return na([id]);
      const P = ctx.lib.byId[id], b = { ...BASE, radar: id, radars: 1, fusion: "radar" }, sc = { bearing: "boresight" };
      const { sys } = sim(ctx, b, sc);
      const inBeam = (t) => (thr(ctx, t) ? { ...thr(ctx, t), elMin: -1, elMax: 1 } : null);
      const shots = ["556", "9mm"].filter((t) => thr(ctx, t));
      const lat = [0.5, 3, 10, 30, 100];
      const at = {};
      const rows = lat.map((p) => {
        const lib = libWith(ctx, id, { procMs: p });
        const r = shots.map((t) => run(ctx, b, inBeam(t), sc, { lib, N: 300 }));
        at[p] = r;
        return [ms(p), ...r.flatMap((x) => [pct(x.pNeed), ms(x.medWarn)])];
      });
      const R556 = thr(ctx, "556") ? E.radRange(sys.rad, thr(ctx, "556")) : null;
      const consistent = R556 != null && R556 >= 1 && R556 <= 10;
      const beams = Math.ceil(360 / (2 * P.fovAz)) * Math.ceil(30 / (2 * P.fovEl));
      const sensLo = thr(ctx, "556") ? run(ctx, b, inBeam("556"), sc, { lib: libWith(ctx, id, { procMs: 3, rRef: P.rRef * 0.5 }), N: 300 }).pNeed : null;
      const sensHi = thr(ctx, "556") ? run(ctx, b, inBeam("556"), sc, { lib: libWith(ctx, id, { procMs: 3, rRef: P.rRef * 2 }), N: 300 }).pNeed : null;
      const p3 = at[3] && at[3][0] ? at[3][0].pNeed : null, p30 = at[30] && at[30][0] ? at[30][0].pNeed : null;
      return {
        verdict: "depends",
        headline: `Inside its beam a 5.56 mm round gets ${ctx.scen.needMs} ms of warning in ${pct(p3)} of shots with 3 ms processing and ${pct(p30)} with 30 ms. The beam watches ${pct(sys.radGround)} of the ground band, so about ${beams} beams would be needed to watch all of it.`,
        table: { head: ["Processing", ...shots.flatMap((t) => [`${thr(ctx, t).short}: cue ≥ ${ctx.scen.needMs} ms`, `${thr(ctx, t).short}: median`])], rows },
        findings: [
          `Simulated detection range on 5.56 mm: ${metres(R556)}. The paper's data began a few metres out, which is ${consistent ? "consistent" : "not consistent"} with the estimated 60 m reference range.`,
          "Whether it can run in real time is the open question: the paper recorded to an oscilloscope and processed afterwards. Below about 10 ms of processing the cue is useful; above 30 ms it mostly arrives after impact.",
        ],
        sens: [`Halving or doubling the estimated reference range moves the in-beam timely-cue rate for 5.56 mm from ${pct(sensLo)} to ${pct(sensHi)} at 3 ms processing.`],
      };
    },
  },
  {
    id: "spidr-tactical", title: "Syntonics SPiDR-Tactical: what its claims would buy", parts: ["syntonics-spidr-tactical"],
    question: "If the vendor's claims hold, how much warning does the helmet radar give for each threat, is it enough for any response in the library, and how far can the claims slip before it stops mattering?",
    method: "Radar-only build with the helmet unit, rounds from any bearing. Detection range is calibrated so a 5.56 mm round is seen at the claimed 10 m and scales with each threat's radar cross-section. Warnings are compared with the fastest response chain in the library and with human reaction time (250 ms). Then the claimed range and the unpublished latency are degraded.",
    run(ctx) {
      const id = "syntonics-spidr-tactical"; if (!has(ctx, id)) return na([id]);
      const P = ctx.lib.byId[id], b = { ...BASE, radar: id, radars: 1, fusion: "radar" }, sc = { bearing: "uniform" }, need = ctx.scen.needMs;
      const { sys } = sim(ctx, b, sc);
      const chain = { ...BASE, controller: has(ctx, "teensy41") ? "teensy41" : "host-gpio", driver: has(ctx, "tmc2209") ? "tmc2209" : "direct", aim: has(ctx, "nema17-pancake") ? "nema17-pancake" : "none",
        deploy: "pneumatic", pSource: has(ctx, "co2-12g") ? "co2-12g" : "ancile-compressor", pValve: "ancile-valve", pLine: "acrylic-hose", shield: has(ctx, "ancile-kevlar-100") ? "ancile-kevlar-100" : "none" };
      const R = sim(ctx, chain, {}).sys.resp;
      const deployOnly = R.drvMs + R.deployMs, slewDeploy = deployOnly + (R.aim ? R.aim.time(90) : 0);
      const share = (r, lim) => r.warns.filter((w) => w >= lim).length / r.N;
      const ids = ["9mm", "556", "762r", "762n", "127", "40mm", "fpv", "rpg"].filter((t) => thr(ctx, t)), res = {};
      const rows = ids.map((t) => {
        const th = thr(ctx, t), r = (res[t] = run(ctx, b, t, sc));
        return [th.name, metres(E.radRange(sys.rad, th)), ms(r.medWarn), pct(share(r, need)), pct(share(r, deployOnly)), pct(share(r, slewDeploy)), pct(share(r, 250))];
      });
      const deg = (patch) => run(ctx, b, "556", sc, { lib: libWith(ctx, id, patch), N: 300 });
      const has556 = !!res["556"];
      const r05 = has556 ? deg({ rRef: P.rRef * 0.5 }) : null, r03 = has556 ? deg({ rRef: P.rRef * 0.3 }) : null;
      const l5 = has556 ? deg({ procMs: 5 }) : null, l10 = has556 ? deg({ procMs: 10 }) : null, r2 = has556 ? deg({ rRef: P.rRef * 2 }) : null;
      const smallIds = ids.filter((t) => thr(ctx, t).group === "small");
      const smallSlew = smallIds.length ? Math.max(...smallIds.map((t) => share(res[t], slewDeploy))) : 0;
      const smallDeploy = smallIds.length ? Math.max(...smallIds.map((t) => share(res[t], deployOnly))) : 0;
      const air = E.coverageShare(sys.coverage, "rad", 20, 80);
      const s556 = res["556"], th556 = thr(ctx, "556");
      return {
        verdict: "depends",
        headline: `If the claims hold, it is the only wearable sensor in the library that cues rifle rounds from every direction: ${s556 ? `${pct(share(s556, need))} of 5.56 mm rounds get ${need} ms, with a median of ${ms(s556.medWarn)}` : "small-arms rounds are cued"}. That is a hostile-fire warning, not a trigger for protection: the fastest mechanism here needs ${ms(deployOnly)} just to deploy and ${ms(slewDeploy)} to slew 90° and deploy, which at most ${pct(Math.max(smallDeploy, smallSlew))} of small-arms rounds allow.${res.fpv ? ` It would cue protection against FPV drones (${pct(share(res.fpv, slewDeploy))} with time to slew and deploy)` : ""}${res["40mm"] ? ` and 40 mm grenades (${pct(share(res["40mm"], slewDeploy))})` : ""}. Every figure rests on vendor claims, and the part is ITAR-restricted.`,
        table: { head: ["Threat", "Detection range (claim-scaled)", "Median warning", `≥ ${need} ms`, `≥ ${ms(deployOnly)} (deploy only)`, `≥ ${ms(slewDeploy)} (slew + deploy)`, "≥ 250 ms (human)"], rows },
        findings: [
          `100 g on the helmet with its own battery, and the only radar here that watches all round from one unit (${pct(sys.radGround)} of the ground band, ${pct(air)} of the air band).`,
          th556 ? `Warning on rifle rounds is about the time a round takes to fly the last 10 m, roughly ${ms(10 / 0.85)} at 850 m/s, less processing. The claimed range to the shooter (up to 500 m) comes from back-tracking the round's path: useful for return fire and logging, not for protection.` : null,
          "The last public contract built a Mark 1 prototype (2016–2018), described as the first of three efforts toward a mature system. No later test results are published.",
        ].filter(Boolean),
        sens: has556 ? [
          `If detection range is half the claim, ${pct(share(r05, need))} of 5.56 mm rounds still get ${need} ms (median ${ms(r05.medWarn)}); at 30% of the claim, ${pct(share(r03, need))}.`,
          `Latency is not published (2 ms assumed). At 5 ms, ${pct(share(l5, need))} of 5.56 mm rounds get ${need} ms; at 10 ms, ${pct(share(l10, need))}.`,
          `Even at twice the claimed range, the median 5.56 mm warning is ${ms(r2.medWarn)} and ${pct(share(r2, deployOnly))} of rounds leave the ${ms(deployOnly)} a deploy-only mechanism needs.`,
        ] : [],
      };
    },
  },
  {
    id: "optics", title: "Daheng MER2-160 and XIMEA xiQ: detection and warning", parts: ["daheng-mer2-160", "xiq-mq003cg", "xiq-mq003mg"],
    question: "With enough pods for 360°, how far out does each camera detect each threat, and how often is the warning long enough?",
    method: "Camera-only build on the shoulders, Orin Nano Super 15 W, current environment and activity. Pods = 360° ÷ lens field of view. Monte Carlo per threat; 50% range is where one pod's per-frame detection chance reaches one half.",
    run(ctx) {
      const cams = ["daheng-mer2-160", "xiq-mq003cg", "xiq-mq003mg"].filter((c) => has(ctx, c)), lenses = ["m12-100", "m12-70", "m12-40"].filter((l) => has(ctx, l));
      const comp = has(ctx, "orin-nano-super-15") ? "orin-nano-super-15" : (ctx.lib.byCat.compute || [])[0] && ctx.lib.byCat.compute[0].id;
      if (!cams.length || !lenses.length || !comp) return na(["a camera, an M12 lens and a compute board"]);
      const thIds = ["9mm", "556", "40mm", "fpv"].filter((t) => thr(ctx, t)), rows = [], best = {};
      for (const c of cams) for (const l of lenses) {
        const pods = Math.min(12, Math.ceil(360 / ctx.lib.byId[l].hfov));
        const b = { ...BASE, camera: c, lens: l, pods, podMount: "shoulder", compute: comp, fusion: "cam" };
        const { sys } = sim(ctx, b, {});
        const r = Object.fromEntries(thIds.map((t) => [t, run(ctx, b, t, {}, { N: 300 })]));
        thIds.forEach((t) => { const k = `${t}|${c}`; best[k] = Math.max(best[k] || 0, r[t].pNeed); });
        const cam = ctx.lib.byId[c];
        rows.push([cam.name, `${ctx.lib.byId[l].hfov}°`, pods, `${Math.round(sys.cam.fps)} fps${sys.cam.throttle > 1.0001 ? " (throttled)" : ""}`,
          metres(thr(ctx, "556") ? E.camRange50(sys.cam, thr(ctx, "556")) : null), metres(thr(ctx, "fpv") ? E.camRange50(sys.cam, thr(ctx, "fpv")) : null),
          ...thIds.map((t) => pct(r[t].pNeed)), grams(pods * (cam.mass + ctx.lib.byId[l].mass + 20)), cam.status === "eol" ? "end-of-life" : cam.status || "—"]);
      }
      const bestOf = (t, cam) => Math.max(0, ...Object.entries(best).filter(([k]) => k.startsWith(t + "|") && (!cam || k.endsWith("|" + cam))).map(([, v]) => v));
      const rifleBest = bestOf("556"), pistolDah = bestOf("9mm", "daheng-mer2-160"), pistolXiq = Math.max(bestOf("9mm", "xiq-mq003cg"), bestOf("9mm", "xiq-mq003mg"));
      let sens = [];
      if (has(ctx, "daheng-mer2-160") && has(ctx, "m12-70") && thr(ctx, "9mm")) {
        const roiRow = (roi) => { const b = { ...BASE, camera: "daheng-mer2-160", lens: "m12-70", pods: 6, podMount: "shoulder", compute: comp, fusion: "cam", roi }; return [sim(ctx, b, {}).sys.cam, run(ctx, b, "9mm", {}, { N: 300 })]; };
        const [c50, r50] = roiRow(0.5), [c25, r25] = roiRow(0.25);
        sens.push(`Reading fewer sensor rows lifts the Daheng frame rate and cuts USB load: 6 pods at 70° with half the rows run at ${Math.round(c50.fps)} fps and warn ${pct(r50.pNeed)} of 9 mm rounds; with a quarter of the rows, ${Math.round(c25.fps)} fps and ${pct(r25.pNeed)}. The price is vertical coverage (${Math.round(c50.vfov)}° and ${Math.round(c25.vfov)}°).`);
      }
      if (has(ctx, "daheng-mer2-160") && has(ctx, "m12-70") && thr(ctx, "556")) {
        const b = { ...BASE, camera: "daheng-mer2-160", lens: "m12-70", pods: 6, podMount: "shoulder", compute: comp, fusion: "cam" };
        const n0 = ctx.lib.byId["daheng-mer2-160"].noise;
        const R = (k) => E.camRange50(sim(ctx, b, {}, libWith(ctx, "daheng-mer2-160", { noise: n0 * k })).sys.cam, thr(ctx, "556"));
        sens.push(`Camera noise is an estimate. Halving or doubling it moves the Daheng 70° 50% range on 5.56 mm from ${metres(R(2))} to ${metres(R(0.5))}; at 900 m/s that is ${ms((R(0.5) - R(2)) / 0.9)} of extra look time, which does not change the verdict.`);
      }
      const eol = cams.filter((c) => ctx.lib.byId[c].status === "eol").map((c) => ctx.lib.byId[c].name);
      return {
        verdict: rifleBest < 0.2 ? "fail" : "depends",
        headline: `Rifle rounds: not supported by either camera (best ${pct(rifleBest)} of 5.56 mm rounds warned ${ctx.scen.needMs} ms ahead). Pistol rounds: the xiQ warns up to ${pct(pistolXiq)} with narrower lenses, because 500 fps and low latency confirm the track in time; the Daheng manages ${pct(pistolDah)}, because USB throttling cuts its frame rate and adds latency. Both cue grenades and drones.${eol.length ? " The xiQ is end-of-life, so the procurable Daheng needs more USB bandwidth or a smaller ROI to match it." : ""}`,
        table: { head: ["Camera", "Lens", "Pods", "Frame rate", "50% range 5.56", "50% range FPV", ...thIds.map((t) => `${thr(ctx, t).short} warned`), "Pod mass", "Status"], rows },
        findings: [
          "Pixel angle sets the limit: a 5.56 mm round fills a whole pixel only within a few metres, where the round has a few milliseconds left to fly.",
          "Narrow lenses push detection farther out but need many pods. With 40° lenses the Daheng pods overrun the USB budget, so the frame rate drops and frames on target fall with it.",
        ],
        sens,
      };
    },
  },
  {
    id: "compute", title: "Jetson Orin NX 16GB against Orin Nano Super and others", parts: ["orin-nano-super-15", "orin-nano-super-25", "orin-nx-16-25", "orin-nx-16-40", "pi5", "kria-k26"],
    question: "How many pods can each board stream at the full sensor rate, and how much latency does it add?",
    method: "For each board and camera, add pods one at a time until bandwidth or pixel throughput forces the frame rate down. Latency is sensor-to-alert at four pods with a 70° lens.",
    run(ctx) {
      const comps = this.parts.filter((c) => has(ctx, c)), cams = ["daheng-mer2-160", "xiq-mq003mg"].filter((c) => has(ctx, c));
      if (!comps.length || !cams.length || !has(ctx, "m12-70")) return na(["compute boards, cameras and the 70° lens"]);
      const rows = [], maxBy = {};
      for (const c of comps) for (const cam of cams) {
        const mk = (n) => sim(ctx, { ...BASE, camera: cam, lens: "m12-70", pods: n, compute: c, fusion: "cam" }, {}).sys;
        let max = 0; for (let n = 1; n <= 12; n++) { if (mk(n).cam.throttle <= 1.0001) max = n; else break; }
        const s4 = mk(4), s8 = mk(8), cp = ctx.lib.byId[c];
        maxBy[`${c}|${cam}`] = max;
        rows.push([cp.name, ctx.lib.byId[cam].name, max, `${Math.round(s8.cam.fps)} fps`, ms(s4.cam.latS * 1000), s8.cam.bwLoad >= s8.cam.pixLoad ? "USB bandwidth" : "pixel throughput", grams(cp.mass + (cp.enclosure || 0)), `${cp.power} W`]);
      }
      const nanoD = maxBy["orin-nano-super-15|daheng-mer2-160"], nxD = maxBy["orin-nx-16-40|daheng-mer2-160"], nanoX = maxBy["orin-nano-super-15|xiq-mq003mg"], nxX = maxBy["orin-nx-16-40|xiq-mq003mg"];
      return {
        verdict: "info",
        headline: `${nanoD != null && nxD != null ? `With Daheng pods both Orins stop at ${nanoD === nxD ? nanoD : `${nanoD} and ${nxD}`} pods at full rate, because USB bandwidth runs out before compute does. ` : ""}${nanoX != null && nxX != null ? (nanoX === nxX ? `With xiQ pods every Orin carries ${nxX} at full rate, again limited by USB; the NX's advantage shows as lower latency and a lighter module.` : `With xiQ pods the Orin NX in MAXN Super carries ${nxX} against the Nano Super's ${nanoX}.`) : ""}`,
        table: { head: ["Compute", "Camera", "Pods at full rate", "Rate with 8 pods", "Sensor to alert (4 pods)", "Limit at 8 pods", "Mass with carrier/enclosure", "Power"], rows },
        findings: [
          "TOPS (67 for the Nano Super, 100 to 157 for the NX) measure neural-network throughput. This pipeline is classical frame differencing, so each board's pixel rate is an estimate; benchmark the real pipeline to replace it.",
          "The Orin NX is a 28 g module and needs a carrier board; carrier, cooling and connectors are estimated here at 90 to 110 g.",
        ],
        sens: ["USB bandwidth on a custom carrier depends on how many USB3 lanes it routes. Each extra 5 Gb/s lane adds one Daheng pod at full rate."],
      };
    },
  },
  {
    id: "controllers", title: "Teensy 4.1 against NXP S32K344 and Arduino Uno", parts: ["teensy41", "frdm-s32k344", "arduino-uno"],
    question: "Does the controller change whether the mechanism gets into place in time?",
    method: "Response-time budget for a 60° slew plus pneumatic deployment of the ANCILE sail, with each controller on two drive chains: direct step/dir (TMC2209) and ANCILE's CNC shield under GRBL.",
    run(ctx) {
      const ctrls = this.parts.filter((c) => has(ctx, c)), aim = has(ctx, "ancile-nema17") ? "ancile-nema17" : "nema17-pancake";
      const chains = [["Direct step/dir", "tmc2209"], ["GRBL on CNC shield", "cnc-grbl"]].filter(([, d]) => has(ctx, d));
      if (!ctrls.length || !chains.length || !has(ctx, aim)) return na(["controllers, drivers and a stepper"]);
      const rows = [], shares = [];
      for (const [chain, drv] of chains) for (const c of ctrls) {
        const b = { ...BASE, controller: c, driver: drv, aim, deploy: "pneumatic", shield: has(ctx, "ancile-kevlar-100") ? "ancile-kevlar-100" : "none" };
        const { sys } = sim(ctx, b, {});
        const bad = sys.issues.find((i) => i.level === "bad" && (i.slot === "driver" || i.slot === "aim"));
        if (bad) { rows.push([ctx.lib.byId[c].name, chain, "—", "—", "—", "—", "—", "not compatible"]); continue; }
        const ctrlMs = ctx.lib.byId[c].latMs, drvMs = sys.resp.drvMs, aimMs = sys.resp.aim.time(60), dep = sys.resp.deployMs, tot = ctrlMs + drvMs + aimMs + dep;
        shares.push([c, drv, ctrlMs / tot, (ctrlMs + drvMs) / tot]);
        rows.push([ctx.lib.byId[c].name, chain, ms(ctrlMs), ms(drvMs), ms(aimMs), ms(dep), ms(tot), pct(ctrlMs / tot)]);
      }
      const fast = shares.filter(([c, d]) => d === "tmc2209" && c !== "arduino-uno").map((x) => x[2]);
      const grbl = shares.find(([, d]) => d === "cnc-grbl");
      return {
        verdict: fast.length && Math.max(...fast) < 0.02 ? "pass" : "depends",
        headline: `The controller is not the bottleneck: Teensy and S32K344 latency is under ${pct(Math.max(0.01, ...fast))} of the response budget, which is dominated by the slew and the deployment. ${grbl ? `On the GRBL chain, controller and G-code layer together take ${pct(grbl[3])}.` : ""}`,
        table: { head: ["Controller", "Drive chain", "Controller", "Driver", "Slew 60°", "Deploy", "Total", "Controller share"], rows },
        findings: [
          "Choose between Teensy 4.1 and S32K344 on packaging, I/O and the safety case, not on timing. S32K3 support for ASIL D does not make the finished system ASIL D; that needs the whole development process.",
          "The FRDM-A-S32K344 is a development board; a product would put the MCU on its own PCB.",
        ],
        sens: ["Controller latencies are estimates (USB or serial link plus firmware). Even ×5 leaves direct-drive controllers under 10% of the budget."],
      };
    },
  },
  {
    id: "ancile-mass", title: "ANCILE mechanical assembly mass", parts: ["ancile-nema17", "ancile-gearing", "ancile-frame", "arduino-uno", "cnc-grbl"],
    question: "Do the itemised parts in the paper's bill of materials add up to the stated assembly mass, and does the library match them?",
    method: "Sum the documented items and compare with the stated 1.257 kg total and with the masses the library uses for the same parts.",
    run(ctx) {
      const BOM = [["2 × NEMA 17 motors", 440], ["6906-2RS bearing", 49], ["Base and central gear", 150], ["Turret body", 142], ["Lever mount", 44], ["Drive gear", 25], ["Arduino Uno, CNC shield, A4988 drivers", 75]];
      const stated = 1257, sum = BOM.reduce((a, [, g]) => a + g, 0);
      const m = (id) => (ctx.lib.byId[id] ? ctx.lib.byId[id].mass : 0);
      const libSum = 2 * m("ancile-nema17") + m("ancile-gearing") + m("ancile-frame") + m("arduino-uno") + m("cnc-grbl");
      const rows = BOM.map(([n, g]) => [n, grams(g)]).concat([["Sum of itemised parts", grams(sum)], ["Stated assembly total", grams(stated)], ["Not itemised", `${grams(stated - sum)} (${pct((stated - sum) / stated)})`], ["Same parts in the library", grams(libSum)]]);
      return {
        verdict: "depends",
        headline: `The itemised parts add up to ${grams(sum)}; the stated total is ${grams(stated)}, so ${grams(stated - sum)} (${pct((stated - sum) / stated)}) is not accounted for. The library's ANCILE parts total ${grams(libSum)}${Math.abs(libSum - sum) < 1 ? ", matching the itemised list" : ""}.`,
        table: { head: ["Item", "Mass"], rows },
        findings: [
          "The gap is likely fasteners, wiring, cameras, the launcher or pneumatic hardware. Weigh the assembly by subsystem before using it as a mass reference.",
          "These are documented ANCILE parts, not validated product components: the motors and the pneumatic parts have no model numbers.",
        ],
        sens: [],
      };
    },
  },
  {
    id: "ancile-speed", title: "ANCILE result reproduced in the sim", parts: ["imx296-ancile", "pi5", "arduino-uno", "cnc-grbl", "ancile-nema17", "ancile-frame", "ancile-gearing", "ancile-valve", "ancile-kevlar-100"],
    question: "Run the ANCILE-style build against foam darts. At what speed does the mechanism stop arriving in time, and does the overall rate match the paper?",
    method: "ANCILE example build (two IMX296 cameras at 140 fps, Pi 5, Uno + GRBL, pan and tilt steppers, pneumatic sail) with darts from straight ahead, launched 1.68 m away. Speed swept from 5 to 20 m/s. The sail is in place across the dart's path only if it deploys in time and the path crosses it.",
    run(ctx) {
      const b = ANCILE_BUILD(), dart = thr(ctx, "dart");
      const miss = this.parts.filter((p) => !has(ctx, p)); if (miss.length || !b || !dart) return na(miss.length ? miss : ["the foam-dart threat"]);
      const sc = { bearing: "bench", aimSpread: 0.3 }, speeds = [5, 7.5, 10, 12.5, 15, 17.5, 20];
      const at = (v, opt) => run(ctx, b, { ...dart, v0: v }, sc, { N: 300, ...(opt || {}) });
      const rs = speeds.map((v) => [v, at(v)]);
      const rows = rs.map(([v, r]) => [`${v} m/s`, ms(r.tofMs), pct(r.pReady), pct(intercept(r))]);
      const cross = (opt) => bisect((v) => at(v, opt).pReady < 0.5, 5, 30, false, 9);
      const vx = cross(), overall = rs.reduce((a, [, r]) => a + intercept(r), 0) / rs.length;
      const grbl = ctx.lib.byId["cnc-grbl"], valve = ctx.lib.byId["ancile-valve"];
      const vSlowCtl = cross({ lib: libWith(ctx, "cnc-grbl", { latMs: grbl.latMs * 3 }) }), vFastCtl = cross({ lib: libWith(ctx, "cnc-grbl", { latMs: grbl.latMs * 0.5 }) });
      const vSlowV = cross({ lib: libWith(ctx, "ancile-valve", { deadMs: 50 }) }), vFastV = cross({ lib: libWith(ctx, "ancile-valve", { deadMs: 8 }) });
      const ok = vx != null && vx >= 6 && vx <= 11, rateOk = Math.abs(overall - 0.286) <= 2 * 0.083;
      const extra = vx != null && vx > 11 ? bisect((d) => { const c = cross({ lib: libWith(ctx, "cnc-grbl", { latMs: grbl.latMs + d }) }); return c != null && c <= 8.75; }, 0, 400, false, 9) : null;
      return {
        verdict: ok && rateOk ? "pass" : "depends",
        headline: `The simulated mechanism stops arriving in time at about ${vx == null ? "over 30" : vx.toFixed(1)} m/s (paper: reliable up to 7.5 m/s). Averaged over 5–20 m/s the sail is across the dart's path in ${pct(overall)} of shots (paper: 28.6 ± 8.3%). ${ok && rateOk ? "The model reproduces the published result." : extra != null ? `The sim is more optimistic than the paper: about ${ms(extra)} of extra end-to-end delay brings its cut-off to the 7.5–10 m/s bracket. GRBL's planner queue (documented jog latency up to 0.5–1 s when full) or slower vision processing could account for it.` : "The model does not reproduce the published result; see the sensitivity notes."}`,
        table: { head: ["Dart speed", "Flight time", "Mechanism in time", "Sail across the path"], rows },
        findings: [
          "The paper gives neither reaction time nor detection range, so the comparison rests on the speed where success falls off and on the overall rate.",
          "Dart dispersion at the turret is not reported. This check assumes aim spread ×0.3 (about ±5 cm by ±11 cm); the overall rate scales with it, the cut-off speed does not.",
        ],
        sens: [
          `GRBL latency is estimated at ${ms(grbl.latMs)}. At ×0.5 the cut-off moves to ${vFastCtl == null ? ">30" : vFastCtl.toFixed(1)} m/s; at ×3 to ${vSlowCtl == null ? ">30" : vSlowCtl.toFixed(1)} m/s.`,
          `The valve is unidentified (estimated ${ms(valve.deadMs)}). At 8 ms the cut-off is ${vFastV == null ? ">30" : vFastV.toFixed(1)} m/s; at 50 ms it is ${vSlowV == null ? ">30" : vSlowV.toFixed(1)} m/s.`,
        ],
      };
    },
  },
  {
    id: "sail-coverage", title: "Kevlar sail 100 × 100 mm: how much of the body it covers", parts: ["ancile-kevlar-100"],
    question: "With perfect, instant pointing, what share of rounds aimed at the torso and head cross the sail, and what size would cover 90%?",
    method: "A fixed element 250 mm in front of the wearer, rounds from straight ahead aimed anywhere on the torso and head. Sizes are swept; mass follows the sail's areal density, and pneumatic deployment uses the ANCILE source, valve and line.",
    run(ctx) {
      const id = "ancile-kevlar-100"; if (!has(ctx, id)) return na([id]);
      const th = thr(ctx, "9mm") || ctx.threats[0], P = ctx.lib.byId[id], sc = { bearing: "bench", aimSpread: 1 };
      const cover = (w, h) => intercept(run(ctx, { ...BASE, shield: id, standoff: 0.25 }, th, sc, { lib: libWith(ctx, id, { w, h }), N: 600 }));
      const deploy = (w, h) => sim(ctx, { ...BASE, shield: id, standoff: 0.25, deploy: "pneumatic", pSource: "ancile-compressor", pValve: "ancile-valve", pLine: "acrylic-hose", bore: 16 }, sc, libWith(ctx, id, { w, h })).sys.resp.deployMs;
      const sizes = [[100, 100], [200, 200], [300, 400], [400, 600]];
      const rows = sizes.map(([w, h]) => [`${w} × ${h} mm`, grams((w / 1000) * (h / 1000) * P.areal * 1000), pct(cover(w, h)), ms(deploy(w, h))]);
      const k = bisect((k) => cover(300 * k, 400 * k) >= 0.9, 0.2, 3, false, 9);
      const w90 = k ? Math.round(300 * k / 10) * 10 : null, h90 = k ? Math.round(400 * k / 10) * 10 : null;
      const c100 = cover(100, 100);
      return {
        verdict: c100 < 0.5 ? "fail" : "depends",
        headline: `Even pointed perfectly and in place in time, a 100 × 100 mm sail is across ${pct(c100)} of torso- and head-aimed paths. ${k ? `Covering 90% takes about ${w90} × ${h90} mm, which weighs ${grams((w90 / 1000) * (h90 / 1000) * P.areal * 1000)} at the sail's areal density and slows pneumatic deployment to ${ms(deploy(w90, h90))}.` : "No size up to 900 × 1200 mm reaches 90%."}`,
        table: { head: ["Element", `Mass at ${P.areal} kg/m²`, "Path crosses it", "Pneumatic deploy, 250 mm"], rows },
        findings: [
          "The sail stopped .22 LR to .357 Magnum on a pendulum. That is a material result; whole-system protection was not demonstrated.",
          "A bullet cue gives a bearing, not the impact point, so the element must cover the whole region the round could hit.",
        ],
        sens: [(() => { const c05 = intercept(run(ctx, { ...BASE, shield: id, standoff: 0.25 }, th, { ...sc, aimSpread: 0.5 }, { N: 600 })); return `The aim-point spread is the main assumption. With fire concentrated on the chest (aim spread ×0.5) the 100 × 100 mm share is ${pct(c05)} instead of ${pct(c100)}.`; })()],
      };
    },
  },
  {
    id: "armour-baseline", title: "Certified armour as the baseline", parts: ["aramid-iiia-300x400", "uhmwpe-iii-250x300"],
    question: "How does simply wearing a certified-class panel or plate compare with the active builds, threat by threat?",
    method: "Front-quarter threats (±60°). Worn panels sit 50 mm off the chest with no electronics. Active builds use the library examples. Each cell is the share of rounds stopped.",
    run(ctx) {
      const miss = this.parts.filter((p) => !has(ctx, p)); if (miss.length) return na(miss);
      const sc = { bearing: "front" }, thIds = ["9mm", "556", "762r", "127", "40mm", "fpv"].filter((t) => thr(ctx, t));
      const bare = { ...BASE, compute: "none", controller: "none", driver: "none", battWh: 0, standoff: 0.05 };
      const builds = [["Worn IIIA-class panel", { ...bare, shield: "aramid-iiia-300x400" }], ["Worn III-class plate", { ...bare, shield: "uhmwpe-iii-250x300" }]];
      C.EXAMPLE_BUILDS.filter((b) => b.shield && b.shield !== "none").forEach((b) => builds.push([b.name.replace("Example · ", "") + " (active)", { ...b }]));
      const res = builds.map(([name, b]) => {
        const { sys } = sim(ctx, b, sc);
        const r = thIds.map((t) => run(ctx, b, t, sc, { N: 300 }).pProt);
        return [name, r, sys];
      });
      const rows = res.map(([name, r, sys]) => [name, ...r.map(pct), grams(sys.added * 1000), `${sys.power.toFixed(1)} W`]);
      const plate = res[1][1], bestActive = res.slice(2).map(([, r]) => r);
      const i762 = thIds.indexOf("762r");
      const bestA = bestActive.length && i762 >= 0 ? Math.max(...bestActive.map((r) => r[i762])) : null;
      return {
        verdict: "info",
        headline: i762 >= 0 ? `A worn III-class plate stops ${pct(plate[i762])} of front-quarter 7.62×39 mm rounds with no power or electronics; the best active build here stops ${pct(bestA)}.` : "Worn armour compared with the active builds.",
        table: { head: ["Build", ...thIds.map((t) => thr(ctx, t).short), "Added mass", "Power"], rows },
        findings: [
          "No armour model is selected yet. Pick one from the NIJ compliant products list (0101.06 or 0101.07) and replace the generic areal density and size.",
          "Levels here are coarse: every III-class plate is treated as stopping every listed rifle round, but some III plates do not stop 5.56 mm M855.",
        ],
        sens: [],
      };
    },
  },
  {
    id: "pneumatics", title: "Unidentified ANCILE compressor, valve and hose", parts: ["ancile-compressor", "ancile-valve", "acrylic-hose"],
    question: "Across plausible values for the undisclosed valve, line and pressure, how long does deployment take, and which threats leave that much time?",
    method: "Deployment time of the ANCILE sail over 250 mm with a 16 mm bore, sweeping valve opening delay and delivered pressure. Compared with flight times of representative shots.",
    run(ctx) {
      const miss = this.parts.filter((p) => !has(ctx, p)).concat(has(ctx, "ancile-kevlar-100") ? [] : ["ancile-kevlar-100"]); if (miss.length) return na(miss);
      const valves = [5, 20, 50], bars = [2, 4, 6.9], line = ctx.lib.byId["acrylic-hose"].deadMs;
      const dep = (v, p, l) => {
        const lib = E.makeLibrary(ctx.parts.map((x) => (x.id === "ancile-valve" ? { ...x, deadMs: v } : x.id === "ancile-compressor" ? { ...x, bar: p } : x.id === "acrylic-hose" ? { ...x, deadMs: l } : x)));
        return sim(ctx, { ...BASE, shield: "ancile-kevlar-100", standoff: 0.25, deploy: "pneumatic", pSource: "ancile-compressor", pValve: "ancile-valve", pLine: "acrylic-hose", bore: 16 }, {}, lib).sys.resp.deployMs;
      };
      const rows = valves.map((v) => [`${v} ms valve`, ...bars.map((p) => ms(dep(v, p, line)))]);
      const all = valves.flatMap((v) => bars.map((p) => dep(v, p, line))), lo = Math.min(...all), hi = Math.max(...all, dep(50, 2, 10));
      const tof = (id, r, v) => { const t = thr(ctx, id); if (!t) return null; const s = E.threatSI(v ? { ...t, v0: v } : t); return E.tAtDist(r, s.v0, s.lam) * 1000; };
      const cam = ["xiq-mq003mg", "xiq-mq003cg", "daheng-mer2-160"].find((c) => has(ctx, c));
      const pistolWarn = cam && has(ctx, "m12-70") && thr(ctx, "9mm") ? run(ctx, { ...BASE, camera: cam, lens: "m12-70", pods: 6, podMount: "shoulder", fusion: "cam" }, "9mm", {}, { N: 300 }).medWarn : null;
      const flights = [["Foam dart, 7.5 m/s, 1.68 m", tof("dart", 1.68, 7.5)], ["Foam dart, 15 m/s, 1.68 m", tof("dart", 1.68, 15)], ["9 mm at 15 m", tof("9mm", 15)], ["40 mm grenade at 150 m", tof("40mm", 150)], ["FPV drone at 100 m", tof("fpv", 100)]].filter(([, t]) => t != null);
      return {
        verdict: "depends",
        headline: `Deployment takes ${ms(lo)} to ${ms(hi)} across plausible valve delays (5–50 ms), pressures (2–6.9 bar) and line delays. That spread decides whether a 15 m/s dart can be met. It cannot rescue small arms: ${pistolWarn != null ? `even the best-cued pistol rounds (500 fps camera, 70° lens) leave a median ${ms(pistolWarn)} of warning, and rifle rounds none` : "they leave no usable cue to start from"}.`,
        table: { head: ["Valve delay", ...bars.map((b) => `${b} bar`)], rows },
        findings: [`Flight times for scale: ${flights.map(([n, t]) => `${n.toLowerCase()} ${ms(t)}`).join("; ")}.`, "None of the three parts is identified, so every deployment number for the original pneumatics is a bracket, not a value. Identify the valve first: its opening time is the largest unknown."],
        sens: [`A 10 ms line (longer or narrower hose) adds ${ms(dep(20, 6.9, 10) - dep(20, 6.9, line))} at 20 ms and 6.9 bar.`],
      };
    },
  },
];

function runCheck(check, ctx) {
  const t0 = Date.now();
  let r;
  try { r = check.run.call(check, ctx); }
  catch (e) { r = { verdict: "na", headline: `The check failed to run: ${e.message}`, table: null, findings: [], sens: [] }; }
  return { id: check.id, title: check.title, parts: check.parts, question: check.question, method: check.method, ...r, ms: Date.now() - t0 };
}
function runAll(opts) { const ctx = context(opts); return CHECKS.map((c) => runCheck(c, ctx)); }

/* Markdown report for the repository. */
function report(results, ctx, meta = {}) {
  const lib = ctx.lib, md = [];
  const esc = (s) => String(s == null ? "" : s).replace(/\|/g, "\\|");
  md.push("# Verification report", "");
  md.push(`Generated by \`node sim/tools/verify.js\`${meta.date ? ` on ${meta.date}` : ""}. Engine ${E.VERSION}, ${ctx.rounds} rounds per threat per case. Conditions: ${C.ENVIRONMENTS.find((e) => e.id === ctx.scen.env).name.toLowerCase()}, ${C.ACTIVITIES.find((a) => a.id === ctx.scen.activity).name.toLowerCase()}, warning needed ${ctx.scen.needMs} ms.`, "");
  md.push("Each check takes a finding from the team's component fact-check and tests the part in the role it would play, then varies the values that are still estimates to see whether the verdict holds.", "");
  md.push("| Check | Parts | Desk finding | Sim verdict |", "|---|---|---|---|");
  results.forEach((r) => {
    const parts = r.parts.filter((p) => lib.byId[p]).map((p) => lib.byId[p].name);
    const st = [...new Set(r.parts.filter((p) => lib.byId[p]).map((p) => (C.STATUS.find(([k]) => k === lib.byId[p].status) || [, "Not yet verified"])[1]))].join("; ");
    md.push(`| [${esc(r.title)}](#${r.id}) | ${esc(parts.join(", "))} | ${esc(st)} | **${VERDICTS[r.verdict]}** |`);
  });
  md.push("");
  results.forEach((r) => {
    md.push(`## ${r.title}`, `<a id="${r.id}"></a>`, "", `**Verdict: ${VERDICTS[r.verdict]}.** ${r.headline}`, "");
    const desk = r.parts.filter((p) => lib.byId[p] && lib.byId[p].statusNote).map((p) => `- ${lib.byId[p].name}: ${lib.byId[p].statusNote}`);
    if (desk.length) md.push("Desk findings:", "", ...desk, "");
    md.push(`*Question.* ${r.question}`, "", `*Method.* ${r.method}`, "");
    if (r.table) {
      md.push(`| ${r.table.head.map(esc).join(" | ")} |`, `|${r.table.head.map(() => "---").join("|")}|`);
      r.table.rows.forEach((row) => md.push(`| ${row.map(esc).join(" | ")} |`));
      md.push("");
    }
    if (r.findings && r.findings.length) md.push("What the sim shows:", "", ...r.findings.map((f) => `- ${f}`), "");
    if (r.sens && r.sens.length) md.push("What would change the verdict:", "", ...r.sens.map((f) => `- ${f}`), "");
  });
  md.push("Planning tool only: every verdict is the upper bound a simple optical, radar and mechanical model allows. Use it to choose bench tests, not to replace them.");
  return md.join("\n");
}

return { VERDICTS, CHECKS, context, runCheck, runAll, report };
});
