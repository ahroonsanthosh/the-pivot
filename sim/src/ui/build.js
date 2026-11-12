/* ================================================================== build rail and bench readouts */
const camOf = (b) => LIB.byId[b.camera];
const hasCam = (b) => b.camera !== "none" && !!camOf(b);
const camBand = (b) => (hasCam(b) ? camOf(b).band : null);
const hasMech = (b) => b.aim !== "none" || b.deploy !== "none" || b.shield !== "none";
function fpsAtRoi(b, roi) { const c = camOf(b); if (!c || c.band === "event") return "—"; return Math.round(Math.min(c.fpsMax || c.fps, c.fps / roi)); }

const RAIL = [
  { legend: "Sensors", items: [
    { k: "camera", type: "part", cat: "camera", label: "Camera", none: "No cameras" },
    { k: "lens", type: "part", cat: "lens", label: "Lens", show: hasCam, filter: (p, b) => { const c = camOf(b); return !c || (p.band === "lwir") === (c.band === "lwir"); } },
    { k: "pods", type: "range", label: "Camera pods", min: 0, max: 12, step: 1, fmt: (v) => String(v), show: hasCam },
    { k: "podMount", type: "seg", label: "Pod mounting", opts: [["helmet", "Helmet"], ["shoulder", "Shoulders"], ["vest", "Vest"]], show: hasCam },
    { k: "roi", type: "range", label: "Sensor rows read (ROI)", min: 0.05, max: 1, step: 0.01, fmt: (v, b) => `${Math.round(v * 100)}% · ${fpsAtRoi(b, v)} fps`, show: (b) => hasCam(b) && camBand(b) !== "event" },
    { k: "expUs", type: "range", label: "Exposure", min: 10, max: 2000, step: 10, fmt: (v) => v + " µs", show: (b) => camBand(b) === "vis" },
    { k: "radar", type: "part", cat: "radar", label: "Radar", none: "No radar" },
    { k: "radars", type: "range", label: "Radar units round the vest", min: 1, max: 4, step: 1, fmt: (v) => String(v), show: (b) => b.radar !== "none" },
  ] },
  { legend: "Processing and detection", items: [
    { k: "compute", type: "part", cat: "compute", label: "Compute" },
    { k: "fusion", type: "seg", label: "Raise the alert when", opts: [["or", "Either"], ["and", "Both agree"], ["cam", "Cameras"], ["radar", "Radar"]] },
    { k: "k", type: "range", label: "Detection threshold", min: 3, max: 8, step: 0.1, fmt: (v) => `SNR ${v.toFixed(1)}` },
    { k: "confM", type: "range", label: "Detections to confirm", min: 1, max: 6, step: 1, fmt: (v, b) => `${v} of ${Math.max(v, b.confN)} frames` },
    { k: "confN", type: "range", label: "Confirmation window", min: 1, max: 10, step: 1, fmt: (v) => v + " frames" },
    { k: "stab", type: "range", label: "Ego-motion compensation", min: 0, max: 0.95, step: 0.05, fmt: (v) => Math.round(v * 100) + "%" },
  ] },
  { legend: "Response chain", items: [
    { k: "controller", type: "part", cat: "controller", label: "Controller" },
    { k: "driver", type: "part", cat: "driver", label: "Actuator driver" },
    { k: "aim", type: "part", cat: "actuator", label: "Aiming actuator", none: "None (fixed bearing)", filter: (p) => p.kind !== "linear" },
    { k: "aimAxes", type: "seg", num: true, label: "Driven axes", opts: [["1", "Pan only"], ["2", "Pan and tilt"]], show: (b) => b.aim !== "none" },
    { k: "frame", type: "part", cat: "structure", label: "Turret frame", none: "None", filter: (p) => p.role === "frame", show: (b) => b.aim !== "none" },
    { k: "gearing", type: "part", cat: "structure", label: "Bearing / gearing", none: "None (direct drive)", filter: (p) => p.role === "gearing", show: (b) => b.aim !== "none" },
    { k: "deploy", type: "part", cat: "actuator", label: "Deployment", none: "None", extra: [["pneumatic", "Pneumatic: source + valve + line"]] },
    { k: "pSource", type: "part", cat: "pneumatic", label: "Pressure source", filter: (p) => p.role === "source", show: (b) => b.deploy === "pneumatic" },
    { k: "pValve", type: "part", cat: "pneumatic", label: "Valve", filter: (p) => p.role === "valve", show: (b) => b.deploy === "pneumatic" },
    { k: "pLine", type: "part", cat: "pneumatic", label: "Line", filter: (p) => p.role === "line", show: (b) => b.deploy === "pneumatic" },
    { k: "bore", type: "range", label: "Cylinder bore", min: 6, max: 40, step: 1, fmt: (v) => v + " mm", show: (b) => b.deploy === "pneumatic" },
    { k: "shield", type: "part", cat: "shield", label: "Protective element", none: "None (warning or demonstrator)" },
    { k: "standoff", type: "range", label: "Deploy standoff", min: 0.05, max: 0.6, step: 0.01, fmt: (v) => Math.round(v * 1000) + " mm", show: (b) => b.shield !== "none" || b.deploy !== "none" },
    { k: "respMount", type: "seg", label: "Mechanism mount", opts: [["back", "Back"], ["shoulder", "Shoulder"]], show: hasMech },
  ] },
  { legend: "Power and kit", items: [
    { k: "battWh", type: "range", label: "Battery", min: 20, max: 300, step: 1, fmt: (v) => v + " Wh" },
    { k: "battChem", type: "list", label: "Cell chemistry", opts: () => CAT.BATTERIES.map((x) => [x.id, x.name]) },
    { k: "extraMass", type: "range", label: "Other kit placeholder", min: 0, max: 5, step: 0.1, fmt: (v) => v.toFixed(1) + " kg" },
  ] },
];
const RAIL_ITEMS = Object.fromEntries(RAIL.flatMap((g) => g.items).map((it) => [it.k, it]));

