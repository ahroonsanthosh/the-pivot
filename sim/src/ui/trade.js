/* ================================================================== trade study */
const TRADE_SLOTS = [
  { k: "camera", label: "Camera", cat: "camera", none: "No cameras" },
  { k: "lens", label: "Lens", cat: "lens" },
  { k: "pods", label: "Camera pods", values: [1, 2, 3, 4, 5, 6, 8, 10, 12].map((v) => [v, String(v)]) },
  { k: "podMount", label: "Pod mounting", values: [["helmet", "Helmet"], ["shoulder", "Shoulders"], ["vest", "Vest"]] },
  { k: "roi", label: "Sensor rows read (ROI)", values: [[1, "100%"], [0.75, "75%"], [0.5, "50%"], [0.25, "25%"], [0.1, "10%"]] },
  { k: "radar", label: "Radar", cat: "radar", none: "No radar" },
  { k: "radars", label: "Radar units", values: [1, 2, 3, 4].map((v) => [v, String(v)]) },
  { k: "compute", label: "Compute", cat: "compute" },
  { k: "fusion", label: "Alert rule", values: [["or", "Either sensor"], ["and", "Both agree"], ["cam", "Cameras only"], ["radar", "Radar only"]] },
  { k: "k", label: "Detection threshold", values: [3.5, 4, 4.5, 5, 5.5, 6].map((v) => [v, "SNR " + v]) },
  { k: "controller", label: "Controller", cat: "controller" },
  { k: "driver", label: "Actuator driver", cat: "driver" },
  { k: "aim", label: "Aiming actuator", cat: "actuator", none: "None", filter: (p) => p.kind !== "linear" },
  { k: "deploy", label: "Deployment", cat: "actuator", none: "None", extra: [["pneumatic", "Pneumatic"]] },
  { k: "shield", label: "Protective element", cat: "shield", none: "None" },
  { k: "battWh", label: "Battery", values: [50, 99, 150, 200, 300].map((v) => [v, v + " Wh"]) },
];
const OBJECTIVES = [["goal", "Scenario goal"], ["need", "Warned in time"], ["ready", "Mechanism in time"], ["prot", "Protected"]];
const XAXES = [["mass", "Added mass", "kg", -1], ["power", "Power", "W", -1], ["cost", "Parts cost", "€", -1], ["ready", "Weakest rating", "/10", 1], ["runtime", "Runtime", "h", 1]];
S.trade = Object.assign({ sel: null, minRating: 0, unrated: true, objective: "goal", rounds: 300, x: "mass" }, store.get("trade", {}));
let TRADE = { results: [], running: false, cancel: false, selected: -1 };

function slotOptions(s) {
  if (s.values) return s.values.map(([v, l]) => ({ v, label: l, rating: null, part: null }));
  let list = partsOf(s.cat); if (s.filter) list = list.filter(s.filter);
  const o = [];
  if (s.none) o.push({ v: "none", label: s.none, rating: null, part: null });
  (s.extra || []).forEach(([v, l]) => o.push({ v, label: l, rating: null, part: null }));
  list.forEach((p) => o.push({ v: p.id, label: p.name, rating: p.rating, part: p }));
  return o;
}
function defaultTradeSel() {
  const sel = {};
  sel.camera = partsOf("camera").filter((p) => p.rating != null && p.rating >= 5).map((p) => p.id);
  sel.lens = partsOf("lens").filter((p) => p.band === "vis" && p.hfov >= 40).map((p) => p.id);
  sel.compute = partsOf("compute").filter((p) => p.rating != null && p.rating >= 4).map((p) => p.id);
  sel.radar = ["none", S.build.radar !== "none" ? S.build.radar : "ti-iwr6843aop"];
  return sel;
}
const tradeSel = (k) => { const v = S.trade.sel && S.trade.sel[k]; return v && v.length ? v : [S.build[k]]; };
const isSwept = (k) => !!(S.trade.sel && S.trade.sel[k] && S.trade.sel[k].length > 0);
function ratingAllowed(o) { if (!o.part) return true; if (o.rating == null) return S.trade.unrated; return o.rating >= S.trade.minRating; }

