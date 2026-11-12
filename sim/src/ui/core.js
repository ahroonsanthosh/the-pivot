/* ================================================================== core: helpers, persistent state, library merge */
const E = window.APSEngine, CAT = window.APSCatalog;
const $ = (id) => document.getElementById(id);
const tok = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const clone = (o) => JSON.parse(JSON.stringify(o));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const pct = (p, d = 0) => (p == null || !Number.isFinite(p) ? "—" : (p * 100).toFixed(d) + "%");
const euro = (x) => "€" + Math.round(x).toLocaleString("en-IE");
const kgTxt = (x) => (x >= 100 ? Math.round(x).toLocaleString("en-IE") : x >= 10 ? x.toFixed(1) : x.toFixed(2)) + " kg";
function fmtMs(m) {
  if (m == null || !Number.isFinite(m)) return "—";
  if (m >= 10000) return (m / 1000).toFixed(1) + " s";
  if (m >= 1000) return (m / 1000).toFixed(2) + " s";
  if (m >= 100) return Math.round(m) + " ms";
  if (m >= 10) return m.toFixed(0) + " ms";
  if (m >= 1) return m.toFixed(1) + " ms";
  return m.toFixed(2) + " ms";
}
const LEVEL_NAME = Object.fromEntries(CAT.LEVELS);
const OUT = Object.fromEntries(E.OUTCOMES.map(([k, label, color]) => [k, { label, color }]));

