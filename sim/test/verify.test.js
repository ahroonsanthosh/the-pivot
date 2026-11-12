// Run with: node --test sim/test/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../src/verify.js");
const C = require("../src/catalog.js");

const results = V.runAll({ rounds: 150 });
const byId = Object.fromEntries(results.map((r) => [r.id, r]));

test("every check runs and returns a known verdict with a headline", () => {
  assert.equal(results.length, V.CHECKS.length);
  for (const r of results) {
    assert.ok(Object.keys(V.VERDICTS).includes(r.verdict), `${r.id}: ${r.verdict}`);
    assert.notEqual(r.verdict, "na", `${r.id} did not run: ${r.headline}`);
    assert.ok(r.headline && r.headline.length > 20, r.id);
    if (r.table) for (const row of r.table.rows) assert.equal(row.length, r.table.head.length, `${r.id} row width`);
  }
});

test("every part a check names is in the catalogue", () => {
  const ids = new Set(C.PARTS.map((p) => p.id));
  for (const c of V.CHECKS) for (const p of c.parts) assert.ok(ids.has(p), `${c.id} names unknown part ${p}`);
});

test("TI radar is not supported for small arms", () => {
  assert.equal(byId["ti-radar"].verdict, "fail");
});

test("ANCILE itemised bill of materials sums to 925 g and the library matches it", () => {
  const r = byId["ancile-mass"];
  assert.match(r.headline, /925 g/);
  assert.match(r.headline, /matching the itemised list/);
});

test("a 100 x 100 mm sail covers a small share of torso and head aim points", () => {
  assert.equal(byId["sail-coverage"].verdict, "fail");
});

test("end-of-life parts are flagged and off the shortlist", () => {
  for (const p of C.PARTS.filter((x) => x.status === "eol")) assert.ok(!p.shortlist, p.id);
});

test("report renders a summary row per check", () => {
  const md = V.report(results, V.context({ rounds: 150 }));
  for (const c of V.CHECKS) assert.ok(md.includes(`](#${c.id})`), c.id);
});

test("missing parts give a not-run verdict instead of an exception", () => {
  const ctx = V.context({ parts: C.PARTS.filter((p) => p.id !== "ti-iwr6843aop"), rounds: 50 });
  const r = V.runCheck(V.CHECKS.find((c) => c.id === "ti-radar"), ctx);
  assert.equal(r.verdict, "na");
});