function tradeCombos(limit) {
  const slots = TRADE_SLOTS.map((s) => {
    const opts = slotOptions(s), vals = tradeSel(s.k);
    let use = opts.filter((o) => vals.some((v) => String(v) === String(o.v)) && (!isSwept(s.k) || ratingAllowed(o))).map((o) => o.v);
    if (!use.length) use = [S.build[s.k]];
    return [s.k, use];
  });
  const seen = new Set(), out = []; let raw = 0;
  const rec = (i, acc) => {
    if (out.length >= limit) return;
    if (i === slots.length) {
      raw++;
      const b = { ...clone(S.build), ...acc };
      const cam = LIB.byId[b.camera], lens = LIB.byId[b.lens];
      if (cam && lens && (lens.band === "lwir") !== (cam.band === "lwir")) return;
      if (b.radar === "none") b.radars = 0; else if (!(b.radars >= 1)) b.radars = 1;
      if (b.camera === "none") { b.lens = S.build.lens; b.pods = 0; }
      if (b.aim === "none") { b.frame = "none"; b.gearing = "none"; }
      normalizeBuild(b);
      const key = JSON.stringify(b); if (seen.has(key)) return; seen.add(key);
      out.push({ b, varied: Object.fromEntries(slots.filter(([k, v]) => v.length > 1).map(([k]) => [k, b[k]])) });
      return;
    }
    const [k, vals] = slots[i];
    for (const v of vals) { acc[k] = v; rec(i + 1, acc); if (out.length >= limit) return; }
  };
  rec(0, {});
  const total = slots.reduce((n, [, v]) => n * v.length, 1);
  return { combos: out, total };
}