const store = {
  get(k, d) { try { const v = localStorage.getItem("apsSim." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("apsSim." + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};

const S = {
  build: Object.assign(clone(CAT.DEFAULT_BUILD), store.get("build", {})),
  scen: (() => { const d = clone(CAT.DEFAULT_SCENARIO), s = store.get("scen", {}) || {}; return { ...d, ...s, threats: { ...d.threats, ...(s.threats || {}) } }; })(),
  req: { ...CAT.DEFAULT_REQ, ...store.get("req", {}) },
  shot: { threat: "556", r0: 150, az: 30, el: 2, ph: 0.5, seed: 1, win: "final", ...store.get("shot", {}) },
  custom: { parts: {}, deleted: [], threats: {}, threatsDeleted: [], ...store.get("custom", {}) },
  saved: store.get("saved", null) || clone(CAT.EXAMPLE_BUILDS),
  perfThreat: store.get("perfThreat", "556"),
  libTab: store.get("libTab", "camera"),
};
let LIB = null, THREATS = [], SYS = null, EVAL = null, PERF = null, SHOT = null;

function rebuildLibrary() {
  const del = new Set(S.custom.deleted || []), ids = new Set(CAT.PARTS.map((p) => p.id));
  const parts = CAT.PARTS.filter((p) => !del.has(p.id)).map((p) => (S.custom.parts[p.id] ? { ...p, ...S.custom.parts[p.id], cat: p.cat, id: p.id, custom: "edited" } : p));
  for (const [id, p] of Object.entries(S.custom.parts)) if (!ids.has(id) && CAT.CATEGORIES[p.cat]) parts.push({ ...p, id, custom: "new" });
  LIB = E.makeLibrary(parts);
  const tdel = new Set(S.custom.threatsDeleted || []), tids = new Set(CAT.THREATS.map((t) => t.id));
  THREATS = CAT.THREATS.filter((t) => !tdel.has(t.id)).map((t) => (S.custom.threats[t.id] ? { ...t, ...S.custom.threats[t.id], id: t.id, custom: "edited" } : t));
  for (const [id, t] of Object.entries(S.custom.threats)) if (!tids.has(id)) THREATS.push({ ...t, id, custom: "new" });
}
const threatById = (id) => THREATS.find((t) => t.id === id) || THREATS[0];
const partsOf = (cat) => LIB.byCat[cat] || [];

/* Keep a build consistent with the library: replace missing parts and mismatched lenses. */
function normalizeBuild(b) {
  const slotCat = { camera: "camera", lens: "lens", radar: "radar", compute: "compute", controller: "controller", driver: "driver", aim: "actuator", frame: "structure", gearing: "structure", shield: "shield" };
  const optional = new Set(["camera", "radar", "aim", "frame", "gearing", "shield"]);
  for (const [k, cat] of Object.entries(slotCat)) {
    const p = LIB.byId[b[k]];
    if (b[k] === "none" && optional.has(k)) continue;
    if (!p || p.cat !== cat) b[k] = optional.has(k) ? "none" : (partsOf(cat)[0] || { id: "none" }).id;
  }
  const cam = LIB.byId[b.camera];
  if (cam) { const l = LIB.byId[b.lens]; if (!l || (l.band === "lwir") !== (cam.band === "lwir")) { const m = partsOf("lens").find((x) => (x.band === "lwir") === (cam.band === "lwir")); if (m) b.lens = m.id; } }
  if (b.deploy && b.deploy !== "none" && b.deploy !== "pneumatic" && !(LIB.byId[b.deploy] && LIB.byId[b.deploy].cat === "actuator")) b.deploy = "none";
  for (const [k, role] of [["pSource", "source"], ["pValve", "valve"], ["pLine", "line"]]) {
    const p = LIB.byId[b[k]]; if (!p || p.role !== role) { const m = partsOf("pneumatic").find((x) => x.role === role); b[k] = m ? m.id : "none"; }
  }
  if (b.radar !== "none" && !(b.radars >= 1)) b.radars = 1;
  return b;
}

function recompute() {
  normalizeBuild(S.build);
  SYS = E.derive(S.build, LIB, S.scen, CAT);
  EVAL = E.evaluate(SYS, S.req);
}
const persist = debounce(() => {
  store.set("build", S.build); store.set("scen", S.scen); store.set("req", S.req); store.set("shot", S.shot);
  store.set("custom", S.custom); store.set("saved", S.saved); store.set("perfThreat", S.perfThreat); store.set("libTab", S.libTab);
}, 250);

/* ------------------------------------------------------------------ part presentation */
const STATUS_NAME = Object.fromEntries(CAT.STATUS);
const STATUS_SHORT = { verified: "verified", eol: "end-of-life", research: "research only", category: "category", unidentified: "model unknown", unverified: "unverified" };
const STATUS_CLS = { verified: "ok", eol: "bad", research: "warn", category: "na", unidentified: "warn", unverified: "na" };
function statusChip(p) { const s = (p && p.status) || "unverified"; return `<span class="schip ${STATUS_CLS[s] || "na"}" title="${esc((p && p.statusNote) || STATUS_NAME[s] || "")}">${STATUS_SHORT[s] || s}</span>`; }
const ratingClass = (r) => (r == null ? "na" : r >= 7 ? "ok" : r >= 4 ? "warn" : "bad");
function ratingChip(p) {
  const r = p ? p.rating : null;
  return `<span class="rchip ${ratingClass(r)}" title="${esc(r == null ? "Not rated" : p.note || "")}">${r == null ? "unrated" : r + "/10"}</span>`;
}
const optLabel = (p) => `${p.name}${p.rating != null ? ` · ${p.rating}/10` : ""}${p.custom === "new" ? " · custom" : p.custom === "edited" ? " · edited" : ""}`;
function shieldMassG(p) { return p.w && p.h && p.areal ? (p.w / 1000) * (p.h / 1000) * p.areal * 1000 : p.mass; }
function partSummary(p) {
  if (!p) return "";
  const n = (x) => (typeof x === "number" ? +x.toFixed(2) : x);
  let a = [];
  switch (p.cat) {
    case "camera": a = [p.band === "event" ? `${p.hres}×${p.vres} event · ${p.latUs} µs` : `${p.hres}×${p.vres} · ${p.fps} fps`, p.band === "lwir" ? "LWIR" : null, (p.iface || "").toUpperCase()]; break;
    case "lens": a = [`${p.hfov}°`, `f/${p.fno}`, p.band === "lwir" ? "LWIR" : null]; break;
    case "radar": a = [`${p.freq} GHz`, { tracker: "tracker", presence: "point cloud", chronograph: "shot record" }[p.mode], `±${p.fovAz}°`]; break;
    case "compute": a = [`${p.pixRate} Mpx/s`, `USB ${p.usbGbps} Gb/s`, `${p.csiPorts} CSI`]; break;
    case "controller": a = [`${p.latMs} ms`]; break;
    case "driver": a = [`+${p.latMs} ms`, (p.provides || []).join(" / ")]; break;
    case "actuator": a = [p.kind === "linear" ? `${p.speed} mm/s · ${p.range} mm` : `${p.speed}°/s · ${p.range}°`, p.drive]; break;
    case "structure": a = [p.role === "frame" ? `${p.slew}° travel` : `${p.ratio}:1`, `±${p.posErr}°`]; break;
    case "pneumatic": a = [p.role === "source" ? `${p.bar} bar` : `${p.deadMs} ms`, p.role]; break;
    case "shield": a = [`${p.w}×${p.h} mm`, `stops ${(LEVEL_NAME[p.level] || p.level).toLowerCase()}`]; break;
  }
  const mass = p.cat === "shield" ? shieldMassG(p) : p.mass;
  a.push(`${n(+mass)} g`);
  if (p.power) a.push(`${n(p.power)} W`);
  if (p.cost) a.push(euro(p.cost));
  return a.filter(Boolean).join(" · ");
}
function partHint(p) {
  if (!p) return "";
  const est = (p.est || []).length;
  return `${ratingChip(p)}${statusChip(p)}${p.shortlist ? '<span class="star" title="Retained as product candidate">★</span>' : ""}<span>${esc(partSummary(p))}</span>${est ? `<span class="estchip" title="Estimated fields: ${esc(p.est.join(", "))}">${est} est.</span>` : ""}`;
}
function gauge(label, value, unit, sub, frac, level) {
  const w = Math.max(0, Math.min(1, frac == null ? 0 : frac)) * 100;
  return `<div class="gauge ${level || ""}"><span class="eyebrow">${label}</span><span class="v">${value}<small>${unit}</small></span><span class="s">${sub}</span>${frac != null ? `<div class="bar"><div style="width:${w}%"></div></div>` : ""}</div>`;
}
async function copyText(text, fallbackEl) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) { if (fallbackEl) { fallbackEl.hidden = false; fallbackEl.value = text; fallbackEl.focus(); fallbackEl.select(); } return false; }
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "part";
