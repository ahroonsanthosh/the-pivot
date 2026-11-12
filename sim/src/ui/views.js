/* ================================================================== coverage map */
function renderCoverage() {
  const cv = $("covCanvas"), wrap = cv.parentElement;
  const W = Math.max(300, wrap.clientWidth), H = Math.round(Math.min(380, Math.max(200, W * 0.34)));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + "px";
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const Lm = 38, Rm = 10, Tm = 18, Bm = 24, pw = W - Lm - Rm, ph = H - Tm - Bm;
  const G = E.GRID, cw = pw / G.nAz, ch = ph / G.nEl, cov = SYS.coverage;
  cv._geom = { Lm, Tm, pw, ph, cw, ch };
  ctx.fillStyle = tok("--surface-2"); ctx.fillRect(Lm, Tm, pw, ph);
  const cSensor = tok("--sensor"), cRadar = tok("--radar"), cKit = tok("--kit");
  const cx0 = (i) => Math.round(Lm + i * cw), cy0 = (j) => Math.round(Tm + ph - j * ch);
  for (let j = 0; j < G.nEl; j++) for (let i = 0; i < G.nAz; i++) {
    const idx = j * G.nAz + i, x = cx0(i), w = cx0(i + 1) - x, y = cy0(j + 1), hh = cy0(j) - y, n = cov.cam[idx];
    if (n > 0) { ctx.globalAlpha = Math.min(0.92, 0.34 + 0.24 * (n - 1)); ctx.fillStyle = cSensor; ctx.fillRect(x, y, w, hh); }
    else if (cov.occ[idx]) { ctx.globalAlpha = 0.55; ctx.fillStyle = cKit; ctx.fillRect(x, y, w, hh); }
    if (cov.rad[idx]) { ctx.globalAlpha = 0.22; ctx.fillStyle = cRadar; ctx.fillRect(x, y, w, hh); }
  }
  ctx.globalAlpha = 1; ctx.strokeStyle = cRadar; ctx.lineWidth = 2; ctx.beginPath();
  for (let j = 0; j < G.nEl; j++) for (let i = 0; i < G.nAz; i++) {
    const idx = j * G.nAz + i; if (!cov.rad[idx]) continue;
    const x = cx0(i), x1 = cx0(i + 1), y = cy0(j + 1), y1 = cy0(j);
    if (i === 0 || !cov.rad[idx - 1]) { ctx.moveTo(x, y); ctx.lineTo(x, y1); }
    if (i === G.nAz - 1 || !cov.rad[idx + 1]) { ctx.moveTo(x1, y); ctx.lineTo(x1, y1); }
    if (j === G.nEl - 1 || !cov.rad[idx + G.nAz]) { ctx.moveTo(x, y); ctx.lineTo(x1, y); }
    if (j === 0 || !cov.rad[idx - G.nAz]) { ctx.moveTo(x, y1); ctx.lineTo(x1, y1); }
  }
  ctx.stroke(); ctx.lineWidth = 1;
  const X = (az) => Lm + ((az + 180) / 360) * pw, Y = (el) => Tm + ph - ((el - G.el0) / (G.nEl * G.step)) * ph;
  ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillStyle = tok("--muted"); ctx.strokeStyle = tok("--line"); ctx.lineWidth = 1;
  for (let az = -180; az <= 180; az += 45) { ctx.beginPath(); ctx.moveTo(X(az), Tm); ctx.lineTo(X(az), Tm + ph); ctx.stroke(); ctx.textAlign = az === -180 ? "left" : az === 180 ? "right" : "center"; ctx.fillText(az + "°", X(az), H - 8); }
  ctx.textAlign = "right";
  for (let el = -40; el <= 80; el += 20) { ctx.beginPath(); ctx.moveTo(Lm, Y(el)); ctx.lineTo(Lm + pw, Y(el)); ctx.stroke(); ctx.fillText(el + "°", Lm - 5, Y(el) + 3); }
  ctx.strokeStyle = tok("--ink"); ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(Lm, Y(0)); ctx.lineTo(Lm + pw, Y(0)); ctx.stroke(); ctx.setLineDash([]);
  ctx.textAlign = "center"; ctx.fillStyle = tok("--muted");
  [["behind", -180], ["left", -90], ["front", 0], ["right", 90], ["behind", 180]].forEach(([t, az]) => { ctx.textAlign = az === -180 ? "left" : az === 180 ? "right" : "center"; ctx.fillText(t, X(az), Tm - 6); });
  const R = SYS.resp;
  if (R.aim) {
    const h = R.aim.range / 2; ctx.strokeStyle = tok("--resp"); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(X(-Math.min(h, 180)), Tm + ph - 1.5); ctx.lineTo(X(Math.min(h, 180)), Tm + ph - 1.5); ctx.stroke(); ctx.lineWidth = 1;
  }
  const sx = X(E.wrap180(S.shot.az)), sy = Y(Math.max(-40, Math.min(80, S.shot.el)));
  ctx.strokeStyle = tok("--bad"); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.moveTo(sx - 10, sy); ctx.lineTo(sx + 10, sy); ctx.moveTo(sx, sy - 10); ctx.lineTo(sx, sy + 10); ctx.stroke(); ctx.lineWidth = 1;

  const share = (fn, el0, el1) => { let t = 0, h = 0; for (let j = 0; j < G.nEl; j++) { const el = G.el0 + (j + 0.5) * G.step; if (el < el0 || el > el1) continue; const w = Math.cos(el * Math.PI / 180); for (let i = 0; i < G.nAz; i++) { t += w; if (fn(j * G.nAz + i)) h += w; } } return t ? h / t : 0; };
  const cam = (i) => cov.cam[i] > 0, rad = (i) => cov.rad[i] > 0, either = (i) => cam(i) || rad(i), multi = (i) => cov.cam[i] > 1, occ = (i) => cov.occ[i] > 0 && !cov.cam[i];
  const tile = (title, a, b, c) => `<div class="gauge"><span class="eyebrow">${title}</span><span class="v">${a}</span><span class="s">${b}</span>${c ? `<span class="s">${c}</span>` : ""}</div>`;
  $("covStats").innerHTML = [
    tile("Ground band −10° to +20°", pct(share(either, -10, 20)), `cameras ${pct(share(cam, -10, 20))} · radar ${pct(share(rad, -10, 20))}`),
    tile("Air band +20° to +80°", pct(share(either, 20, 80)), `cameras ${pct(share(cam, 20, 80))} · radar ${pct(share(rad, 20, 80))}`),
    tile("Seen by two or more pods", pct(share(multi, -10, 20)), "of the ground band; overlap raises per-frame detection"),
    tile("Blocked by body or pack", pct(share(occ, -40, 80)), "directions a pod faces but cannot see"),
  ].join("");
  $("covLegend").innerHTML = [["--sensor", "1 pod", 0.45], ["--sensor", "2+ pods", 0.85], ["--radar", "radar cover (outlined)", 0.5], ["--kit", "blocked by body or pack", 0.6], ["--resp", "aiming actuator reach", 1], ["--bad", "current test round", 1]]
    .map(([c, t, a]) => `<span><i style="background:var(${c});opacity:${a}"></i>${t}</span>`).join("");
}
function wireCoverage() {
  const cv = $("covCanvas"), tip = $("covTip");
  cv.addEventListener("pointermove", (e) => {
    const g = cv._geom; if (!g) return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const i = Math.floor((x - g.Lm) / g.cw), j = E.GRID.nEl - 1 - Math.floor((y - g.Tm) / g.ch);
    if (i < 0 || i >= E.GRID.nAz || j < 0 || j >= E.GRID.nEl) { tip.hidden = true; return; }
    const idx = j * E.GRID.nAz + i, az = E.GRID.az0 + (i + 0.5) * E.GRID.step, el = E.GRID.el0 + (j + 0.5) * E.GRID.step, cov = SYS.coverage;
    tip.innerHTML = `<b>${az > 0 ? "+" : ""}${az}° bearing, ${el > 0 ? "+" : ""}${el}° elevation</b><span>${cov.cam[idx]} camera pod${cov.cam[idx] === 1 ? "" : "s"}${cov.occ[idx] ? " · partly blocked" : ""} · ${cov.rad[idx] ? cov.rad[idx] + " radar" : "no radar"}</span>`;
    tip.hidden = false; tip.style.left = Math.min(x + 14, r.width - 250) + "px"; tip.style.top = y + 14 + "px";
  });
  cv.addEventListener("pointerleave", () => { tip.hidden = true; });
  cv.addEventListener("click", (e) => {
    const g = cv._geom; if (!g) return; const r = cv.getBoundingClientRect();
    S.shot.az = Math.round(-180 + ((e.clientX - r.left - g.Lm) / g.pw) * 360);
    S.shot.el = Math.round(80 - ((e.clientY - r.top - g.Tm) / g.ph) * 120);
    S.shot.az = Math.max(-180, Math.min(180, S.shot.az)); S.shot.el = Math.max(-40, Math.min(80, S.shot.el));
    syncShotRail(); onShotChanged();
  });
}