function railItemHtml(it) {
  const id = "b_" + it.k;
  if (it.type === "part" || it.type === "list")
    return `<label class="f" data-item="${it.k}"><span>${it.label}</span><select id="${id}" data-k="${it.k}"></select>${it.type === "part" ? `<small class="hint" id="h_${it.k}"></small>` : ""}</label>`;
  if (it.type === "range")
    return `<label class="f" data-item="${it.k}"><span>${it.label} <b id="o_${it.k}"></b></span><input type="range" id="${id}" data-k="${it.k}" min="${it.min}" max="${it.max}" step="${it.step}"></label>`;
  return `<div class="f" data-item="${it.k}"><span class="lbl">${it.label}</span><div class="seg" role="group" aria-label="${it.label}" data-k="${it.k}">${it.opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="false">${l}</button>`).join("")}</div></div>`;
}
function renderRail() {
  $("buildRail").innerHTML = RAIL.map((g) => `<fieldset><legend>${g.legend}</legend>${g.items.map(railItemHtml).join("")}</fieldset>`).join("");
  syncRail();
}
function partOptions(it, b) {
  let list = partsOf(it.cat);
  if (it.filter) list = list.filter((p) => it.filter(p, b));
  const opts = [];
  if (it.none) opts.push(["none", it.none]);
  if (it.extra) opts.push(...it.extra);
  list.forEach((p) => opts.push([p.id, optLabel(p)]));
  return opts;
}
function syncRail() {
  const b = S.build;
  for (const it of Object.values(RAIL_ITEMS)) {
    const wrap = document.querySelector(`#buildRail [data-item="${it.k}"]`); if (!wrap) continue;
    wrap.hidden = it.show ? !it.show(b) : false;
    if (it.type === "part" || it.type === "list") {
      const sel = $("b_" + it.k), opts = it.type === "part" ? partOptions(it, b) : it.opts();
      const html = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
      if (sel.dataset.html !== html) { sel.innerHTML = html; sel.dataset.html = html; }
      sel.value = b[it.k];
      if (it.type === "part") { const h = $("h_" + it.k); const p = LIB.byId[b[it.k]]; h.innerHTML = p ? partHint(p) : b[it.k] === "pneumatic" ? "<span>Pick the source, valve and line below.</span>" : ""; }
    } else if (it.type === "range") {
      const el = $("b_" + it.k); if (document.activeElement !== el) el.value = b[it.k];
      $("o_" + it.k).textContent = it.fmt(+b[it.k], b);
    } else {
      document.querySelectorAll(`#buildRail .seg[data-k="${it.k}"] button`).forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.v === String(b[it.k]))));
    }
  }
  $("buildName").textContent = S.build.name ? `Started from: ${S.build.name}` : "";
}
function wireRail() {
  const f = $("buildRail");
  const set = (k, v) => {
    S.build[k] = v;
    if (k === "radar" && v !== "none" && !(S.build.radars >= 1)) S.build.radars = 1;
    if (k === "confM" && S.build.confN < v) S.build.confN = v;
    if (k === "confN" && S.build.confM > v) S.build.confM = v;
    onBuildChanged();
  };
  f.addEventListener("input", (e) => { const k = e.target.dataset.k; if (k && e.target.type === "range") set(k, +e.target.value); });
  f.addEventListener("change", (e) => { const k = e.target.dataset.k; if (k && e.target.tagName === "SELECT") set(k, e.target.value); });
  f.addEventListener("click", (e) => { const btn = e.target.closest(".seg button"); if (!btn) return; const k = btn.closest(".seg").dataset.k; set(k, RAIL_ITEMS[k] && RAIL_ITEMS[k].num ? +btn.dataset.v : btn.dataset.v); });
  f.addEventListener("submit", (e) => e.preventDefault());
}

