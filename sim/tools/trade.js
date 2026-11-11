#!/usr/bin/env node
/* Headless trade study: sweep library slots and print one CSV row per build.
 *
 *   node sim/tools/trade.js --sweep camera=* --sweep lens=m12-100,m12-70,m12-40 --sweep compute=* --rounds 500 > trade.csv
 *
 * Options
 *   --sweep slot=a,b,c    values for a build slot; "*" means every library part that fits the slot
 *   --set slot=value      fix a slot for every build (applied to the default build first)
 *   --scenario key=value  scenario overrides: env, activity, bearing, needMs, threat.<id>=<weight>
 *   --req key=value       requirement overrides: maxMass, maxHead, minRuntime, maxCost, maxFar, minRating
 *   --library file.json   merge parts/threats exported from the page (Copy changes / Copy full library)
 *   --min-rating n        skip rated parts below n when expanding "*"
 *   --rounds n            rounds per threat (default 400)
 *   --limit n             stop after n builds (default 5000)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const E = require(path.join(__dirname, "../src/engine.js"));
const C = require(path.join(__dirname, "../src/catalog.js"));

const args = process.argv.slice(2);
const opt = { sweep: [], set: [], scenario: [], req: [], rounds: 400, limit: 5000, minRating: 0, library: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i], v = args[i + 1];
  if (a === "--sweep") { opt.sweep.push(v); i++; }
  else if (a === "--set") { opt.set.push(v); i++; }
  else if (a === "--scenario") { opt.scenario.push(v); i++; }
  else if (a === "--req") { opt.req.push(v); i++; }
  else if (a === "--rounds") { opt.rounds = +v; i++; }
  else if (a === "--limit") { opt.limit = +v; i++; }
  else if (a === "--min-rating") { opt.minRating = +v; i++; }
  else if (a === "--library") { opt.library = v; i++; }
  else if (a === "-h" || a === "--help") { console.log(fs.readFileSync(__filename, "utf8").split("*/")[0]); process.exit(0); }
  else { console.error(`Unknown option ${a}. Use --help.`); process.exit(2); }
}

let parts = C.PARTS.slice(), threats = C.THREATS.slice();
if (opt.library) {
  const data = JSON.parse(fs.readFileSync(opt.library, "utf8"));
  const byId = new Map(parts.map((p) => [p.id, p]));
  for (const p of data.parts || []) if (p.id && p.cat) byId.set(p.id, { ...(byId.get(p.id) || {}), ...p });
  for (const id of data.deleted || []) byId.delete(id);
  parts = [...byId.values()];
  const tById = new Map(threats.map((t) => [t.id, t]));
  for (const t of data.threats || []) if (t.id) tById.set(t.id, { ...(tById.get(t.id) || {}), ...t });
  for (const id of data.threatsDeleted || []) tById.delete(id);
  threats = [...tById.values()];
}
const lib = E.makeLibrary(parts);
const num = (s) => (s !== "" && !isNaN(+s) ? +s : s);
const kv = (s) => { const i = s.indexOf("="); if (i < 0) throw new Error(`Expected key=value, got "${s}"`); return [s.slice(0, i), s.slice(i + 1)]; };

const base = { ...C.DEFAULT_BUILD };
for (const s of opt.set) { const [k, v] = kv(s); base[k] = num(v); }
const scen = JSON.parse(JSON.stringify(C.DEFAULT_SCENARIO));
for (const s of opt.scenario) { const [k, v] = kv(s); if (k.startsWith("threat.")) scen.threats[k.slice(7)] = +v; else scen[k] = num(v); }
const req = { ...C.DEFAULT_REQ };
for (const s of opt.req) { const [k, v] = kv(s); req[k] = +v; }

const SLOT_CAT = { camera: "camera", lens: "lens", radar: "radar", compute: "compute", controller: "controller", driver: "driver", aim: "actuator", deploy: "actuator", frame: "structure", gearing: "structure", shield: "shield", pSource: "pneumatic", pValve: "pneumatic", pLine: "pneumatic" };
const fits = (slot, p) => (slot === "aim" ? p.kind !== "linear" : slot === "frame" ? p.role === "frame" : slot === "gearing" ? p.role === "gearing" : slot === "pSource" ? p.role === "source" : slot === "pValve" ? p.role === "valve" : slot === "pLine" ? p.role === "line" : true);
const sweeps = opt.sweep.map((s) => {
  const [k, v] = kv(s);
  let vals;
  if (v === "*") {
    if (!SLOT_CAT[k]) throw new Error(`"*" only works for part slots, not ${k}`);
    vals = (lib.byCat[SLOT_CAT[k]] || []).filter((p) => fits(k, p) && (p.rating == null || p.rating >= opt.minRating)).map((p) => p.id);
  } else vals = v.split(",").map(num);
  return [k, vals];
});

const cols = ["build", ...sweeps.map(([k]) => k), "goal", "warned_in_time", "mechanism_in_time", "protected", ...threats.filter((t) => (scen.threats[t.id] ?? 1) > 0).map((t) => "goal_" + t.id),
  "mass_kg", "head_kg", "power_w", "runtime_h", "cost_eur", "weakest_rating", "false_alerts_per_h", "feasible", "issues"];
const q = (v) => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
console.log(cols.join(","));

let n = 0, skipped = 0;
const t0 = Date.now();
(function rec(i, acc) {
  if (n >= opt.limit) return;
  if (i === sweeps.length) {
    const b = { ...base, ...acc };
    const cam = lib.byId[b.camera], lens = lib.byId[b.lens];
    if (cam && lens && (lens.band === "lwir") !== (cam.band === "lwir")) { skipped++; return; }
    if (b.radar === "none") b.radars = 0; else if (!(b.radars >= 1)) b.radars = 1;
    const sys = E.derive(b, lib, scen, C), ev = E.evaluate(sys, req), perf = E.runScenario(sys, threats, scen, opt.rounds, 1);
    n++;
    console.log([n, ...sweeps.map(([k]) => b[k]), perf.goal.toFixed(4), perf.need.toFixed(4), perf.ready.toFixed(4), perf.prot.toFixed(4), ...perf.per.map((r) => r.pGoal.toFixed(4)),
      sys.added.toFixed(3), sys.headMass.toFixed(3), sys.power.toFixed(2), sys.runtimeH.toFixed(2), Math.round(sys.cost), sys.readiness.min ?? "", sys.farH.toPrecision(3),
      ev.feasible ? "yes" : "no", sys.issues.concat(ev.violations).map((x) => x.msg).join(" | ")].map(q).join(","));
    return;
  }
  const [k, vals] = sweeps[i];
  for (const v of vals) { acc[k] = v; rec(i + 1, acc); }
})(0, {});
console.error(`${n} builds in ${((Date.now() - t0) / 1000).toFixed(1)} s${skipped ? `, ${skipped} skipped (lens and camera wavebands differ)` : ""}.`);