function renderTradeRail() {
  if (!S.trade.sel) S.trade.sel = defaultTradeSel();
  const t = S.trade;
  let h = `<fieldset><legend>Objective</legend>
    <div class="seg" id="tr_obj" role="group" aria-label="Objective">${OBJECTIVES.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${t.objective === v}">${l}</button>`).join("")}</div>
    <div class="f"><span class="lbl">Burden axis</span><div class="seg" id="tr_x" role="group" aria-label="Burden axis">${XAXES.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${t.x === v}">${l.split(" ").pop()}</button>`).join("")}</div></div>
    <label class="f"><span>Rounds per threat <b id="tr_roundsOut">${t.rounds}</b></span><input type="range" id="tr_rounds" min="100" max="1500" step="50" value="${t.rounds}"></label>
    <label class="f"><span>Skip rated parts below <b id="tr_minOut">${t.minRating ? t.minRating + "/10" : "off"}</b></span><input type="range" id="tr_min" min="0" max="10" step="1" value="${t.minRating}"></label>
    <label class="check"><input type="checkbox" id="tr_unrated" ${t.unrated ? "checked" : ""}> Include unrated parts</label>
  </fieldset>
  <fieldset><legend>Slots to sweep</legend><div class="sweep">`;
  for (const s of TRADE_SLOTS) {
    const opts = slotOptions(s), vals = tradeSel(s.k), swept = isSwept(s.k);
    h += `<details ${swept ? "open" : ""}><summary><span>${s.label}</span><b>${swept ? vals.length + " selected" : "current only"}</b></summary><div class="opts">`;
    h += opts.map((o) => `<label><input type="checkbox" data-slot="${s.k}" data-v="${esc(o.v)}" ${swept && vals.some((v) => String(v) === String(o.v)) ? "checked" : ""}> <span>${esc(o.label)}</span>${o.part ? ratingChip(o.part) : ""}</label>`).join("");
    h += `</div></details>`;
  }
  h += `</div></fieldset>
  <div class="btnrow"><button class="btn small" type="button" id="tr_short">Shortlisted parts only</button><button class="btn small" type="button" id="tr_def">Default sweep</button><button class="btn small" type="button" id="tr_clear">Clear all sweeps</button></div>
  <div class="btnrow"><button class="btn primary" type="button" id="tr_run">Run trade study</button><button class="btn" type="button" id="tr_cancel" hidden>Stop</button></div>
  <p class="note" id="tr_count"></p>`;
  $("tradeRail").innerHTML = h;
  updateTradeCount();
}
function updateTradeCount() {
  const { combos, total } = tradeCombos(2001);
  const n = combos.length;
  $("tr_count").textContent = n > 2000 ? `More than 2,000 distinct builds selected (${total.toLocaleString("en-IE")} raw combinations). Narrow the sweep; only the first 2,000 will run.`
    : `${n.toLocaleString("en-IE")} distinct build${n === 1 ? "" : "s"} × ${Object.values(S.scen.threats).filter((w) => w > 0).length} threats × ${S.trade.rounds} rounds.`;
}
function wireTradeRail() {
  const f = $("tradeRail");
  f.addEventListener("submit", (e) => e.preventDefault());
  f.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.slot) {
      const k = el.dataset.slot, s = TRADE_SLOTS.find((x) => x.k === k), raw = el.dataset.v;
      const v = s.values ? s.values.find(([x]) => String(x) === raw)[0] : raw;
      let cur = (S.trade.sel[k] || []).slice();
      if (el.checked) { if (!cur.some((x) => String(x) === raw)) cur.push(v); } else cur = cur.filter((x) => String(x) !== raw);
      S.trade.sel[k] = cur;
      const sum = el.closest("details").querySelector("summary b"); sum.textContent = cur.length ? cur.length + " selected" : "current only";
      updateTradeCount(); persistTrade();
    }
    if (el.id === "tr_unrated") { S.trade.unrated = el.checked; updateTradeCount(); persistTrade(); }
  });
  f.addEventListener("input", (e) => {
    if (e.target.id === "tr_rounds") { S.trade.rounds = +e.target.value; $("tr_roundsOut").textContent = S.trade.rounds; updateTradeCount(); persistTrade(); }
    if (e.target.id === "tr_min") { S.trade.minRating = +e.target.value; $("tr_minOut").textContent = S.trade.minRating ? S.trade.minRating + "/10" : "off"; updateTradeCount(); persistTrade(); }
  });
  f.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.closest("#tr_obj")) { S.trade.objective = b.dataset.v; renderTradeRail(); drawTrade(); persistTrade(); }
    else if (b.closest("#tr_x")) { S.trade.x = b.dataset.v; renderTradeRail(); drawTrade(); persistTrade(); }
    else if (b.id === "tr_short") {
      const sel = {};
      for (const s of TRADE_SLOTS) if (s.cat) { const ids = partsOf(s.cat).filter((p) => p.shortlist && (!s.filter || s.filter(p))).map((p) => p.id); if (ids.length > 1) sel[s.k] = ids; }
      sel.lens = defaultTradeSel().lens;
      S.trade.sel = sel; renderTradeRail(); persistTrade();
    } else if (b.id === "tr_def") { S.trade.sel = defaultTradeSel(); renderTradeRail(); persistTrade(); }
    else if (b.id === "tr_clear") { S.trade.sel = {}; renderTradeRail(); persistTrade(); }
    else if (b.id === "tr_run") runTrade();
    else if (b.id === "tr_cancel") TRADE.cancel = true;
  });
}
const persistTrade = debounce(() => store.set("trade", S.trade), 300);

async function runTrade() {
  if (TRADE.running) return;
  const { combos } = tradeCombos(2000);
  if (!combos.length) return;
  TRADE = { results: [], running: true, cancel: false, selected: -1, scen: clone(S.scen), req: clone(S.req) };
  $("tr_run").disabled = true; $("tr_cancel").hidden = false; $("tradeProg").hidden = false; $("btnTradeCsv").disabled = true;
  const bar = $("tradeProg").firstElementChild, t0 = performance.now();
  for (let i = 0; i < combos.length; i++) {
    if (TRADE.cancel) break;
    const c = combos[i];
    const sys = E.derive(c.b, LIB, S.scen, CAT), ev = E.evaluate(sys, S.req);
    const perf = E.runScenario(sys, THREATS, S.scen, S.trade.rounds, 1);
    TRADE.results.push({ b: c.b, varied: c.varied, sys, ev, perf });
    if (performance.now() - (TRADE.lastYield || t0) > 40) {
      bar.style.width = ((i + 1) / combos.length) * 100 + "%";
      $("tradeMeta").textContent = `${i + 1} / ${combos.length} builds`;
      await new Promise((r) => setTimeout(r, 0)); TRADE.lastYield = performance.now();
    }
  }
  bar.style.width = "100%";
  TRADE.running = false; TRADE.ms = performance.now() - t0;
  $("tr_run").disabled = false; $("tr_cancel").hidden = true; $("btnTradeCsv").disabled = !TRADE.results.length;
  setTimeout(() => { $("tradeProg").hidden = true; }, 400);
  drawTrade();
}
function tradeY(r) { const o = S.trade.objective; return o === "goal" ? r.perf.goal : r.perf[o]; }
function tradeX(r) {
  switch (S.trade.x) { case "power": return r.sys.power; case "cost": return r.sys.cost; case "ready": return r.sys.readiness.min == null ? 0 : r.sys.readiness.min; case "runtime": return Math.min(r.sys.runtimeH, 48); default: return r.sys.added; }
}
function paretoSet(rs) {
  const ax = XAXES.find((a) => a[0] === S.trade.x), dir = ax[3];
  const pts = rs.filter((r) => r.ev.feasible);
  const front = new Set();
  pts.forEach((a) => {
    const ya = tradeY(a), xa = tradeX(a) * dir;
    const dominated = pts.some((b) => b !== a && tradeY(b) >= ya && tradeX(b) * dir >= xa && (tradeY(b) > ya || tradeX(b) * dir > xa));
    if (!dominated) front.add(a);
  });
  return front;
}
function niceTicks(lo, hi, n) {
  const span = hi - lo || 1, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10)); return out;
}
function variedText(r, html) {
  const parts = Object.entries(r.varied).map(([k, v]) => {
    const s = TRADE_SLOTS.find((x) => x.k === k), p = LIB.byId[v];
    const label = p ? p.name : s && s.values ? (s.values.find(([x]) => String(x) === String(v)) || [, v])[1] : v === "none" ? "none" : v;
    return html ? `<span>${p ? "" : `<em>${esc(s ? s.label : k)}</em> `}${esc(label)}${p ? " " + ratingChip(p) : ""}</span>` : `${s ? s.label : k}: ${label}`;
  });
  return parts.length ? (html ? parts.join("") : parts.join("; ")) : html ? '<span class="muted">current build</span>' : "current build";
}
function drawTrade() {
  const svg = $("tradePlot"), rs = TRADE.results;
  const ax = XAXES.find((a) => a[0] === S.trade.x), obj = OBJECTIVES.find((o) => o[0] === S.trade.objective);
  if (!rs.length) { svg.innerHTML = `<text x="360" y="160" text-anchor="middle" font-size="13" fill="var(--muted)">Pick slots to sweep, then run the trade study.</text>`; $("tradeTbl").innerHTML = ""; return; }
  const W = 720, H = 320, L = 58, Rm = 18, T = 16, B = 44, pw = W - L - Rm, ph = H - T - B;
  const xs = rs.map(tradeX), xmin = Math.min(...xs), xmax = Math.max(...xs);
  const logX = S.trade.x === "cost" && xmax / Math.max(xmin, 1) > 30;
  const fx = logX ? (v) => Math.log10(Math.max(v, 1)) : (v) => v;
  let lo = fx(xmin), hi = fx(xmax); if (hi - lo < 1e-9) { lo -= 1; hi += 1; } const pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
  if (!logX && S.trade.x !== "ready") lo = Math.max(0, lo);
  const X = (v) => L + ((fx(v) - lo) / (hi - lo)) * pw, Y = (p) => T + ph - p * ph;
  let h = "";
  [0, 0.25, 0.5, 0.75, 1].forEach((p) => { h += `<line x1="${L}" x2="${W - Rm}" y1="${Y(p)}" y2="${Y(p)}" stroke="var(--line)"/><text x="${L - 6}" y="${Y(p) + 4}" text-anchor="end" font-size="10" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${Math.round(p * 100)}%</text>`; });
  const ticks = logX ? niceTicks(lo, hi, 6).filter((v) => Number.isInteger(v)).map((v) => Math.pow(10, v)) : niceTicks(lo, hi, 7);
  ticks.forEach((v) => { const x = X(v); if (x < L - 1 || x > W - Rm + 1) return; h += `<line x1="${x}" x2="${x}" y1="${T}" y2="${T + ph}" stroke="var(--line)" opacity="0.6"/><text x="${x}" y="${T + ph + 16}" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${S.trade.x === "cost" ? euro(v) : +v.toFixed(2)}</text>`; });
  h += `<text x="${L + pw / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">${ax[1]} (${ax[2]})${logX ? ", log scale" : ""}${ax[3] > 0 ? " · higher is better" : " · lower is better"}</text>`;
  h += `<text x="12" y="${T + ph / 2}" transform="rotate(-90 12 ${T + ph / 2})" text-anchor="middle" font-size="11" fill="var(--muted)">${obj[1]}</text>`;
  const front = paretoSet(rs);
  const fpts = [...front].sort((a, b) => tradeX(a) - tradeX(b));
  if (fpts.length > 1) h += `<polyline points="${fpts.map((r) => `${X(tradeX(r))},${Y(tradeY(r))}`).join(" ")}" fill="none" stroke="var(--accent)" stroke-dasharray="5 4" stroke-width="1.5"/>`;
  const curKey = JSON.stringify(normalizeBuild(clone(S.build)));
  rs.forEach((r, i) => {
    const x = X(tradeX(r)), y = Y(tradeY(r)), feas = r.ev.feasible, sel = i === TRADE.selected, cur = JSON.stringify(r.b) === curKey;
    h += `<circle data-i="${i}" cx="${x}" cy="${y}" r="${sel ? 7 : front.has(r) ? 5.5 : 4.5}" fill="${feas ? (front.has(r) ? "var(--accent)" : "color-mix(in srgb, var(--accent) 45%, transparent)") : "var(--surface)"}" stroke="${sel || cur ? "var(--ink)" : feas ? "none" : "var(--muted)"}" stroke-width="${sel || cur ? 2 : 1.2}" style="cursor:pointer"/>`;
  });
  const ci = rs.findIndex((r) => JSON.stringify(r.b) === curKey);
  if (ci >= 0) { const x = X(tradeX(rs[ci])), y = Y(tradeY(rs[ci])); h += `<text x="${x + 9}" y="${y - 8}" font-size="10.5" fill="var(--ink)" font-family="IBM Plex Mono, monospace">current</text>`; }
  svg.innerHTML = h;
  const nf = rs.filter((r) => r.ev.feasible).length;
  $("tradeMeta").textContent = `${rs.length} builds · ${nf} pass blocking checks · ${front.size} on the front · ${Math.round((TRADE.ms || 0) / 100) / 10} s`;
  renderTradeTable(front);
}
function sortedTrade() {
  const ax = XAXES.find((a) => a[0] === S.trade.x);
  return TRADE.results.map((r, i) => ({ r, i })).sort((a, b) => (b.r.ev.feasible - a.r.ev.feasible) || (tradeY(b.r) - tradeY(a.r)) || (tradeX(a.r) - tradeX(b.r)) * -ax[3]);
}
function renderTradeTable(front) {
  const rows = sortedTrade().slice(0, 60), per = THREATS.filter((t) => !(t.id in S.scen.threats) || S.scen.threats[t.id] > 0);
  const cls = (p) => (p >= 0.7 ? "ok" : p >= 0.3 ? "warn" : "bad");
  let h = `<thead><tr><th class="n">#</th><th>Varied parts</th><th class="n">Objective</th>${per.map((t) => `<th class="n" title="${esc(t.name)}">${esc(t.short)}</th>`).join("")}<th class="n">Mass</th><th class="n">Power</th><th class="n">Runtime</th><th class="n">Cost</th><th class="n">Weakest</th><th class="n">False /h</th><th>Checks</th><th></th></tr></thead><tbody>`;
  rows.forEach(({ r, i }, n) => {
    const bad = r.sys.issues.concat(r.ev.violations).filter((x) => x.level === "bad"), warns = r.sys.issues.concat(r.ev.violations).length - bad.length;
    h += `<tr data-i="${i}" class="click ${i === TRADE.selected ? "sel" : ""} ${r.ev.feasible ? "" : "dim"}"><td class="n">${n + 1}${front.has(r) ? ' <span class="star" title="On the trade-off front">◆</span>' : ""}</td><td><div class="combo">${variedText(r, true)}</div></td>`;
    h += `<td class="n"><span class="pct ${cls(tradeY(r))}">${pct(tradeY(r))}</span></td>`;
    per.forEach((t) => { const p = r.perf.per.find((x) => x.id === t.id); const v = p ? (S.trade.objective === "goal" ? p.pGoal : p["p" + S.trade.objective[0].toUpperCase() + S.trade.objective.slice(1)]) : null; h += `<td class="n">${pct(v)}</td>`; });
    h += `<td class="n">${kgTxt(r.sys.added)}</td><td class="n">${fmt(r.sys.power, 1)} W</td><td class="n">${fmt(r.sys.runtimeH, 1)} h</td><td class="n">${euro(r.sys.cost)}</td><td class="n">${r.sys.readiness.min == null ? "—" : r.sys.readiness.min + "/10"}</td><td class="n">${E.fmtRate(r.sys.farH)}</td>`;
    h += `<td title="${esc(r.sys.issues.concat(r.ev.violations).map((x) => x.msg).join("\n"))}">${bad.length ? `<span style="color:var(--bad)">${bad.length} blocking</span>` : warns ? `<span style="color:var(--warn)">${warns} warn</span>` : '<span style="color:var(--ok)">pass</span>'}</td>`;
    h += `<td><button class="btn small" type="button" data-loadtrade="${i}">Load</button></td></tr>`;
  });
  $("tradeTbl").innerHTML = h + "</tbody>";
}
function tradeCsv() {
  const per = THREATS.filter((t) => !(t.id in TRADE.scen.threats) || TRADE.scen.threats[t.id] > 0);
  const cols = ["rank", "varied", "camera", "lens", "pods", "pod_mount", "radar", "radars", "compute", "fusion", "aim", "deploy", "shield", "objective", "warned_in_time", "mechanism_in_time", "protected",
    ...per.map((t) => "goal_" + t.id), "mass_kg", "head_kg", "power_w", "runtime_h", "cost_eur", "weakest_rating", "false_alerts_per_h", "feasible", "issues"];
  const q = (v) => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.join(",")];
  sortedTrade().forEach(({ r }, n) => {
    const b = r.b;
    lines.push([n + 1, variedText(r, false), b.camera, b.lens, b.pods, b.podMount, b.radar, b.radars, b.compute, b.fusion, b.aim, b.deploy, b.shield,
      tradeY(r).toFixed(4), r.perf.need.toFixed(4), r.perf.ready.toFixed(4), r.perf.prot.toFixed(4),
      ...per.map((t) => { const p = r.perf.per.find((x) => x.id === t.id); return p ? p.pGoal.toFixed(4) : ""; }),
      r.sys.added.toFixed(3), r.sys.headMass.toFixed(3), r.sys.power.toFixed(2), r.sys.runtimeH.toFixed(2), Math.round(r.sys.cost), r.sys.readiness.min == null ? "" : r.sys.readiness.min,
      r.sys.farH.toPrecision(3), r.ev.feasible ? "yes" : "no", r.sys.issues.concat(r.ev.violations).map((x) => x.msg).join(" | ")].map(q).join(","));
  });
  return lines.join("\n");
}
function wireTradeOutput() {
  const tip = $("tradeTip"), svg = $("tradePlot");
  const select = (i, scroll) => {
    TRADE.selected = i; drawTrade();
    if (scroll) { const tr = document.querySelector(`#tradeTbl tr[data-i="${i}"]`); if (tr) tr.scrollIntoView({ block: "nearest" }); }
  };
  svg.addEventListener("pointermove", (e) => {
    const c = e.target.closest("circle[data-i]"); if (!c) { tip.hidden = true; return; }
    const r = TRADE.results[+c.dataset.i], box = svg.parentElement.getBoundingClientRect();
    tip.innerHTML = `<b>${pct(tradeY(r))} · ${kgTxt(r.sys.added)} · ${fmt(r.sys.power, 1)} W · ${euro(r.sys.cost)}</b><span>${esc(variedText(r, false))}</span><span>${r.ev.feasible ? "passes blocking checks" : "fails a blocking check"}</span>`;
    tip.hidden = false; tip.style.left = Math.min(e.clientX - box.left + 14, box.width - 270) + "px"; tip.style.top = e.clientY - box.top + 14 + "px";
  });
  svg.addEventListener("pointerleave", () => { tip.hidden = true; });
  svg.addEventListener("click", (e) => { const c = e.target.closest("circle[data-i]"); if (c) select(+c.dataset.i, true); });
  $("tradeTbl").addEventListener("click", (e) => {
    const l = e.target.closest("[data-loadtrade]");
    if (l) { S.build = normalizeBuild(clone(TRADE.results[+l.dataset.loadtrade].b)); S.build.name = "From trade study"; onBuildChanged(); document.getElementById("build").scrollIntoView(); return; }
    const tr = e.target.closest("tr[data-i]"); if (tr) select(+tr.dataset.i, false);
  });
  $("btnTradeCsv").addEventListener("click", async () => {
    const ok = await copyText(tradeCsv(), $("tradeCsv"));
    $("btnTradeCsv").textContent = ok ? "Copied" : "Select and copy below"; setTimeout(() => { $("btnTradeCsv").textContent = "Copy CSV"; }, 1800);
  });
}