/* ================================================================== one round */
function renderShotRail() {
  $("shotRail").innerHTML = `
    <fieldset><legend>Threat</legend>
      <label class="f"><span>Projectile</span><select id="s_threat"></select><small class="hint" id="s_threatHint"></small></label>
      <label class="f"><span>Firing distance <b id="s_r0Out"></b></span><input type="range" id="s_r0" step="1"></label>
      <label class="f"><span>Bearing from the wearer's front <b id="s_azOut"></b></span><input type="range" id="s_az" min="-180" max="180" step="1"></label>
      <label class="f"><span>Arrival elevation <b id="s_elOut"></b></span><input type="range" id="s_el" min="-40" max="80" step="1"></label>
      <label class="f"><span>Frame clock phase <b id="s_phOut"></b></span><input type="range" id="s_ph" min="0" max="0.99" step="0.01"></label>
      <div class="btnrow"><button class="btn" type="button" id="s_seed">Re-roll detection noise</button><span class="mono muted" id="s_seedOut"></span></div>
    </fieldset>
    <fieldset><legend>Trace window</legend>
      <div class="seg" id="s_win" role="group" aria-label="Trace window"><button type="button" data-v="final">Final approach</button><button type="button" data-v="full">Whole flight</button></div>
    </fieldset>
    <p class="note">Click the coverage map to aim a round from that direction.</p>`;
  const f = $("shotRail");
  f.addEventListener("input", (e) => {
    const id = e.target.id; if (!id.startsWith("s_") || e.target.type !== "range") return;
    S.shot[id.slice(2)] = +e.target.value; syncShotRail(); onShotChanged();
  });
  $("s_threat").addEventListener("change", (e) => { S.shot.threat = e.target.value; const th = threatById(S.shot.threat); if (S.shot.r0 < th.rmin || S.shot.r0 > th.rmax) S.shot.r0 = Math.round((th.rmin + th.rmax) / 2); S.shot.el = Math.round((th.elMin + th.elMax) / 2); syncShotRail(); onShotChanged(true); });
  $("s_seed").addEventListener("click", () => { S.shot.seed = (S.shot.seed % 9999) + 1; syncShotRail(); onShotChanged(); });
  $("s_win").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.shot.win = b.dataset.v; syncShotRail(); renderShot(); persist(); });
  f.addEventListener("submit", (e) => e.preventDefault());
}
function syncShotRail() {
  const sel = $("s_threat"), html = THREATS.map((t) => `<option value="${esc(t.id)}">${esc(t.name)} · ${t.v0} m/s</option>`).join("");
  if (sel.dataset.html !== html) { sel.innerHTML = html; sel.dataset.html = html; }
  if (!THREATS.some((t) => t.id === S.shot.threat)) S.shot.threat = THREATS[0].id;
  sel.value = S.shot.threat;
  const th = threatById(S.shot.threat), r = $("s_r0");
  const lo = Math.max(0.5, th.rmin), hi = Math.max(lo + 1, th.rmax);
  r.min = lo; r.max = hi; r.step = hi - lo > 50 ? 1 : 0.1;
  S.shot.r0 = Math.min(hi, Math.max(lo, S.shot.r0));
  for (const k of ["r0", "az", "el", "ph"]) if (document.activeElement !== $("s_" + k)) $("s_" + k).value = S.shot[k];
  $("s_r0Out").textContent = (S.shot.r0 >= 10 ? Math.round(S.shot.r0) : S.shot.r0.toFixed(1)) + " m";
  $("s_azOut").textContent = S.shot.az + "°"; $("s_elOut").textContent = S.shot.el + "°"; $("s_phOut").textContent = S.shot.ph.toFixed(2);
  $("s_seedOut").textContent = "seed " + S.shot.seed;
  $("s_threatHint").textContent = `${th.d} mm · ${th.mass} g · ${th.rmin}–${th.rmax} m · protection needed: ${LEVEL_NAME[th.req] || th.req}`;
  document.querySelectorAll("#s_win button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.v === S.shot.win)));
}
function computeShot() {
  const th = E.threatSI(threatById(S.shot.threat));
  const rng = E.mulberry32((S.shot.seed * 2654435761) >>> 0 || 1);
  const p = { r0: S.shot.r0, az: S.shot.az, el: S.shot.el, ph: S.shot.ph, rph: (S.shot.ph * 0.618 + 0.37) % 1, ax: 0.04, ay: 0.06 };
  SHOT = E.simRound(SYS, th, p, rng, true); SHOT.p = p; SHOT.th = th;
}
function renderShot() {
  computeShot();
  const o = SHOT, th = o.th, sys = SYS, svg = $("timeline");
  const W = 900, H = 230, L = 104, Rm = 20, rows = { cam: 52, rad: 96, out: 140, resp: 182 };
  const tReady = o.resp && Number.isFinite(o.resp.tReady) && o.resp.tReady > -Infinity ? o.resp.tReady : null;
  let t0 = 0;
  if (S.shot.win === "final") {
    const c = [o.tImp - 0.004];
    const f1 = o.cam && o.cam.frames.find((f) => f.pd > 0.02); if (f1) c.push(f1.t);
    const r1 = o.rad && o.rad.frames.find((f) => f.pd > 0.02); if (r1) c.push(r1.t);
    if (o.tAlert != null) c.push(o.tAlert);
    const m = Math.max(0, Math.min(...c)); t0 = Math.max(0, m - (o.tImp - m) * 0.2);
  }
  let tEnd = o.tImp;
  if (tReady != null && tReady > o.tImp) tEnd = Math.min(tReady, o.tImp + (o.tImp - t0) * 0.7);
  const t1 = tEnd + (tEnd - t0) * 0.05;
  const X = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - Rm), ms = (t) => t * 1000;
  let h = "";
  const span = ms(t1 - t0), step = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].find((x) => span / x <= 9) || 20000;
  for (let v = Math.ceil(ms(t0) / step) * step; v <= ms(t1); v += step) {
    const x = X(v / 1000);
    h += `<line x1="${x}" x2="${x}" y1="28" y2="200" stroke="var(--line)"/><text x="${x}" y="216" text-anchor="middle" font-size="10.5" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${+v.toFixed(2)}</text>`;
  }
  h += `<text x="${L - 10}" y="216" text-anchor="end" font-size="10.5" fill="var(--muted)" font-family="IBM Plex Mono, monospace">ms after shot</text>`;
  const label = (y, t) => `<text x="${L - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="var(--ink)" font-family="IBM Plex Sans Condensed, sans-serif">${t}</text>`;
  h += label(rows.cam, "Cameras") + label(rows.rad, "Radar") + label(rows.out, "Alert out") + label(rows.resp, "Response");
  Object.values(rows).forEach((y) => { h += `<line x1="${L}" x2="${W - Rm}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="1.5"/>`; });
  const note = (y, t, c) => `<text x="${L + 6}" y="${y - 12}" font-size="11" fill="var(${c})">${t}</text>`;
  if (!o.nCam) h += note(rows.cam, sys.cam ? "outside every camera's view" : "no cameras", "--muted");
  if (!o.nRad) h += note(rows.rad, sys.rad ? "outside radar cover" : "no radar", "--muted");
  if (o.cam) {
    const vis = o.cam.frames.filter((f) => f.t >= t0 && f.t <= t1), stride = Math.max(1, Math.ceil(vis.length / 260));
    vis.forEach((f, i) => {
      if (i % stride && !f.hit) return;
      const hh = 3 + 13 * f.pd, x = X(f.t);
      h += `<line x1="${x}" x2="${x}" y1="${rows.cam - hh}" y2="${rows.cam + hh}" stroke="var(${f.hit ? "--ok" : "--sensor"})" stroke-width="${f.hit ? 2.4 : 1.2}" opacity="${f.hit ? 1 : 0.55}"/>`;
    });
    if (o.cam.tConf != null) h += `<circle cx="${X(o.cam.tConf)}" cy="${rows.cam}" r="5" fill="var(--ok)"/><text x="${X(o.cam.tConf)}" y="${rows.cam - 20}" text-anchor="middle" font-size="10.5" fill="var(--ok)" font-family="IBM Plex Mono, monospace">confirm</text>`;
    else if (o.nCam) h += note(rows.cam, `${o.cam.n} frames, no confirmation`, "--bad");
  }
  if (o.rad) {
    o.rad.frames.filter((f) => f.t >= t0 && f.t <= t1).forEach((f) => { const hh = 3 + 10 * f.pd; h += `<rect x="${X(f.t) - 3}" y="${rows.rad - hh}" width="6" height="${2 * hh}" fill="var(--radar)" opacity="${f.hit ? 1 : 0.35}"/>`; });
    if (o.rad.tConf != null) h += `<circle cx="${X(o.rad.tConf)}" cy="${rows.rad}" r="5" fill="var(--radar)"/>`;
    else if (o.nRad) h += note(rows.rad, o.rad.n ? `${o.rad.n} look${o.rad.n === 1 ? "" : "s"}, no track` : `no radar frame fell inside its ${fmt(E.radRange(sys.rad, th), 1)} m range`, "--bad");
  }
  const srcT = o.src === "radar" ? o.rad && o.rad.tConf : o.cam && o.cam.tConf;
  if (srcT != null && o.tAlert != null) h += `<line x1="${X(srcT)}" x2="${X(o.tAlert)}" y1="${o.src === "radar" ? rows.rad : rows.cam}" y2="${rows.out}" stroke="var(--ok)" stroke-dasharray="3 3"/>`;
  h += `<line x1="${X(o.tImp)}" x2="${X(o.tImp)}" y1="28" y2="200" stroke="var(--bad)" stroke-width="2"/>`;
  h += `<text x="${X(o.tImp) - 4}" y="20" text-anchor="end" font-size="11" fill="var(--bad)" font-family="IBM Plex Mono, monospace">impact ${fmtMs(ms(o.tImp))}</text>`;
  if (o.tAlert != null) {
    const ax = X(o.tAlert);
    h += `<circle cx="${ax}" cy="${rows.out}" r="6" fill="var(--accent)"/>`;
    if (o.warnS > 0) {
      h += `<line x1="${ax}" x2="${X(o.tImp)}" y1="${rows.out + 13}" y2="${rows.out + 13}" stroke="var(--accent)" stroke-width="2"/>`;
      h += `<text x="${(ax + X(o.tImp)) / 2}" y="${rows.out + 26}" text-anchor="middle" font-size="11" fill="var(--accent)" font-family="IBM Plex Mono, monospace">${fmtMs(o.warnS * 1000)} warning</text>`;
    } else h += `<text x="${ax + 8}" y="${rows.out + 4}" font-size="11" fill="var(--bad)">alert after impact</text>`;
  }
  if (sys.resp.staticShield) h += note(rows.resp, "fixed element, always in place", "--muted");
  else if (o.resp && o.tAlert != null) {
    let t = o.tAlert;
    const segs = [["driver", o.resp.drvMs, "--ok"], ["slew", o.resp.aimMs, "--resp"], ["deploy", o.resp.deployMs, "--accent"]];
    segs.forEach(([name, d, c]) => {
      if (!(d > 0) || !Number.isFinite(d)) return;
      const a = X(Math.max(t, t0)), b = X(Math.min(t + d / 1000, t1));
      if (b > a) h += `<rect x="${a}" y="${rows.resp - 7}" width="${Math.max(1, b - a)}" height="14" fill="var(${c})" opacity="0.8"><title>${name} ${fmtMs(d)}</title></rect>`;
      t += d / 1000;
    });
    const rx = X(Math.min(o.resp.tReady, t1));
    h += `<text x="${Math.min(rx + 6, W - Rm - 4)}" y="${rows.resp + 4}" text-anchor="${rx > W - 160 ? "end" : "start"}" font-size="11" fill="var(${o.resp.inTime ? "--ok" : "--bad"})" font-family="IBM Plex Mono, monospace">${o.resp.inTime ? "in place" : "ready"} at ${fmtMs(ms(o.resp.tReady))}</text>`;
  } else if (sys.resp.mode === "warn") h += note(rows.resp, "warning only: no mechanism fitted", "--muted");
  svg.innerHTML = h;

  const cs = sys.cam, r50 = cs ? E.camRange50(cs, th) : null;
  const firstR = o.cam && o.cam.firstDet != null ? S.shot.r0 - E.distAtT(o.cam.firstDet, th.v0, th.lam) : null;
  const respNeed = o.resp ? o.resp.drvMs + o.resp.aimMs + (Number.isFinite(o.resp.deployMs) ? o.resp.deployMs : NaN) : null;
  const res = [
    gauge("Time of flight", fmtMs(o.tImp * 1000), "", `${th.v0} → ${Math.round(o.vImp)} m/s at impact`, null),
    gauge("Camera 50% range", r50 == null ? "—" : fmt(r50, r50 < 10 ? 1 : 0), r50 == null ? "" : "m", cs ? `${fmt(cs.ifov * 1000, 2)} mrad/px · σ ${fmt(cs.sigma, 3)}` : "no cameras", null),
    gauge("First detection", firstR == null ? "—" : fmt(firstR, firstR < 10 ? 1 : 0), firstR == null ? "" : "m", o.cam ? `${o.cam.n} frames examined` : "—", null),
    gauge("Confirmed at", o.cam && o.cam.rConf != null ? fmt(o.cam.rConf, 1) : o.rad && o.rad.rConf != null ? fmt(o.rad.rConf, 1) : "—", (o.cam && o.cam.rConf != null) || (o.rad && o.rad.rConf != null) ? "m" : "", cs ? `${cs.M} of ${cs.N} frames` : "radar track", null),
    gauge("Cue latency", srcT != null && o.tAlert != null ? fmt((o.tAlert - srcT) * 1000, 1) : "—", srcT != null ? "ms" : "", o.src ? `via ${o.src}` : "no cue", null),
    gauge("Warning", o.warnS > 0 ? fmtMs(o.warnS * 1000) : "none", "", o.src ? `need ${S.scen.needMs} ms` : "no cue before impact", null, o.warnS > 0 ? (o.warnS * 1000 >= S.scen.needMs ? "" : "warn") : "bad"),
  ];
  if (o.resp && !sys.resp.staticShield) res.push(gauge("Response needs", fmtMs(respNeed), "", o.resp.reach ? (o.resp.inTime ? `${fmtMs((o.tImp - o.resp.tReady) * 1000)} to spare` : `${fmtMs((o.resp.tReady - o.tImp) * 1000)} too late`) : "bearing outside slew range", null, o.resp.reach && o.resp.inTime ? "" : "bad"));
  $("shotResults").innerHTML = res.join("");
  const v = $("shotVerdict"), why = shotWhy(o);
  v.className = "verdict " + why.cls; v.innerHTML = why.html;
  $("hudThreat").innerHTML = `<i style="background:var(--bad)"></i>${esc(th.short)} · ${Math.round(S.shot.r0)} m · ${S.shot.az}°`;
}
function shotWhy(o) {
  const cs = SYS.cam, w = o.warnS ? o.warnS * 1000 : 0;
  switch (o.outcome) {
    case "uncovered": return { cls: "bad", html: "<b>Not seen.</b> The round arrives from a direction no camera pod or radar covers." };
    case "undetected": return { cls: "bad", html: `<b>Never confirmed.</b> ${o.cam ? `${o.cam.n} frames looked at the round${o.cam.firstDet != null ? ", some detected it," : ""} but the ${cs ? cs.M + "-of-" + cs.N : ""} rule was not met before impact.` : "The radar never built a track."} Pixel angle, contrast and frame rate set this limit.` };
    case "late": return { cls: "bad", html: "<b>Cue after impact.</b> A track confirmed, but processing and output latency used up the remaining flight time." };
    case "short": return { cls: "warn", html: `<b>${fmtMs(w)} of warning</b> via ${o.src}, short of the ${S.scen.needMs} ms the scenario asks for.` };
    case "warned": return { cls: "ok", html: `<b>${fmtMs(w)} of warning</b> via ${o.src}. ${w >= 250 ? "Longer than a typical human reaction time (about 250 ms), so a haptic cue could be acted on." : w >= 10 ? "Too short for the wearer to react, but long enough to trigger an automated response or log the event." : "Useful only as a logged detection."}` };
    case "reach": return { cls: "bad", html: `<b>Outside slew range.</b> The round comes from ${Math.round(Math.abs(o.p.az))}° off the front; the turret only reaches ±${Math.round(SYS.resp.aim.range / 2)}°.` };
    case "slow": return { cls: "bad", html: `<b>Mechanism too slow.</b> ${fmtMs(w)} of warning, but driver, slew and deployment need ${fmtMs(o.resp.drvMs + o.resp.aimMs + o.resp.deployMs)}.` };
    case "reached": return { cls: "ok", html: `<b>Mechanism in place</b> ${fmtMs((o.tImp - o.resp.tReady) * 1000)} before impact.` };
    case "geometry": return { cls: "warn", html: `<b>In place but missed.</b> The element was deployed in time but the round's path crossed outside its ${Math.round(SYS.resp.shieldW * 1000)} × ${Math.round(SYS.resp.shieldH * 1000)} mm footprint${o.resp && Math.abs(o.resp.offDeg) > 2 ? ` (pointing off by ${fmt(Math.abs(o.resp.offDeg), 1)}°)` : ""}.` };
    case "stop": return { cls: "warn", html: `<b>Intercepted but not stopped.</b> ${esc(SYS.resp.shield.name)} is rated for ${(LEVEL_NAME[SYS.resp.shield.level] || "").toLowerCase()}; this threat needs ${(LEVEL_NAME[o.th.req] || o.th.req).toLowerCase()}.` };
    case "protected": return { cls: "ok", html: `<b>Protected.</b> ${SYS.resp.staticShield ? "The fixed element sits across the round's path." : `The element was in place ${fmtMs((o.tImp - o.resp.tReady) * 1000)} before impact, across the path, and rated for the threat.`}` };
    default: return { cls: "", html: "" };
  }
}

