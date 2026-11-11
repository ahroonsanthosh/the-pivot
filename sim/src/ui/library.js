/* ================================================================== parts library: browse, edit, import / export */
const LIB_TABS = CAT.CATEGORY_ORDER.map((c) => [c, CAT.CATEGORIES[c].label]).concat([["threat", "Threats"]]);
let EDIT = null;   // { kind: "part" | "threat", cat, id, isNew, draft }
const USE_SLOTS = {
  camera: () => [["camera", "Use"]], lens: () => [["lens", "Use"]], radar: () => [["radar", "Use"]], compute: () => [["compute", "Use"]],
  controller: () => [["controller", "Use"]], driver: () => [["driver", "Use"]], shield: () => [["shield", "Use"]],
  actuator: (p) => (p.kind === "linear" ? [["deploy", "Use to deploy"]] : [["aim", "Use to aim"], ["deploy", "Use to deploy"]]),
  structure: (p) => [[p.role === "gearing" ? "gearing" : "frame", "Use"]],
  pneumatic: (p) => [[{ source: "pSource", valve: "pValve", line: "pLine" }[p.role], "Use"]],
};
const inUse = (p) => Object.entries(S.build).some(([k, v]) => v === p.id && !(k === "deploy" && p.cat !== "actuator"));

function fieldList(kind, cat) {
  if (kind === "threat") return CAT.THREAT_FIELDS;
  return CAT.COMMON_FIELDS.concat(CAT.CATEGORIES[cat].fields);
}
function showVal(f, v) {
  if (v == null || v === "") return "—";
  if (f.type === "sel") { const o = f.opts.find(([x]) => x === v); return o ? o[1] : v; }
  if (f.type === "bool") return v ? "yes" : "no";
  if (f.type === "list") return (v || []).join(", ");
  if (typeof v === "number") return (Math.abs(v) < 0.01 && v !== 0 ? v.toExponential(1) : +v.toFixed(4)) + (f.unit ? " " + f.unit : "");
  return String(v);
}
function renderLibTabs() {
  $("libTabs").innerHTML = LIB_TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${S.libTab === k}">${l}<em>${k === "threat" ? THREATS.length : partsOf(k).length}</em></button>`).join("");
}
function renderLibGrid() {
  const tab = S.libTab, grid = $("libGrid");
  if (tab === "threat") {
    grid.innerHTML = THREATS.map((t) => {
      const th = E.threatSI(t), tof = E.tAtDist(t.rmax, th.v0, th.lam) * 1000;
      const dl = CAT.THREAT_FIELDS.filter((f) => !["name", "short", "note", "group"].includes(f.k)).map((f) => `<dt>${f.label}</dt><dd>${esc(showVal(f, t[f.k]))}</dd>`).join("");
      return `<article class="part"><header><div><span class="tag">${esc({ small: "Small arms", explosive: "Explosive", aerial: "Aerial", ref: "Reference" }[t.group] || t.group)}${t.custom ? " · " + t.custom : ""}</span><h3>${esc(t.name)}</h3></div></header>
        <p class="role">${esc(t.note || "")} Flight over ${t.rmax} m: ${fmtMs(tof)}${th.lam !== Infinity ? `; drag length ${Math.round(th.lam)} m` : ""}.</p><dl>${dl}</dl>
        <div class="btnrow"><button class="btn small" type="button" data-act="edit" data-id="${esc(t.id)}">Edit</button><button class="btn small" type="button" data-act="dup" data-id="${esc(t.id)}">Duplicate</button>${t.custom === "edited" ? `<button class="btn small" type="button" data-act="restore" data-id="${esc(t.id)}">Restore default</button>` : ""}<button class="btn small danger" type="button" data-act="del" data-id="${esc(t.id)}">Delete</button></div></article>`;
    }).join("");
  } else {
    const fields = CAT.CATEGORIES[tab].fields;
    grid.innerHTML = partsOf(tab).map((p) => {
      const est = new Set(p.est || []);
      const rows = [["mass", "Mass", p.cat === "shield" ? fmt(shieldMassG(p), 0) + " g" : showVal({ unit: "g" }, p.mass)], ["power", "Power", showVal({ unit: "W" }, p.power)], ["cost", "Cost", p.cost ? euro(p.cost) : "—"], ["dims", "Size (mm)", p.dims || "—"]]
        .map(([k, l, v]) => `<dt>${l}</dt><dd class="${est.has(k) ? "est" : ""}">${esc(v)}</dd>`).join("")
        + fields.filter((f) => !(f.hide && f.hide(p))).map((f) => `<dt>${f.label}</dt><dd class="${est.has(f.k) ? "est" : ""}">${esc(showVal(f, p[f.k]))}</dd>`).join("");
      const uses = (USE_SLOTS[p.cat] ? USE_SLOTS[p.cat](p) : []).map(([slot, l]) => `<button class="btn small" type="button" data-act="use" data-slot="${slot}" data-id="${esc(p.id)}">${l}</button>`).join("");
      const src = (p.src || []).filter((s) => s && s.url).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label || s.url)}</a>`).join("");
      return `<article class="part ${inUse(p) ? "inuse" : ""}"><header><div><span class="tag">${esc(CAT.CATEGORIES[p.cat].one)}${p.shortlist ? " · retained ★" : ""}${p.custom ? " · " + p.custom : ""}${inUse(p) ? " · in build" : ""}</span><h3>${esc(p.name)}</h3><div class="vendor">${esc(p.vendor || "")}</div></div>${ratingChip(p)}</header>
        ${p.note ? `<p class="why">${esc(p.note)}</p>` : ""}${p.desc ? `<p class="role">${esc(p.desc)}</p>` : ""}<dl>${rows}</dl>${src ? `<div class="src">${src}</div>` : ""}
        <div class="btnrow">${uses}<button class="btn small" type="button" data-act="edit" data-id="${esc(p.id)}">Edit</button><button class="btn small" type="button" data-act="dup" data-id="${esc(p.id)}">Duplicate</button>${p.custom === "edited" ? `<button class="btn small" type="button" data-act="restore" data-id="${esc(p.id)}">Restore default</button>` : ""}<button class="btn small danger" type="button" data-act="del" data-id="${esc(p.id)}">Delete</button></div></article>`;
    }).join("") || `<p class="note">No parts in this category. Add one with the button above.</p>`;
  }
  const hidden = tab === "threat" ? (S.custom.threatsDeleted || []).length : (S.custom.deleted || []).filter((id) => { const p = CAT.PARTS.find((x) => x.id === id); return p && p.cat === tab; }).length;
  if (hidden) grid.insertAdjacentHTML("beforeend", `<div class="panel"><p class="note">${hidden} built-in ${tab === "threat" ? "threat" : "part"}${hidden === 1 ? " is" : "s are"} hidden in this category.</p><div class="btnrow" style="margin-top:8px"><button class="btn small" type="button" data-act="unhide">Show them again</button></div></div>`);
  const nParts = Object.keys(S.custom.parts).length, nThreats = Object.keys(S.custom.threats).length, nDel = (S.custom.deleted || []).length + (S.custom.threatsDeleted || []).length;
  $("libCount").textContent = `${LIB.parts.length} parts · ${THREATS.length} threats · ${nParts + nThreats} edited or added · ${nDel} hidden`;
}
function renderLibrary() { renderLibTabs(); renderLibGrid(); if (!$("libJson").matches(":focus")) $("libJson").value = changesJson(); }

/* ------------------------------------------------------------------ editor */
function openEditor(kind, cat, id, mode) {
  let draft;
  if (mode === "new") {
    const tmpl = kind === "threat" ? THREATS[0] : partsOf(cat)[0] || {};
    draft = { ...clone(tmpl), name: kind === "threat" ? "New threat" : `New ${CAT.CATEGORIES[cat].one.toLowerCase()}`, vendor: "", rating: null, note: "", desc: "", shortlist: false, src: [], est: [] };
    if (kind === "part") draft.cat = cat;
  } else {
    const src = kind === "threat" ? threatById(id) : LIB.byId[id];
    draft = clone(src); delete draft.custom;
    if (mode === "dup") { draft.name = draft.name + " (copy)"; }
  }
  const isNew = mode !== "edit";
  if (isNew) { const base = slug(draft.name); let nid = base, n = 2; const taken = (x) => (kind === "threat" ? THREATS.some((t) => t.id === x) : !!LIB.byId[x]) || CAT.PARTS.some((p) => p.id === x); while (taken(nid)) nid = `${base}-${n++}`; draft.id = nid; }
  EDIT = { kind, cat, id: draft.id, isNew, draft };
  renderEditor();
  $("editor").scrollIntoView({ block: "nearest" });
}
function fieldInput(f, v, est) {
  const id = "ed_" + f.k, help = f.help ? `<small class="help">${esc(f.help)}</small>` : "";
  const estBox = f.type === "num" ? `<label class="estbox"><input type="checkbox" data-est="${f.k}" ${est ? "checked" : ""}> est.</label>` : "";
  const head = `<span>${esc(f.label)}${f.unit ? ` (${esc(f.unit)})` : ""} ${estBox}</span>`;
  if (f.type === "textarea") return `<label class="f full">${head}<textarea id="${id}" data-k="${f.k}" rows="2">${esc(v || "")}</textarea>${help}</label>`;
  if (f.type === "sel") return `<label class="f">${head}<select id="${id}" data-k="${f.k}">${f.opts.map(([o, l]) => `<option value="${esc(o)}" ${o === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>${help}</label>`;
  if (f.type === "bool") return `<label class="check f"><input type="checkbox" id="${id}" data-k="${f.k}" ${v ? "checked" : ""}> ${esc(f.label)}</label>`;
  if (f.type === "list") return `<label class="f">${head}<input type="text" id="${id}" data-k="${f.k}" value="${esc((v || []).join(", "))}">${help}</label>`;
  if (f.type === "num") return `<label class="f">${head}<input type="number" id="${id}" data-k="${f.k}" value="${v == null ? "" : v}" ${f.min != null ? `min="${f.min}"` : ""} ${f.max != null ? `max="${f.max}"` : ""} step="any" ${f.nullable ? 'placeholder="not rated"' : ""}>${help}</label>`;
  return `<label class="f">${head}<input type="text" id="${id}" data-k="${f.k}" value="${esc(v == null ? "" : v)}">${help}</label>`;
}
function renderEditor() {
  const ed = $("editor");
  if (!EDIT) { ed.hidden = true; ed.innerHTML = ""; return; }
  const d = EDIT.draft, fields = fieldList(EDIT.kind, EDIT.cat).filter((f) => !(f.hide && f.hide(d))), est = new Set(d.est || []);
  const what = EDIT.kind === "threat" ? "threat" : CAT.CATEGORIES[EDIT.cat].one.toLowerCase();
  ed.hidden = false;
  ed.innerHTML = `<div class="panel-head"><h3>${EDIT.isNew ? `New ${what}` : `Edit ${esc(d.name)}`}</h3><span class="mono">id ${esc(d.id)}${!EDIT.isNew && (EDIT.kind === "threat" ? CAT.THREATS : CAT.PARTS).some((x) => x.id === d.id) ? " · built-in, saved as an override" : ""}</span></div>
    <form id="edForm" autocomplete="off">
      ${EDIT.isNew ? `<label class="f"><span>Id (letters, digits, dashes)</span><input type="text" id="ed_id" value="${esc(d.id)}" pattern="[a-z0-9-]+"></label>` : ""}
      ${fields.map((f) => fieldInput(f, d[f.k], est.has(f.k))).join("")}
      ${EDIT.kind === "part" ? `<label class="f full"><span>Sources, one per line as "label | https://…"</span><textarea id="ed_src" rows="2">${esc((d.src || []).map((s) => (s.label ? s.label + " | " : "") + (s.url || "")).join("\n"))}</textarea></label>` : ""}
      <div class="btnrow full"><button class="btn primary" type="submit">Save ${what}</button><button class="btn" type="button" id="edCancel">Cancel</button><span class="toast bad" id="edMsg" role="status"></span></div>
    </form>`;
  const form = $("edForm");
  const read = () => {
    for (const f of fieldList(EDIT.kind, EDIT.cat)) {
      const el = $("ed_" + f.k); if (!el) continue;
      if (f.type === "bool") d[f.k] = el.checked;
      else if (f.type === "num") { const t = el.value.trim(); d[f.k] = t === "" ? (f.nullable ? null : d[f.k]) : +t; }
      else if (f.type === "list") d[f.k] = el.value.split(",").map((x) => x.trim()).filter(Boolean);
      else d[f.k] = el.value;
    }
    d.est = [...form.querySelectorAll("[data-est]")].filter((x) => x.checked).map((x) => x.dataset.est).concat((d.est || []).filter((k) => !form.querySelector(`[data-est="${k}"]`)));
    if ($("ed_src")) d.src = $("ed_src").value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.lastIndexOf("|"); return i >= 0 ? { label: l.slice(0, i).trim(), url: l.slice(i + 1).trim() } : { label: l, url: l }; });
    if ($("ed_id")) d.id = slug($("ed_id").value);
  };
  form.addEventListener("change", (e) => { if (e.target.tagName === "SELECT") { read(); renderEditor(); } });
  form.addEventListener("submit", (e) => {
    e.preventDefault(); read();
    const msg = $("edMsg");
    if (!d.name || !d.name.trim()) { msg.textContent = "Give it a name."; return; }
    if (d.rating != null && !(d.rating >= 0 && d.rating <= 10)) { msg.textContent = "Ratings run from 0 to 10, or leave it blank for unrated."; return; }
    if (EDIT.isNew && ((EDIT.kind === "threat" ? THREATS.some((t) => t.id === d.id) : LIB.byId[d.id]))) { msg.textContent = `The id "${d.id}" is taken. Choose another.`; return; }
    if (EDIT.kind === "threat") {
      if (!(d.v0 > 0) || !(d.rmax > d.rmin)) { msg.textContent = "Speed must be positive and the maximum distance above the minimum."; return; }
      S.custom.threats[d.id] = d;
    } else {
      if (d.cat === "shield" && d.w && d.h && d.areal) d.mass = +(d.w / 1000 * d.h / 1000 * d.areal * 1000).toFixed(1);
      S.custom.parts[d.id] = d;
    }
    EDIT = null; renderEditor(); onLibraryChanged();
  });
  $("edCancel").addEventListener("click", () => { EDIT = null; renderEditor(); });
}

/* ------------------------------------------------------------------ JSON in and out */
function changesJson() {
  return JSON.stringify({ format: "aps-sim-library", version: 1, parts: Object.values(S.custom.parts), deleted: S.custom.deleted || [], threats: Object.values(S.custom.threats), threatsDeleted: S.custom.threatsDeleted || [] }, null, 2);
}
function fullJson() {
  const strip = (x) => { const y = clone(x); delete y.custom; return y; };
  return JSON.stringify({ format: "aps-sim-library", version: 1, full: true, parts: LIB.parts.map(strip), threats: THREATS.map(strip) }, null, 2);
}
function applyJson(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return { ok: false, msg: "That is not valid JSON. Check for a missing bracket or comma." }; }
  const parts = Array.isArray(data) ? data : data.parts || [];
  let np = 0, nt = 0, skipped = 0;
  for (const p of parts) { if (p && p.id && p.cat && CAT.CATEGORIES[p.cat] && p.name) { S.custom.parts[p.id] = p; np++; } else skipped++; }
  for (const t of data.threats || []) { if (t && t.id && t.name && t.v0 > 0) { S.custom.threats[t.id] = t; nt++; } else skipped++; }
  if (Array.isArray(data.deleted)) S.custom.deleted = [...new Set([...(S.custom.deleted || []), ...data.deleted])];
  if (Array.isArray(data.threatsDeleted)) S.custom.threatsDeleted = [...new Set([...(S.custom.threatsDeleted || []), ...data.threatsDeleted])];
  if (!np && !nt && !skipped) return { ok: false, msg: "No parts or threats found. Expect an object with a parts array, or an array of parts." };
  onLibraryChanged();
  return { ok: true, msg: `Loaded ${np} part${np === 1 ? "" : "s"} and ${nt} threat${nt === 1 ? "" : "s"}${skipped ? `; skipped ${skipped} entries missing an id, category or name` : ""}.` };
}
function toast(msg, ok) { const t = $("libToast"); t.textContent = msg; t.className = "toast" + (ok ? "" : " bad"); }

