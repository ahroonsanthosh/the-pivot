#!/usr/bin/env node
/* Run every verification check and write a Markdown report.
 *
 *   node sim/tools/verify.js                       print the report
 *   node sim/tools/verify.js --out sim/VERIFICATION.md
 *
 * Options
 *   --rounds n          rounds per threat per case (default 400)
 *   --library file.json merge parts/threats exported from the page
 *   --scenario k=v      env, activity, needMs
 *   --json              print raw results as JSON instead of Markdown
 *   --out file          write to a file instead of stdout
 */
"use strict";
const fs = require("fs");
const path = require("path");
const V = require(path.join(__dirname, "../src/verify.js"));
const C = require(path.join(__dirname, "../src/catalog.js"));

const args = process.argv.slice(2), opt = { rounds: 400, scen: {}, json: false, out: null, library: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i], v = args[i + 1];
  if (a === "--rounds") { opt.rounds = +v; i++; }
  else if (a === "--library") { opt.library = v; i++; }
  else if (a === "--scenario") { const [k, x] = v.split("="); opt.scen[k] = isNaN(+x) ? x : +x; i++; }
  else if (a === "--json") opt.json = true;
  else if (a === "--out") { opt.out = v; i++; }
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
  threats = [...tById.values()];
}
const ctx = V.context({ parts, threats, scen: opt.scen, rounds: opt.rounds });
const t0 = Date.now();
const results = V.CHECKS.map((c) => V.runCheck(c, ctx));
const text = opt.json ? JSON.stringify(results, null, 2) : V.report(results, ctx, { date: new Date().toISOString().slice(0, 10) });
if (opt.out) fs.writeFileSync(opt.out, text + "\n"); else console.log(text);
console.error(`${results.length} checks in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${results.map((r) => `${r.id} ${r.verdict}`).join(", ")}`);
