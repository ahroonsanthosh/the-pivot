/* ================================================================== verification: desk findings tested in the sim */
const VERIFY = { results: null, running: false, at: null, ctx: null };
const VERDICT_CLS = { pass: "ok", fail: "bad", depends: "warn", info: "na", na: "na" };
const verdictChip = (v) => `<span class="vchip ${VERDICT_CLS[v] || "na"}">${esc(window.APSVerify.VERDICTS[v] || v)}</span>`;

function verifyCtx() {
  return window.APSVerify.context({ parts: LIB.parts, threats: THREATS, scen: { env: S.scen.env, activity: S.scen.activity, needMs: S.scen.needMs }, req: S.req, rounds: +$("vf_rounds").value || 300 });
}
async function runVerify() {
  if (VERIFY.running || !window.APSVerify) return;
  VERIFY.running = true; $("vf_run").disabled = true; $("vf_copy").disabled = true; $("vf_prog").hidden = false;
  const ctx = verifyCtx(), checks = window.APSVerify.CHECKS, out = [], bar = $("vf_prog").firstElementChild;
  for (let i = 0; i < checks.length; i++) {
    $("vf_meta").textContent = `Running ${i + 1} of ${checks.length}: ${checks[i].title}`;
    await new Promise((r) => setTimeout(r, 0));
    out.push(window.APSVerify.runCheck(checks[i], ctx));
    bar.style.width = ((i + 1) / checks.length) * 100 + "%";
    VERIFY.results = out.slice(); renderVerify();
  }
  VERIFY.running = false; VERIFY.at = new Date(); VERIFY.ctx = ctx;
  $("vf_run").disabled = false; $("vf_copy").disabled = false;
  setTimeout(() => { $("vf_prog").hidden = true; }, 400);
  renderVerify();
}
function partLine(id) {
  const p = LIB.byId[id];
  if (!p) return `<span class="muted">${esc(id)} (not in library)</span>`;
  return `<span class="vpart">${esc(p.name)} ${ratingChip(p)} ${statusChip(p)}</span>`;
}
function renderVerify() {
  const res = VERIFY.results, checks = window.APSVerify ? window.APSVerify.CHECKS : [];
  const byId = Object.fromEntries((res || []).map((r) => [r.id, r]));
  let h = `<thead><tr><th>Check</th><th>Parts and desk status</th><th>Sim verdict</th><th>Key result</th></tr></thead><tbody>`;
  checks.forEach((c) => {
    const r = byId[c.id];
    h += `<tr><td class="wrapcell"><a href="#vf-${c.id}">${esc(c.title)}</a></td><td class="wrapcell"><div class="vparts">${c.parts.map(partLine).join("")}</div></td><td>${r ? verdictChip(r.verdict) : '<span class="muted">not run</span>'}</td><td class="wrapcell vhead">${r ? esc(r.headline) : ""}</td></tr>`;
  });
  $("vf_summary").innerHTML = h + "</tbody>";
  $("vf_cards").innerHTML = checks.map((c) => {
    const r = byId[c.id];
    const desk = c.parts.map((id) => LIB.byId[id]).filter((p) => p && p.statusNote).map((p) => `<li><b>${esc(p.name)}.</b> ${esc(p.statusNote)}</li>`).join("");
    let body = `<p class="vq"><b>Question.</b> ${esc(c.question)}</p><p class="note"><b>Method.</b> ${esc(c.method)}</p>`;
    if (desk) body += `<details class="vdesk"><summary>Desk findings for these parts</summary><ul>${desk}</ul></details>`;
    if (r) {
      body += `<p class="vresult">${esc(r.headline)}</p>`;
      if (r.table) body += `<div class="tbl-wrap"><table><thead><tr>${r.table.head.map((x, i) => `<th class="${i ? "n" : ""}">${esc(x)}</th>`).join("")}</tr></thead><tbody>${r.table.rows.map((row) => `<tr>${row.map((x, i) => `<td class="${i ? "n" : "wrapcell"}">${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      if (r.findings && r.findings.length) body += `<div><h4>What the sim shows</h4><ul class="assume">${r.findings.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>`;
      if (r.sens && r.sens.length) body += `<div><h4>What would change the verdict</h4><ul class="assume">${r.sens.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>`;
    } else body += `<p class="note">Run the checks to see the result.</p>`;
    return `<article class="panel vcard" id="vf-${c.id}"><header class="panel-head"><h3>${esc(c.title)}</h3>${r ? verdictChip(r.verdict) : ""}</header>${body}</article>`;
  }).join("");
  if (!VERIFY.running) {
    const n = res ? res.length : 0;
    $("vf_meta").textContent = n ? `${n} checks · ${VERIFY.ctx ? VERIFY.ctx.rounds : ""} rounds per case · ${res.reduce((a, r) => a + r.ms, 0) / 1000 < 1 ? "<1" : Math.round(res.reduce((a, r) => a + r.ms, 0) / 1000)} s` : "Not run yet";
  }
}
function initVerify() {
  if (!window.APSVerify) { $("vf_meta").textContent = "Verification module did not load."; return; }
  $("vf_run").addEventListener("click", runVerify);
  $("vf_copy").addEventListener("click", async () => {
    if (!VERIFY.results) return;
    const text = window.APSVerify.report(VERIFY.results, VERIFY.ctx, { date: VERIFY.at ? VERIFY.at.toISOString().slice(0, 10) : "" });
    const ok = await copyText(text, $("vf_md"));
    $("vf_copy").textContent = ok ? "Copied" : "Select and copy below"; setTimeout(() => { $("vf_copy").textContent = "Copy report (Markdown)"; }, 1800);
  });
  renderVerify();
}