function initLibrary() {
  $("libTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (!b) return; S.libTab = b.dataset.tab; EDIT = null; renderEditor(); renderLibrary(); persist(); });
  $("btnNewPart").addEventListener("click", () => openEditor(S.libTab === "threat" ? "threat" : "part", S.libTab === "threat" ? null : S.libTab, null, "new"));
  $("libGrid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const act = b.dataset.act, id = b.dataset.id, isThreat = S.libTab === "threat";
    if (act === "edit" || act === "dup") openEditor(isThreat ? "threat" : "part", isThreat ? null : S.libTab, id, act);
    else if (act === "use") {
      const slot = b.dataset.slot; S.build[slot] = id;
      if (slot.startsWith("p")) S.build.deploy = "pneumatic";
      if (slot === "radar" && !(S.build.radars >= 1)) S.build.radars = 1;
      if (slot === "camera" && !(S.build.pods >= 1)) S.build.pods = 4;
      onBuildChanged(); toast(`${LIB.byId[id].name} is now in the build.`, true);
    } else if (act === "restore") { if (isThreat) delete S.custom.threats[id]; else delete S.custom.parts[id]; onLibraryChanged(); }
    else if (act === "unhide") { if (isThreat) S.custom.threatsDeleted = []; else S.custom.deleted = (S.custom.deleted || []).filter((x) => { const p = CAT.PARTS.find((q) => q.id === x); return p && p.cat !== S.libTab; }); onLibraryChanged(); }
    else if (act === "del") {
      if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Confirm delete"; return; }
      if (isThreat) { if (THREATS.length <= 1) return; delete S.custom.threats[id]; if (CAT.THREATS.some((t) => t.id === id)) S.custom.threatsDeleted = [...new Set([...(S.custom.threatsDeleted || []), id])]; }
      else { delete S.custom.parts[id]; if (CAT.PARTS.some((p) => p.id === id)) S.custom.deleted = [...new Set([...(S.custom.deleted || []), id])]; }
      onLibraryChanged();
    }
  });
  $("btnCopyLib").addEventListener("click", async () => { const t = changesJson(); $("libJson").value = t; toast((await copyText(t, $("libJson"))) ? "Changes copied." : "Clipboard blocked: the JSON is selected in the box, copy it from there.", true); });
  $("btnCopyFull").addEventListener("click", async () => { const t = fullJson(); $("libJson").value = t; toast((await copyText(t, $("libJson"))) ? "Full library copied." : "Clipboard blocked: the JSON is selected in the box, copy it from there.", true); });
  $("btnApplyLib").addEventListener("click", () => { const r = applyJson($("libJson").value); toast(r.msg, r.ok); });
  $("libFile").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { $("libJson").value = String(rd.result); const r = applyJson(String(rd.result)); toast(r.msg, r.ok); };
    rd.onerror = () => toast("Could not read that file.", false);
    rd.readAsText(f); e.target.value = "";
  });
  $("btnResetLib").addEventListener("click", (e) => {
    const b = e.currentTarget;
    if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Click again to reset everything"; setTimeout(() => { delete b.dataset.armed; b.textContent = "Reset library to defaults"; }, 4000); return; }
    S.custom = { parts: {}, deleted: [], threats: {}, threatsDeleted: [] }; delete b.dataset.armed; b.textContent = "Reset library to defaults";
    onLibraryChanged(); toast("Library reset to the built-in catalogue.", true);
  });
}