/* ================================================================== scenario performance */
const BEARINGS = [["uniform", "Any"], ["front", "Front ±60°"], ["flank", "Flanks"], ["rear", "Rear"], ["bench", "Bench 0°"]];
function renderScenRail() {
  $("scenRail").innerHTML = `
    <fieldset><legend>Conditions</legend>
      <label class="f"><span>Environment</span><select id="sc_env">${CAT.ENVIRONMENTS.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")}</select><small class="hint" id="sc_envHint"></small></label>
      <div class="f"><span class="lbl">Wearer activity</span><div class="seg" id="sc_act" role="group" aria-label="Wearer activity">${CAT.ACTIVITIES.map((a) => `<button type="button" data-v="${a.id}">${esc(a.name.split(",")[0].split(" /")[0])}</button>`).join("")}</div></div>
      <div class="f"><span class="lbl">Threat bearings</span><div class="seg" id="sc_bear" role="group" aria-label="Threat bearings">${BEARINGS.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join("")}</div></div>
      <label class="f"><span>Aim-point spread <b id="sc_spreadOut"></b></span><input type="range" id="sc_spread" min="0.2" max="1.5" step="0.05"></label>
      <label class="f"><span>Warning needed before impact <b id="sc_needOut"></b></span><input type="range" id="sc_need" min="0" max="1000" step="1"></label>
      <label class="f"><span>Rounds per threat <b id="sc_roundsOut"></b></span><input type="range" id="sc_rounds" min="100" max="3000" step="100"></label>
    </fieldset>
    <fieldset><legend>Threat mix (weight)</legend><div class="threatlist" id="sc_threats"></div></fieldset>
    <fieldset><legend>Requirements</legend>
      <label class="f"><span>Max added mass, kg</span><input type="number" id="rq_maxMass" min="0" step="0.1"></label>
      <label class="f"><span>Max head-borne mass, kg</span><input type="number" id="rq_maxHead" min="0" step="0.05"></label>
      <label class="f"><span>Min runtime, h</span><input type="number" id="rq_minRuntime" min="0" step="0.5"></label>
      <label class="f"><span>Max parts cost, €</span><input type="number" id="rq_maxCost" min="0" step="100"></label>
      <label class="f"><span>Max false alerts per hour</span><input type="number" id="rq_maxFar" min="0" step="0.1"></label>
      <label class="f"><span>Min rating of any part (0 = off)</span><input type="number" id="rq_minRating" min="0" max="10" step="1"></label>
    </fieldset>`;
  const f = $("scenRail");
  f.addEventListener("submit", (e) => e.preventDefault());
  $("sc_env").addEventListener("change", (e) => { S.scen.env = e.target.value; onScenChanged(); });
  $("sc_act").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { S.scen.activity = b.dataset.v; onScenChanged(); } });
  $("sc_bear").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { S.scen.bearing = b.dataset.v; onScenChanged(); } });
  $("sc_need").addEventListener("input", (e) => { S.scen.needMs = +e.target.value; onScenChanged(); });
  $("sc_spread").addEventListener("input", (e) => { S.scen.aimSpread = +e.target.value; onScenChanged(); });
  $("sc_rounds").addEventListener("input", (e) => { S.scen.rounds = +e.target.value; syncScenRail(); schedulePerf(); persist(); });
  f.addEventListener("change", (e) => {
    const id = e.target.id;
    if (id.startsWith("rq_")) { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v >= 0) S.req[id.slice(3)] = v; onScenChanged(); }
    if (id.startsWith("tw_")) { const v = parseFloat(e.target.value); S.scen.threats[id.slice(3)] = Number.isFinite(v) && v > 0 ? v : 0; onScenChanged(); }
  });
}
function syncScenRail() {
  const sc = S.scen, env = CAT.ENVIRONMENTS.find((e) => e.id === sc.env) || CAT.ENVIRONMENTS[0];
  $("sc_env").value = env.id; $("sc_envHint").textContent = `${env.note} Light ${env.light >= 0.01 ? Math.round(env.light * 100) + "%" : "<1%"} of full sun.`;
  document.querySelectorAll("#sc_act button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.v === sc.activity)));
  document.querySelectorAll("#sc_bear button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.v === sc.bearing)));
  if (document.activeElement !== $("sc_need")) $("sc_need").value = sc.needMs;
  $("sc_needOut").textContent = sc.needMs + " ms";
  if (document.activeElement !== $("sc_spread")) $("sc_spread").value = sc.aimSpread || 1;
  $("sc_spreadOut").textContent = `×${(sc.aimSpread || 1).toFixed(2)} ${(sc.aimSpread || 1) >= 0.95 && (sc.aimSpread || 1) <= 1.05 ? "torso and head" : (sc.aimSpread || 1) < 1 ? "tighter" : "wider"}`; $("sc_rounds").value = sc.rounds; $("sc_roundsOut").textContent = sc.rounds.toLocaleString("en-IE");
  const html = THREATS.map((t) => `<label for="tw_${esc(t.id)}"><span>${esc(t.name)}</span><input type="number" id="tw_${esc(t.id)}" min="0" max="10" step="0.5" value="${t.id in sc.threats ? sc.threats[t.id] : 1}"></label>`).join("");
  const box = $("sc_threats"); if (box.dataset.html !== html && !box.contains(document.activeElement)) { box.innerHTML = html; box.dataset.html = html; }
  for (const k of Object.keys(CAT.DEFAULT_REQ)) { const el = $("rq_" + k); if (el && document.activeElement !== el) el.value = S.req[k]; }
}
let perfTimer = null;
function schedulePerf() { clearTimeout(perfTimer); perfTimer = setTimeout(renderPerf, 180); }
function renderPerf() {
  const t0 = performance.now();
  PERF = E.runScenario(SYS, THREATS, S.scen, S.scen.rounds, 1);
  const dt = performance.now() - t0, mode = PERF.mode;
  $("perfMeta").textContent = `${(PERF.per.length * S.scen.rounds).toLocaleString("en-IE")} rounds in ${Math.round(dt)} ms`;
  const cls = (p) => (p >= 0.7 ? "ok" : p >= 0.3 ? "warn" : "bad");
  const cell = (p) => `<span class="pct ${cls(p)}">${pct(p)}</span>`;
  const showReady = mode !== "warn", showProt = mode === "shield";
  let h = `<thead><tr><th>Threat</th><th class="n">Weight</th><th class="n">Covered</th><th class="n">Cued</th><th class="n">Warning ≥ ${S.scen.needMs} ms</th><th class="n">Median warning</th>${showReady ? '<th class="n">Mechanism in time</th>' : ""}${showProt ? '<th class="n">Protected</th>' : ""}<th>Outcomes</th><th>Main failure</th></tr></thead><tbody>`;
  if (!PERF.per.some((r) => r.id === S.perfThreat) && PERF.per.length) S.perfThreat = PERF.per[0].id;
  for (const r of PERF.per) {
    const th = threatById(r.id), fail = mainFailure(r);
    h += `<tr class="click ${r.id === S.perfThreat ? "sel" : ""}" data-id="${esc(r.id)}"><td>${esc(th.name)}</td><td class="n">${r.weight}</td><td class="n">${pct(r.pCover)}</td><td class="n">${pct(r.pCue)}</td><td class="n">${cell(r.pNeed)}</td>`;
    h += `<td class="n">${r.medWarn != null ? fmtMs(r.medWarn) : "—"}<small class="med">${r.p10Warn != null ? `${fmtMs(r.p10Warn)} – ${fmtMs(r.p90Warn)}` : "no cue"}</small></td>`;
    if (showReady) h += `<td class="n">${cell(r.pReady)}</td>`;
    if (showProt) h += `<td class="n">${cell(r.pProt)}</td>`;
    h += `<td>${stackBar(r)}</td><td>${fail ? `<span class="muted">${esc(fail.label)} · ${pct(fail.p)}</span>` : "—"}</td></tr>`;
  }
  h += `<tr><td colspan="4"><b>Weighted across the mix</b></td><td class="n"><b>${pct(PERF.need)}</b></td><td></td>${showReady ? `<td class="n"><b>${pct(PERF.ready)}</b></td>` : ""}${showProt ? `<td class="n"><b>${pct(PERF.prot)}</b></td>` : ""}<td colspan="2"></td></tr></tbody>`;
  $("perfTbl").innerHTML = h;
  $("outLegend").innerHTML = E.OUTCOMES.filter(([k]) => PERF.per.some((r) => r.counts[k])).map(([, l, c]) => `<span><i style="background:var(${c})"></i>${l}</span>`).join("");
  drawHist(PERF.per.find((r) => r.id === S.perfThreat));
  renderReading();
  renderBench();
}
function stackBar(r) {
  return `<div class="stack" title="${E.OUTCOMES.filter(([k]) => r.counts[k]).map(([k, l]) => `${l}: ${pct(r.counts[k] / r.N)}`).join(" · ")}">${E.OUTCOMES.map(([k, , c]) => (r.counts[k] ? `<div style="width:${(r.counts[k] / r.N) * 100}%;background:var(${c})"></div>` : "")).join("")}</div>`;
}
const FAILS = ["uncovered", "undetected", "late", "short", "reach", "slow", "geometry", "stop"];
function mainFailure(r) { let best = null; for (const k of FAILS) if (r.counts[k] && (!best || r.counts[k] > best.n)) best = { k, n: r.counts[k], p: r.counts[k] / r.N, label: OUT[k].label }; return best; }
function drawHist(r) {
  const svg = $("hist"), W = 600, H = 250, L = 46, Rm = 14, T = 14, B = 44;
  if (!r) { svg.innerHTML = ""; return; }
  const th = threatById(r.id);
  const lo = -2, hi = 5, perDec = 4, bins = (hi - lo) * perDec;
  const counts = new Array(bins).fill(0);
  r.warns.forEach((m) => { const b = Math.floor((Math.log10(Math.max(m, 1e-3)) - lo) * perDec); counts[Math.max(0, Math.min(bins - 1, b))]++; });
  const missed = r.N - r.warns.length, ymax = Math.max(1, ...counts, missed);
  const plotW = W - L - Rm - 44, plotH = H - T - B, bw = plotW / bins;
  const X = (m) => L + ((Math.log10(m) - lo) / (hi - lo)) * plotW;
  let h = "";
  for (let i = 0; i <= 4; i++) { const y = T + plotH - (plotH * i) / 4; h += `<line x1="${L}" x2="${W - Rm}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${Math.round((ymax * i) / 4)}</text>`; }
  counts.forEach((c, i) => {
    if (!c) return; const x = L + i * bw, hh = (plotH * c) / ymax, edge = Math.pow(10, lo + (i + 1) / perDec);
    h += `<rect x="${x + 1}" y="${T + plotH - hh}" width="${Math.max(1, bw - 2)}" height="${hh}" fill="var(${edge <= S.scen.needMs ? "--warn" : "--accent"})"><title>${fmtMs(Math.pow(10, lo + i / perDec))} – ${fmtMs(edge)}: ${c} rounds</title></rect>`;
  });
  const mx = L + plotW + 14, mh = (plotH * missed) / ymax;
  h += `<rect x="${mx}" y="${T + plotH - mh}" width="28" height="${mh}" fill="var(--bad)"><title>No cue before impact: ${missed}</title></rect><text x="${mx + 14}" y="${H - B + 16}" text-anchor="middle" font-size="10" fill="var(--bad)" font-family="IBM Plex Mono, monospace">none</text>`;
  [[0.01, "0.01 ms"], [0.1, "0.1 ms"], [1, "1 ms"], [10, "10 ms"], [100, "100 ms"], [1000, "1 s"], [10000, "10 s"]].forEach(([m, t]) => { h += `<line x1="${X(m)}" x2="${X(m)}" y1="${T + plotH}" y2="${T + plotH + 4}" stroke="var(--muted)"/><text x="${X(m)}" y="${H - B + 16}" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${t}</text>`; });
  h += `<text x="${L + plotW / 2}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="var(--muted)">warning before impact (log scale)</text>`;
  const vline = (m, c, t, dy) => { if (!(m > 0.01 && m < 1e5)) return ""; const x = X(m); return `<line x1="${x}" x2="${x}" y1="${T}" y2="${T + plotH}" stroke="var(${c})" stroke-dasharray="4 3"/><text x="${x + 4}" y="${T + 10 + dy}" font-size="10" fill="var(${c})" font-family="IBM Plex Mono, monospace">${t}</text>`; };
  h += vline(S.scen.needMs, "--ink", `need ${S.scen.needMs} ms`, 0);
  const R = SYS.resp;
  if (R.mode !== "warn" && !R.staticShield) { const need = R.drvMs + (R.aim ? R.aim.time(Math.min(90, R.aim.range / 2)) : 0) + R.deployMs; h += vline(need, "--resp", `mechanism ≈ ${fmtMs(need)}`, 14); }
  svg.innerHTML = h;
  $("histTitle").textContent = `Warning time · ${th.name}`;
  $("histSub").textContent = `${r.N.toLocaleString("en-IE")} rounds · ${th.rmin}–${th.rmax} m`;
}
function renderReading() {
  const P = PERF, sys = SYS, out = [];
  if (!P.per.length) { $("perfText").innerHTML = "<p>Give at least one threat a weight above zero.</p>"; return; }
  const tot = Object.fromEntries(FAILS.map((k) => [k, 0])); let N = 0;
  P.per.forEach((r) => { N += r.N * r.weight; FAILS.forEach((k) => (tot[k] += (r.counts[k] || 0) * r.weight)); });
  const ranked = FAILS.map((k) => [k, tot[k] / N]).filter(([, p]) => p > 0.02).sort((a, b) => b[1] - a[1]);
  const best = P.per.reduce((a, r) => (r.pGoal > a.pGoal ? r : a)), worst = P.per.reduce((a, r) => (r.pGoal < a.pGoal ? r : a));
  out.push(`<p><b>${pct(P.goal)}</b> of weighted rounds end ${goalLabel(P.mode)}. Best: ${esc(threatById(best.id).name)} (${pct(best.pGoal)}). Worst: ${esc(threatById(worst.id).name)} (${pct(worst.pGoal)}).</p>`);
  const levers = {
    uncovered: "Rounds arrive where nothing looks. Add pods or radar units, or move pods to the helmet for upward cover. Coverage shows the gaps.",
    undetected: `Rounds stay below the detection threshold. Pixel angle is the lever: a narrower lens, more pixels, more contrast (thermal, active illumination) or a lower SNR threshold (costs false alerts). ${sys.cam ? `Now ${fmt(sys.cam.ifov * 1000, 2)} mrad/px at σ ${fmt(sys.cam.sigma, 3)}.` : ""}`,
    late: "Tracks confirm, but latency eats the remaining flight time. Cut transfer and processing time (lighter frames, faster compute, FPGA) or confirm with fewer frames.",
    short: `Cues arrive, but with less than the ${S.scen.needMs} ms required. Only earlier detection fixes this, not faster processing.`,
    reach: "The turret cannot turn far enough. Use more travel, a second head, or less gear reduction.",
    slow: "The mechanism starts in time but finishes too late. Driver latency, slew speed and deployment time are the levers; the trace below the alert shows which dominates.",
    geometry: "The element is in place but too small or pointed wrong for the spread of aim points. Make it larger, stand it further out, or reduce pointing error.",
    stop: "The element intercepts but is not rated for the threat. A higher protection level costs areal density, which slows deployment.",
  };
  if (ranked.length) out.push(`<ul>${ranked.slice(0, 3).map(([k, p]) => `<li><b>${OUT[k].label} · ${pct(p)}.</b> ${levers[k]}</li>`).join("")}</ul>`);
  if (sys.farH > S.req.maxFar) out.push(`<p class="muted">False alerts run at ${E.fmtRate(sys.farH)} per hour${sys.fusion === "or" && sys.radFar > sys.camFar ? ", mostly from the radar; requiring both sensors to agree cuts that sharply" : ""}.</p>`);
  $("perfText").innerHTML = out.join("");
}
function wirePerfTable() {
  $("perfTbl").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-id]"); if (!tr) return; S.perfThreat = tr.dataset.id; document.querySelectorAll("#perfTbl tr[data-id]").forEach((x) => x.classList.toggle("sel", x === tr)); drawHist(PERF.per.find((r) => r.id === S.perfThreat)); persist(); });
}

/* ================================================================== saved builds */
const cmpCache = new Map();
function summarize(build) {
  const b = normalizeBuild({ ...clone(CAT.DEFAULT_BUILD), ...clone(build) });
  const key = JSON.stringify([b, S.scen, S.req, Object.keys(S.custom.parts).length, JSON.stringify(S.custom).length]);
  if (cmpCache.has(key)) return cmpCache.get(key);
  const sys = E.derive(b, LIB, S.scen, CAT), ev = E.evaluate(sys, S.req);
  const perf = E.runScenario(sys, THREATS, { ...S.scen }, 300, 1);
  const r = { b, sys, ev, perf }; cmpCache.set(key, r); if (cmpCache.size > 80) cmpCache.clear(); return r;
}
function renderCompare() {
  const cols = [{ name: "Current build", build: S.build, current: true }].concat(S.saved.map((b, i) => ({ name: b.name || `Build ${i + 1}`, build: b, i })));
  const sums = cols.map((c) => summarize(c.build));
  const row = (label, fn, cls = "n") => `<tr><th>${label}</th>${sums.map((s, i) => `<td class="${cls}">${fn(s, cols[i])}</td>`).join("")}</tr>`;
  const part = (k) => (s) => { const p = LIB.byId[s.b[k]]; return p ? `${esc(p.name)} ${ratingChip(p)}` : '<span class="muted">none</span>'; };
  let h = `<thead><tr><th></th>${cols.map((c) => `<th class="n" style="white-space:normal;min-width:150px">${esc(c.name)}${c.current ? "" : `<div class="btnrow" style="justify-content:flex-end;margin-top:6px"><button class="btn small" type="button" data-load="${c.i}">Load</button><button class="btn small danger" type="button" data-del="${c.i}">Delete</button></div>`}</th>`).join("")}</tr></thead><tbody>`;
  h += row("Camera", (s) => (LIB.byId[s.b.camera] ? `${s.b.pods} × ${part("camera")(s)}` : '<span class="muted">none</span>'), "wrapcell");
  h += row("Lens", part("lens"), "wrapcell");
  h += row("Radar", (s) => (s.b.radar !== "none" && LIB.byId[s.b.radar] ? `${s.b.radars} × ${part("radar")(s)}` : '<span class="muted">none</span>'), "wrapcell");
  h += row("Compute", part("compute"), "wrapcell");
  h += row("Response", (s) => [s.b.aim, s.b.deploy, s.b.shield].filter((x) => x && x !== "none").map((x) => (x === "pneumatic" ? "pneumatic" : esc((LIB.byId[x] || {}).name || x))).join(" · ") || '<span class="muted">warning only</span>', "wrapcell");
  h += row("Added mass", (s) => kgTxt(s.sys.added));
  h += row("Head-borne", (s) => fmt(s.sys.headMass * 1000, 0) + " g");
  h += row("Power · runtime", (s) => `${fmt(s.sys.power, 1)} W · ${fmt(s.sys.runtimeH, 1)} h`);
  h += row("Parts cost", (s) => euro(s.sys.cost));
  h += row("Weakest rating", (s) => (s.sys.readiness.min == null ? "—" : `${s.sys.readiness.min}/10`));
  h += row("False alerts / h", (s) => E.fmtRate(s.sys.farH));
  h += row("Ground coverage", (s) => pct(Math.max(s.sys.covGround, s.sys.radGround)));
  h += row("Checks", (s) => { const bad = s.sys.issues.concat(s.ev.violations).filter((x) => x.level === "bad").length, w = s.sys.issues.concat(s.ev.violations).length - bad; return bad ? `<span style="color:var(--bad)">${bad} blocking</span>` : w ? `<span style="color:var(--warn)">${w} warning${w === 1 ? "" : "s"}</span>` : '<span style="color:var(--ok)">pass</span>'; });
  h += row("Overall objective", (s) => `<b>${pct(s.perf.goal)}</b><small class="med">${goalLabel(s.perf.mode)}</small>`);
  THREATS.forEach((t) => { if (!(S.scen.threats[t.id] > 0) && t.id in S.scen.threats) return; h += row(esc(t.name), (s) => { const r = s.perf.per.find((x) => x.id === t.id); return r ? `${pct(r.pGoal)}<small class="med">${r.medWarn != null ? fmtMs(r.medWarn) : "no cue"}</small>` : "—"; }); });
  $("cmpTbl").innerHTML = h + "</tbody>";
}
function wireCompare() {
  $("saveForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("saveName").value.trim() || `Build ${S.saved.length + 1}`;
    S.saved.push({ ...clone(S.build), name }); S.build.name = name; $("saveName").value = "";
    persist(); renderCompare(); syncRail();
  });
  $("cmpTbl").addEventListener("click", (e) => {
    const l = e.target.closest("[data-load]"), d = e.target.closest("[data-del]");
    if (l) { S.build = normalizeBuild({ ...clone(CAT.DEFAULT_BUILD), ...clone(S.saved[+l.dataset.load]) }); onBuildChanged(); document.getElementById("build").scrollIntoView(); }
    if (d) { const i = +d.dataset.del; if (d.dataset.armed) { S.saved.splice(i, 1); persist(); renderCompare(); } else { d.dataset.armed = "1"; d.textContent = "Confirm delete"; } }
  });
}