/* ------------------------------------------------------------------ bench readouts */
function renderBench() {
  const sys = SYS, req = S.req, cs = sys.cam;
  const lvlMax = (x, lim) => (x > lim ? "bad" : x > lim * 0.85 ? "warn" : "");
  const g = [];
  g.push(gauge("Added mass", fmt(sys.added, 2), "kg", `${fmt(sys.headMass * 1000, 0)} g head-borne`, sys.added / req.maxMass, lvlMax(sys.added, req.maxMass)));
  g.push(gauge("Power draw", fmt(sys.power, 1), "W", `${sys.powerItems.map((x) => x.name.split(" ")[0].toLowerCase() + " " + fmt(x.w, 1)).slice(0, 3).join(" · ")}`, sys.power / 60, ""));
  g.push(gauge("Runtime", fmt(sys.runtimeH, 1), "h", `${S.build.battWh} Wh · ${fmt(sys.battKg * 1000, 0)} g of cells`, sys.runtimeH / Math.max(req.minRuntime * 2, 1), sys.runtimeH < req.minRuntime ? "bad" : sys.runtimeH < req.minRuntime * 1.2 ? "warn" : ""));
  if (cs) {
    g.push(gauge("Camera data", fmt(cs.bwLoad * 100, 0), "%", `${fmt(cs.bwDemand, 2)} of ${fmt(cs.bwCap, 1)} Gb/s`, cs.bwLoad, lvlMax(cs.bwLoad, 1)));
    g.push(gauge("Compute load", fmt(cs.pixLoad * 100, 0), "%", cs.event ? `${fmt(cs.evRate, 1)} Mev/s per pod` : `${fmt(cs.pixDemand / 1e6, 0)} Mpx/s`, cs.pixLoad, lvlMax(cs.pixLoad, 1)));
    g.push(cs.event ? gauge("Event latency", fmt(cs.dt * 1e6, 0), "µs", "pixel response, this light", null)
      : gauge("Frame rate", fmt(cs.fps, 0), "fps", cs.throttle > 1.0001 ? `throttled from ${Math.round(cs.fpsSensor)}` : `${cs.hres}×${cs.vres} at full rate`, cs.fps / cs.fpsSensor, cs.throttle > 1.0001 ? "warn" : ""));
    g.push(gauge("Sensor to alert", fmt(cs.latS * 1000 + (SYS.ctrlMs || 0), 1), "ms", `proc ${fmt(cs.procMs, 1)} · xfer ${fmt(cs.xferMs, 2)} ms`, null));
  }
  g.push(gauge("Coverage", fmt(Math.max(sys.covGround, sys.radGround) * 100, 0), "%", `ground band cameras ${pct(sys.covGround)} · radar ${pct(sys.radGround)}`, Math.max(sys.covGround, sys.radGround), sys.covGround < 0.7 && sys.radGround < 0.7 ? "warn" : ""));
  g.push(gauge("False alerts", E.fmtRate(sys.farH), "/h", `cameras ${E.fmtRate(sys.camFar)} · radar ${E.fmtRate(sys.radFar)}`, null, sys.farH > req.maxFar ? "warn" : ""));
  const rd = sys.readiness;
  g.push(gauge("Readiness", rd.min == null ? "—" : String(rd.min), rd.min == null ? "" : "/10", rd.weakest ? `weakest: ${esc(rd.weakest.part.name)}` : "no rated parts", rd.min == null ? null : rd.min / 10, rd.min == null ? "" : rd.min < 4 ? "bad" : rd.min < 7 ? "warn" : ""));
  g.push(gauge("Parts cost", euro(sys.cost), "", "list prices, excl. harness and VAT mix", null, sys.cost > req.maxCost ? "warn" : ""));
  const R = sys.resp;
  if (R.mode !== "warn" && !R.staticShield) {
    const aim90 = R.aim ? R.aim.time(Math.min(90, R.aim.range / 2)) : 0;
    const tot = R.drvMs + aim90 + R.deployMs;
    g.push(gauge("Response time", fmtMs(tot).replace(/ (ms|s)$/, ""), / s$/.test(fmtMs(tot)) ? "s" : "ms", `driver ${fmt(R.drvMs, 1)} · slew 90° ${fmt(aim90, 0)} · deploy ${fmt(R.deployMs, 0)}`, null));
  }
  $("gauges").innerHTML = g.join("");

  const items = sys.items;
  $("massBar").innerHTML = items.map((it) => `<div title="${esc(it.name)}: ${fmt(it.mass * 1000, 0)} g" style="width:${(it.mass / sys.added) * 100}%;background:var(${it.color})"></div>`).join("");
  $("massLegend").innerHTML = items.map((it) => `<span><i style="background:var(${it.color})"></i>${esc(it.name)} <em>${it.mass >= 1 ? kgTxt(it.mass) : fmt(it.mass * 1000, 0) + " g"}</em></span>`).join("");
  $("massTotal").textContent = `${kgTxt(sys.added)} · CoM ${sys.comDy >= 0 ? "+" : ""}${fmt(sys.comDy, 1)} mm up, ${fmt(sys.comDz, 1)} mm fore/aft`;

  $("readyTbl").innerHTML = `<thead><tr><th>Slot</th><th>Part</th><th class="n">Rating</th><th>Verified</th><th class="n">Est. fields</th></tr></thead><tbody>${rd.slots.map((s) =>
    `<tr title="${esc(s.part.note || "")}"><td>${s.slot}${s.slot === "Aim actuator" && SYS.resp.axes > 1 ? " ×2" : ""}</td><td class="wrapcell">${esc(s.part.name)}${s.part.shortlist ? ' <span class="star">★</span>' : ""}</td><td class="n">${ratingChip(s.part)}</td><td>${statusChip(s.part)}</td><td class="n">${(s.part.est || []).length || "—"}</td></tr>`).join("")}</tbody>`;
  $("readySummary").textContent = rd.min == null ? "no rated parts" : `weakest ${rd.min}/10 · mean ${fmt(rd.mean, 1)}${rd.unrated.length ? ` · ${rd.unrated.length} unrated` : ""}`;

  const all = sys.issues.concat(EVAL.violations);
  $("issues").innerHTML = all.length ? all.map((i) => `<li class="${i.level}"><i></i><span>${esc(i.msg)}</span></li>`).join("")
    : '<li class="ok"><i></i><span>No configuration problems, and every requirement in the scenario panel is met.</span></li>';
  const nb = all.filter((i) => i.level === "bad").length, nw = all.length - nb;
  $("issueCount").textContent = all.length ? `${nb} blocking · ${nw} warning${nw === 1 ? "" : "s"}` : "all clear";

  const st = [];
  st.push(`<span class="chip ${sys.added > req.maxMass ? "bad" : sys.added > req.maxMass * 0.85 ? "warn" : "ok"}"><i></i>${fmt(sys.added, 2)} kg added</span>`);
  st.push(`<span class="chip ${sys.runtimeH < req.minRuntime ? "bad" : "ok"}"><i></i>${fmt(sys.runtimeH, 1)} h runtime</span>`);
  st.push(`<span class="chip ${rd.min == null ? "" : rd.min < 4 ? "bad" : rd.min < 7 ? "warn" : "ok"}"><i></i>readiness ${rd.min == null ? "—" : rd.min + "/10"}</span>`);
  st.push(`<span class="chip ${nb ? "bad" : nw ? "warn" : "ok"}"><i></i>${nb ? nb + " blocking" : nw ? nw + (nw === 1 ? " warning" : " warnings") : "checks pass"}</span>`);
  if (PERF) st.push(`<span class="chip"><i style="background:var(--accent)"></i>${goalLabel(PERF.mode)} ${pct(PERF.goal)}</span>`);
  $("statusStrip").innerHTML = st.join("");
}
const goalLabel = (mode) => (mode === "warn" ? "warned in time" : mode === "mech" ? "mechanism in time" : "protected");
