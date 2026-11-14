/* Muzzle Flash Aspect: page logic (controls, study runner, charts, images, exports). */
(function () {
  'use strict';
  const C = window.FlashCore;
  const D = C.DEG;
  const RANGES = [50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 700, 800];
  const BAL_RANGES = []; for (let r = 25; r <= 800; r += 25) BAL_RANGES.push(r);
  const SWEEP = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
  const STRIP_ANGLES = [0, 2, 5, 20, 90];

  const state = {
    p: C.defaultParams(),
    sensors: C.defaultSensors(),
    view: { sensor: 1, range: 300, angle: 2, noise: true, random: false, seed: 1, stripNoise: false },
    mode: 'angle',
    editSensor: 1,
    results: null,
    job: null,
    progress: { frac: 0, label: 'Starting…', running: false, stale: true }
  };

  // ------------------------------------------------------------------ helpers
  const $ = id => document.getElementById(id);
  const el = (tag, attrs, kids) => {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(c => c != null && e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return e;
  };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function sig(v, n) {
    if (!isFinite(v)) return String(v);
    if (v === 0) return '0';
    const a = Math.abs(v);
    const d = Math.max(0, Math.min(6, n - 1 - Math.floor(Math.log10(a))));
    return v.toFixed(d);
  }
  function fmtAngle(v) {
    if (v == null) return '—';
    if (v === 0) return '0°';
    if (v < 0.1) return v.toFixed(3) + '°';
    if (v < 1) return v.toFixed(2) + '°';
    if (v < 10) return v.toFixed(1) + '°';
    return Math.round(v) + '°';
  }
  function fmtLen(m) {
    if (m == null || !isFinite(m)) return '—';
    if (m < 0.01) return (m * 1000).toFixed(1) + ' mm';
    if (m < 1) return (m * 100).toFixed(m < 0.1 ? 1 : 0) + ' cm';
    if (m < 10) return m.toFixed(1) + ' m';
    return Math.round(m) + ' m';
  }
  const PREFIX = [[1e-12, 'p'], [1e-9, 'n'], [1e-6, 'µ'], [1e-3, 'm'], [1, '']];
  function siScale(maxv) {
    let best = PREFIX[0];
    for (const pr of PREFIX) if (maxv >= pr[0]) best = pr;
    return { k: 1 / best[0], p: best[1] };
  }
  function resText(r) {
    if (!r) return '…';
    if (r.flag === 'undetected') return 'not detected';
    if (r.flag === 'gt90') return '> 90°';
    if (r.flag === 'lt') return '< ' + fmtAngle(r.value);
    return fmtAngle(r.value);
  }
  function nearestRangeIndex(R) {
    let bi = 0;
    RANGES.forEach((r, i) => { if (Math.abs(r - R) < Math.abs(RANGES[bi] - R)) bi = i; });
    return bi;
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ------------------------------------------------------------------ theme
  const LIGHT = {
    bg: '#ffffff', ink: '#1a201b', muted: '#586356', line: '#c6cdc0', accent: '#b86200',
    s: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'], sat: '#2bb8d6', grid: 'rgba(26,32,27,0.09)'
  };
  let TH = null;
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const g = n => cs.getPropertyValue(n).trim();
    const dark = (cs.getPropertyValue('color-scheme') || '').indexOf('dark') >= 0 ||
      document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.getAttribute('data-theme') && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    TH = {
      bg: g('--surface'), ink: g('--ink'), muted: g('--muted'), line: g('--line'), accent: g('--accent'),
      s: [g('--s1'), g('--s2'), g('--s3'), g('--s4')], sat: g('--sat'),
      grid: dark ? 'rgba(225,231,220,0.08)' : 'rgba(26,32,27,0.09)'
    };
  }
  const FONT_BODY = '"IBM Plex Sans", system-ui, sans-serif';
  const FONT_DATA = '"IBM Plex Mono", ui-monospace, monospace';

  // ------------------------------------------------------------------ chart engine (canvas)
  function axisMap(ax, a, b) {
    if (ax.type === 'log') {
      const l0 = Math.log(ax.min), l1 = Math.log(ax.max);
      return v => a + (Math.log(clamp(v, ax.min * 1e-3, ax.max * 1e3)) - l0) / (l1 - l0) * (b - a);
    }
    return v => a + (v - ax.min) / (ax.max - ax.min) * (b - a);
  }
  function axisInv(ax, a, b) {
    if (ax.type === 'log') { const l0 = Math.log(ax.min), l1 = Math.log(ax.max); return px => Math.exp(l0 + (px - a) / (b - a) * (l1 - l0)); }
    return px => ax.min + (px - a) / (b - a) * (ax.max - ax.min);
  }
  function drawChart(g, W, H, spec, T, hoverX, exportMode) {
    g.save();
    g.clearRect(0, 0, W, H);
    if (exportMode) { g.fillStyle = T.bg; g.fillRect(0, 0, W, H); }
    let top = 4;
    if (exportMode && spec.title) {
      g.fillStyle = T.ink; g.font = `600 17px ${FONT_BODY}`; g.textBaseline = 'alphabetic';
      g.fillText(spec.title, 14, top + 20); top += 28;
      if (spec.subtitle) { g.fillStyle = T.muted; g.font = `12px ${FONT_BODY}`; g.fillText(spec.subtitle, 14, top + 12); top += 20; }
    }
    const padL = 60, padR = 18;
    const foot = exportMode && spec.footnote ? (Array.isArray(spec.footnote) ? spec.footnote : [spec.footnote]) : [];
    const padB = 44 + foot.length * 15;
    // legend
    g.font = `12px ${FONT_BODY}`;
    let lx = padL, ly = top + 12;
    for (const it of (spec.legend || [])) {
      const w = 26 + g.measureText(it.label).width + 18;
      if (lx + w > W - padR && lx > padL) { lx = padL; ly += 18; }
      g.save();
      if (it.kind === 'block') { g.fillStyle = it.color; g.fillRect(lx, ly - 8, 12, 10); }
      else {
        g.strokeStyle = it.color; g.lineWidth = it.width || 2; g.setLineDash(it.dash || []);
        g.beginPath(); g.moveTo(lx, ly - 3); g.lineTo(lx + 20, ly - 3); g.stroke();
        if (it.marker) drawMarker(g, lx + 10, ly - 3, it.marker, it.color, T);
      }
      g.restore();
      g.fillStyle = T.muted; g.textBaseline = 'alphabetic';
      g.fillText(it.label, lx + (it.kind === 'block' ? 18 : 26), ly + 1);
      lx += w;
    }
    top = (spec.legend && spec.legend.length) ? ly + 12 : top + 6;
    const bands = spec.bands || [];
    const bandH = 20;
    const bandTop = top;
    const y0 = top + bands.length * bandH + (bands.length ? 8 : 4);
    const x0 = padL, x1 = W - padR, y1 = H - padB;
    const sx = axisMap(spec.x, x0, x1), sy = axisMap(spec.y, y1, y0);
    // bands
    bands.forEach((b, i) => {
      const by = bandTop + i * bandH;
      g.fillStyle = T.grid; g.fillRect(x0, by + 2, x1 - x0, bandH - 4);
      g.fillStyle = T.muted; g.font = `11px ${FONT_DATA}`; g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillText(b.short, x0 - 8, by + bandH / 2);
    });
    // grid + ticks
    g.lineWidth = 1; g.strokeStyle = T.grid; g.setLineDash([]);
    g.font = `11px ${FONT_DATA}`; g.fillStyle = T.muted;
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const t of spec.y.ticks) {
      const yy = Math.round(sy(t)) + 0.5;
      g.beginPath(); g.moveTo(x0, yy); g.lineTo(x1, yy); g.stroke();
      g.fillText(spec.y.fmt ? spec.y.fmt(t) : String(t), x0 - 8, yy);
    }
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (const t of spec.x.ticks) {
      const xx = Math.round(sx(t)) + 0.5;
      g.beginPath(); g.moveTo(xx, y0); g.lineTo(xx, y1); g.stroke();
      g.fillText(spec.x.fmt ? spec.x.fmt(t) : String(t), xx, y1 + 7);
    }
    g.strokeStyle = T.line; g.beginPath(); g.moveTo(x0, y1 + 0.5); g.lineTo(x1, y1 + 0.5); g.stroke();
    // axis labels
    g.fillStyle = T.muted; g.font = `12px ${FONT_BODY}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    if (spec.x.label) g.fillText(spec.x.label, (x0 + x1) / 2, y1 + 36);
    if (spec.y.label) { g.save(); g.translate(14, (y0 + y1) / 2); g.rotate(-Math.PI / 2); g.fillText(spec.y.label, 0, 0); g.restore(); }
    // clip plot area
    g.save(); g.beginPath(); g.rect(x0, y0 - 2, x1 - x0, y1 - y0 + 4); g.clip();
    for (const r of (spec.rects || [])) {
      const a = sx(r.x0), b = sx(r.x1);
      g.globalAlpha = r.alpha == null ? 0.25 : r.alpha; g.fillStyle = r.color;
      const ya = sy(Math.max(spec.y.min, r.y)), yb = sy(spec.y.min);
      g.fillRect(Math.min(a, b), Math.min(ya, yb), Math.max(1.5, Math.abs(b - a)), Math.abs(yb - ya));
      g.globalAlpha = 1;
      if (r.edge) { g.strokeStyle = r.color; g.lineWidth = 1.5; g.beginPath(); g.moveTo(Math.min(a, b), ya); g.lineTo(Math.max(a, b) + 0.5, ya); g.stroke(); }
    }
    for (const rf of (spec.refs || [])) {
      g.strokeStyle = rf.color || T.muted; g.lineWidth = rf.width || 1.25; g.setLineDash(rf.dash || [4, 4]);
      g.beginPath();
      if (rf.kind === 'h') { const yy = sy(rf.y); g.moveTo(x0, yy); g.lineTo(x1, yy); }
      else if (rf.kind === 'v') { const xx = sx(rf.x); g.moveTo(xx, y0); g.lineTo(xx, y1); }
      else if (rf.kind === 'curve') rf.pts.forEach((pt, i) => { const X = sx(pt[0]), Y = sy(pt[1]); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
      else if (rf.kind === 'seg') { g.moveTo(sx(rf.x0), sy(rf.y)); g.lineTo(sx(rf.x1), sy(rf.y)); }
      g.stroke(); g.setLineDash([]);
    }
    for (const s of spec.series) {
      g.strokeStyle = s.color; g.lineWidth = s.width || 2; g.setLineDash(s.dash || []); g.lineJoin = 'round';
      g.beginPath();
      let pen = false;
      for (const pt of s.pts) {
        if (pt.y == null || !isFinite(pt.y)) { pen = false; continue; }
        const X = sx(pt.x), Y = sy(pt.y);
        if (pen) g.lineTo(X, Y); else { g.moveTo(X, Y); pen = true; }
      }
      g.stroke(); g.setLineDash([]);
    }
    g.restore();
    // markers (unclipped so edge points stay whole)
    for (const s of spec.series) {
      if (!s.marker) continue;
      for (const pt of s.pts) {
        if (pt.y != null && isFinite(pt.y)) drawMarker(g, sx(pt.x), sy(pt.y), s.marker, s.color, T);
        else if (pt.flag && s.bandSlot != null) {
          const bi = bands.findIndex(b => b.key === pt.flag);
          if (bi < 0) continue;
          const by = bandTop + bi * bandH + bandH / 2 + (s.bandRow ? 4 : -4);
          drawMarker(g, sx(pt.x) + s.bandSlot, by, pt.flag === 'undetected' ? 'x' : s.marker, s.color, T);
        }
      }
    }
    // reference labels
    g.font = `11px ${FONT_BODY}`; g.textBaseline = 'bottom';
    for (const rf of (spec.refs || [])) {
      if (!rf.label) continue;
      g.fillStyle = rf.color || T.muted;
      if (rf.kind === 'h') { g.textAlign = rf.align || 'left'; g.fillText(rf.label, rf.align === 'right' ? x1 - 4 : x0 + 6, sy(rf.y) - 3); }
      else if (rf.kind === 'v') { g.textAlign = 'left'; g.save(); g.translate(sx(rf.x) + 4, y0 + 4); g.textBaseline = 'top'; g.fillText(rf.label, 0, 0); g.restore(); }
      else if (rf.kind === 'curve' && rf.pts.length) {
        const pt = rf.pts[rf.labelAt == null ? rf.pts.length - 1 : clamp(rf.labelAt, 0, rf.pts.length - 1)];
        if (rf.labelBelow) { g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(rf.label, sx(pt[0]) + 4, sy(pt[1]) + 5); g.textBaseline = 'bottom'; }
        else { g.textAlign = 'right'; g.fillText(rf.label, Math.min(sx(pt[0]), x1 - 2), sy(pt[1]) - 4); }
      }
    }
    // hover crosshair
    if (hoverX != null) {
      const xx = sx(hoverX);
      g.strokeStyle = T.muted; g.lineWidth = 1; g.setLineDash([2, 3]);
      g.beginPath(); g.moveTo(xx, bandTop); g.lineTo(xx, y1); g.stroke(); g.setLineDash([]);
    }
    if (foot.length) {
      g.fillStyle = T.muted; g.font = `11px ${FONT_BODY}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      foot.forEach((f, i) => g.fillText(f, 14, H - 8 - (foot.length - 1 - i) * 15));
    }
    g.restore();
    return { x0, x1, y0, y1, sx, sy, inv: axisInv(spec.x, x0, x1) };
  }
  function drawMarker(g, x, y, kind, color, T) {
    g.save();
    if (kind === 'dot') {
      g.fillStyle = T.bg; g.beginPath(); g.arc(x, y, 5, 0, 2 * Math.PI); g.fill();
      g.fillStyle = color; g.beginPath(); g.arc(x, y, 3.6, 0, 2 * Math.PI); g.fill();
    } else if (kind === 'ring') {
      g.fillStyle = T.bg; g.beginPath(); g.arc(x, y, 4.4, 0, 2 * Math.PI); g.fill();
      g.strokeStyle = color; g.lineWidth = 1.6; g.beginPath(); g.arc(x, y, 3.2, 0, 2 * Math.PI); g.stroke();
    } else if (kind === 'x') {
      g.strokeStyle = color; g.lineWidth = 1.8; g.beginPath();
      g.moveTo(x - 3.5, y - 3.5); g.lineTo(x + 3.5, y + 3.5); g.moveTo(x + 3.5, y - 3.5); g.lineTo(x - 3.5, y + 3.5); g.stroke();
    }
    g.restore();
  }
  class Chart {
    constructor(box, heightFn) {
      this.box = box; this.heightFn = heightFn || (w => clamp(w * 0.55, 260, 430));
      this.canvas = el('canvas'); this.tip = el('div', { class: 'tip', hidden: '' });
      box.appendChild(this.canvas); box.appendChild(this.tip);
      this.spec = null; this.hoverX = null; this.layout = null;
      this.canvas.addEventListener('pointermove', e => this.onMove(e));
      this.canvas.addEventListener('pointerleave', () => { this.hoverX = null; this.tip.hidden = true; this.draw(); });
      if (window.ResizeObserver) { let lastW = 0; new ResizeObserver(() => { const w = this.box.clientWidth; if (Math.abs(w - lastW) > 1) { lastW = w; this.draw(); } }).observe(box); }
    }
    set(spec) { this.spec = spec; this.draw(); }
    draw() {
      if (!this.spec || !TH) return;
      const w = Math.max(280, this.box.clientWidth || 600), h = this.heightFn(w);
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
      this.canvas.style.height = h + 'px';
      const g = this.canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.layout = drawChart(g, w, h, this.spec, TH, this.hoverX, false);
    }
    onMove(e) {
      if (!this.spec || !this.layout) return;
      const r = this.canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const L = this.layout;
      if (px < L.x0 - 10 || px > L.x1 + 10) { this.hoverX = null; this.tip.hidden = true; this.draw(); return; }
      const xs = this.spec.hoverXs || [...new Set(this.spec.series.flatMap(s => s.pts.map(p => p.x)))].sort((a, b) => a - b);
      if (!xs.length) return;
      let best = xs[0], bd = Infinity;
      for (const x of xs) { const d = Math.abs(L.sx(x) - px); if (d < bd) { bd = d; best = x; } }
      this.hoverX = best; this.draw();
      const html = this.spec.tooltip ? this.spec.tooltip(best) : null;
      if (!html) { this.tip.hidden = true; return; }
      this.tip.innerHTML = html; this.tip.hidden = false;
      const tw = this.tip.offsetWidth, bw = this.box.clientWidth;
      let left = L.sx(best) + 14; if (left + tw > bw) left = L.sx(best) - tw - 14;
      this.tip.style.left = Math.max(0, left) + 'px'; this.tip.style.top = clamp(py - 20, 0, 9999) + 'px';
    }
    exportBlob(width, height) {
      const cv = document.createElement('canvas'); const s = 2;
      cv.width = width * s; cv.height = height * s;
      const g = cv.getContext('2d'); g.setTransform(s, 0, 0, s, 0, 0);
      drawChart(g, width, height, this.spec, LIGHT, null, true);
      return new Promise(res => cv.toBlob(res, 'image/png'));
    }
  }

  // ------------------------------------------------------------------ downloads
  async function saveFile(filename, data) {
    try {
      if (window.claude && typeof window.claude.use === 'function') {
        const dl = await window.claude.use('downloads');
        if (dl) {
          try { await dl.save({ filename, data }); toast('Saved ' + filename); }
          catch (e) {
            const code = e && e.code;
            if (code === 'declined') toast('Save cancelled');
            else if (code === 'rate_limited') toast('Another save is still open. Try again in a moment.');
            else toast('This view cannot save files (' + (code || 'unavailable') + ').');
          }
          return;
        }
      }
    } catch (e) { /* fall through to a plain browser download */ }
    const blob = data instanceof Blob ? data : new Blob([data], { type: filename.endsWith('.csv') ? 'text/csv' : 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('Saved ' + filename);
  }
  function settingsLines() {
    const p = state.p, f = p.flash, gl = p.glow, st = p.study;
    return [
      `Flash cloud: ${f.length} m x ${f.width} m, side-on peak ${f.peakSide} W/sr (3-5 um), duration ${(f.duration * 1e3).toFixed(2)} ms, rise ${(f.rise * 1e3).toFixed(2)} ms, opacity ${f.opacity}, ignition delay ${(f.onset * 1e3).toFixed(2)} ms`,
      `Barrel glow: ${gl.on ? 'on' : 'off'}, on-axis peak ${gl.peak} W/sr before the cloud, fade ${(gl.decay * 1e3).toFixed(2)} ms, model ${gl.model}, bore ${(gl.bore * 1e3).toFixed(2)} mm, barrel ${gl.barrel} m`,
      `Suppressor: ${p.suppressor.on ? 'on, flash /' + p.suppressor.flashFactor + ', glow ' + p.suppressor.glowMode : 'off'}`,
      `Air: extinction ${p.atmosphere.beta} /km, scene ${p.atmosphere.sceneT} K`,
      `Realistic case: flash brightness +/-${Math.round(st.flashVar * 100)}%, glow +/-${Math.round(st.glowVar * 100)}%, size +/-${Math.round(st.shapeVar * 100)}%, timing +/-${Math.round(st.timeVar * 100)}% (1 sigma); detection ${st.detSNR} sigma; required ${Math.round(st.pc * 100)}% correct; ${C.qualityN(st.quality)} detected shots per class`,
      'Sensors: ' + state.sensors.map(s => `${s.short} ${s.nx}x${s.ny} ${s.fov}deg F/${s.fnum} ${s.frameRate} Hz exposure ${(s.tint * 1e3).toFixed(3)} ms`).join('; ')
    ];
  }
  function csv(rows) { return rows.map(r => r.map(v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n') + '\n'; }
  function csvWithHeader(rows) { return settingsLines().map(l => '# ' + l).join('\n') + '\n' + csv(rows); }

  // ------------------------------------------------------------------ controls
  const KIND = { MODEL: 1, VIEW: 2, STUDY: 3, BALLISTIC: 4 };
  const ctlRefs = [];
  function numCtl(o) {
    const id = 'c-' + o.id;
    const wrap = el('div', { class: 'ctl' });
    const num = el('input', { type: 'number', id: id + '-n', step: o.step || 'any', 'aria-label': o.label + (o.unit ? ' (' + o.unit + ')' : '') });
    const rng = el('input', { type: 'range', id, min: o.log || o.map ? 0 : o.min, max: o.log || o.map ? 1000 : o.max, step: o.log || o.map ? 1 : (o.step || 'any') });
    const toSlider = v => {
      if (o.map) return o.map.to(v);
      if (o.log) return Math.round(1000 * Math.log(v / o.min) / Math.log(o.max / o.min));
      return v;
    };
    const fromSlider = s => {
      if (o.map) return o.map.from(+s);
      if (o.log) return o.min * Math.pow(o.max / o.min, s / 1000);
      return +s;
    };
    const show = () => { const v = o.get(); num.value = o.fmt ? o.fmt(v) : v; rng.value = toSlider(v); };
    rng.addEventListener('input', () => { let v = fromSlider(rng.value); if (o.round) v = o.round(v); o.set(v); num.value = o.fmt ? o.fmt(o.get()) : o.get(); changed(o.kind); });
    num.addEventListener('change', () => { let v = parseFloat(num.value); if (!isFinite(v)) { show(); return; } v = clamp(v, o.min, o.max); o.set(v); show(); changed(o.kind); });
    wrap.appendChild(el('div', { class: 'ctl-head' }, [el('label', { for: id, text: o.label }), el('span', { class: 'val' }, [num, el('span', { class: 'unit', text: o.unit || '' })])]));
    wrap.appendChild(rng);
    if (o.hint) wrap.appendChild(el('div', { class: 'hint', text: o.hint }));
    show();
    ctlRefs.push(show);
    return wrap;
  }
  function selectCtl(o) {
    const id = 'c-' + o.id;
    const s = el('select', { id });
    o.options.forEach(([v, t]) => s.appendChild(el('option', { value: v, text: t })));
    s.value = o.get();
    s.addEventListener('change', () => { o.set(s.value); changed(o.kind); });
    ctlRefs.push(() => { s.value = o.get(); });
    const w = el('div', { class: 'ctl' }, [el('div', { class: 'ctl-head' }, [el('label', { for: id, text: o.label })]), s]);
    if (o.hint) w.appendChild(el('div', { class: 'hint', text: o.hint }));
    return w;
  }
  function toggleCtl(o) {
    const id = 'c-' + o.id;
    const cb = el('input', { type: 'checkbox', id });
    cb.checked = !!o.get();
    cb.addEventListener('change', () => { o.set(cb.checked); changed(o.kind); });
    ctlRefs.push(() => { cb.checked = !!o.get(); });
    const w = el('div', { class: 'ctl' }, [el('label', { class: 'toggle', for: id }, [cb, o.label])]);
    if (o.hint) w.appendChild(el('div', { class: 'hint', text: o.hint }));
    return w;
  }
  function group(title, open, kids, subFn) {
    const sub = el('span', { class: 'sub' });
    const d = el('details', { class: 'group' }, [el('summary', {}, [el('span', { text: title }), sub]), el('div', { class: 'group-body' }, kids)]);
    if (open) d.open = true;
    if (subFn) ctlRefs.push(() => { sub.textContent = subFn(); });
    return d;
  }
  const ANGLE_MAP = {
    to: v => (v <= 0 ? 0 : Math.round(1 + 999 * Math.log(v / 0.05) / Math.log(90 / 0.05))),
    from: s => (s <= 0 ? 0 : 0.05 * Math.pow(90 / 0.05, (s - 1) / 999))
  };
  let derivedBoxes = {};
  function buildRail() {
    const p = state.p, v = state.view;
    const rail = $('rail');
    rail.innerHTML = '';
    // Scenario
    const sensSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Sensor for the live view' });
    state.sensors.forEach((s, i) => {
      const b = el('button', { type: 'button', 'aria-pressed': String(i === v.sensor) }, [el('span', { class: 'swatch', style: `background:var(--s${i + 1})` }), s.short]);
      b.addEventListener('click', () => { v.sensor = i; [...sensSeg.children].forEach((c, j) => c.setAttribute('aria-pressed', String(j === i))); changed(KIND.VIEW); });
      sensSeg.appendChild(b);
    });
    rail.appendChild(group('Scenario', true, [
      el('div', { class: 'ctl' }, [el('div', { class: 'ctl-head' }, [el('span', { text: 'Sensor shown' })]), sensSeg]),
      numCtl({ id: 'range', label: 'Distance to shooter', unit: 'm', min: 50, max: 800, step: 5, get: () => v.range, set: x => { v.range = Math.round(x / 5) * 5; }, kind: KIND.VIEW }),
      numCtl({ id: 'angle', label: 'Angle off the barrel line', unit: '°', min: 0, max: 90, step: 0.01, map: ANGLE_MAP, get: () => v.angle, set: x => { v.angle = x; }, fmt: x => +x.toPrecision(3), round: x => +x.toPrecision(2), kind: KIND.VIEW, hint: '0° is dead-on. The slider is logarithmic so small angles get room.' })
    ], () => `${v.range} m · ${fmtAngle(v.angle)}`));
    // Flash
    rail.appendChild(group('Flash cloud', true, [
      numCtl({ id: 'fpeak', label: 'Side-on peak brightness', unit: 'W/sr', min: 5, max: 100, step: 1, get: () => p.flash.peakSide, set: x => { p.flash.peakSide = x; }, kind: KIND.MODEL, hint: '3–5 µm. Kastek et al. report about 57 W/sr front and 68 W/sr side for a rifle.' }),
      numCtl({ id: 'flen', label: 'Length along the barrel', unit: 'm', min: 0.2, max: 1.5, step: 0.01, get: () => p.flash.length, set: x => { p.flash.length = x; }, kind: KIND.MODEL }),
      numCtl({ id: 'fwid', label: 'Width', unit: 'm', min: 0.1, max: 0.8, step: 0.01, get: () => p.flash.width, set: x => { p.flash.width = x; }, kind: KIND.MODEL }),
      numCtl({ id: 'fdur', label: 'Duration (to 10 % of peak)', unit: 'ms', min: 0.5, max: 6, step: 0.1, get: () => p.flash.duration * 1e3, set: x => { p.flash.duration = x / 1e3; }, kind: KIND.MODEL }),
      numCtl({ id: 'frise', label: 'Rise time', unit: 'ms', min: 0.05, max: 1.5, step: 0.01, get: () => p.flash.rise * 1e3, set: x => { p.flash.rise = x / 1e3; }, kind: KIND.MODEL }),
      numCtl({ id: 'fopa', label: 'Opacity across the width', unit: 'τ', min: 0, max: 3, step: 0.05, get: () => p.flash.opacity, set: x => { p.flash.opacity = x; }, kind: KIND.MODEL, hint: 'Optical depth straight across the cloud. 0 is see-through, 3 is nearly opaque. It also dims the barrel glow shining through the cloud.' }),
      numCtl({ id: 'fdel', label: 'Ignition delay after the bullet leaves', unit: 'ms', min: 0, max: 1, step: 0.05, get: () => p.flash.onset * 1e3, set: x => { p.flash.onset = x / 1e3; }, kind: KIND.MODEL, hint: 'A delay gives fast sensors a moment when only the barrel glow is visible. Not assumed by default.' }),
      derivedBox('flash')
    ], () => `${p.flash.peakSide} W/sr`));
    // Glow
    rail.appendChild(group('Barrel glow', true, [
      toggleCtl({ id: 'gon', label: 'Hot gas in the barrel is visible', get: () => p.glow.on, set: x => { p.glow.on = x; }, kind: KIND.MODEL }),
      numCtl({ id: 'gpeak', label: 'On-axis peak brightness', unit: 'W/sr', min: 0.1, max: 100, log: true, step: 'any', fmt: x => +x.toPrecision(3), get: () => p.glow.peak, set: x => { p.glow.peak = x; }, kind: KIND.MODEL, hint: 'Before passing through the cloud. 1–4 W/sr matches gas at 1500–2500 K filling a 7.62 mm hole.' }),
      numCtl({ id: 'gdec', label: 'Fade time', unit: 'ms', min: 0.2, max: 5, step: 0.05, get: () => p.glow.decay * 1e3, set: x => { p.glow.decay = x / 1e3; }, kind: KIND.MODEL }),
      selectCtl({ id: 'gmodel', label: 'How it fades off-axis', options: [['edge', 'Hard edge: only while the far end of the bore is visible'], ['column', 'Soft tail: see-through gas column']], get: () => p.glow.model, set: x => { p.glow.model = x; }, kind: KIND.MODEL }),
      numCtl({ id: 'gbore', label: 'Bore diameter', unit: 'mm', min: 5, max: 13, step: 0.01, get: () => p.glow.bore * 1e3, set: x => { p.glow.bore = x / 1e3; }, kind: KIND.MODEL }),
      numCtl({ id: 'gbar', label: 'Barrel length', unit: 'm', min: 0.3, max: 0.8, step: 0.01, get: () => p.glow.barrel, set: x => { p.glow.barrel = x; }, kind: KIND.MODEL }),
      derivedBox('glow')
    ], () => p.glow.on ? `${sig(p.glow.peak, 2)} W/sr` : 'off'));
    // Suppressor
    rail.appendChild(group('Suppressor', false, [
      toggleCtl({ id: 'son', label: 'Suppressor fitted', get: () => p.suppressor.on, set: x => { p.suppressor.on = x; }, kind: KIND.MODEL }),
      numCtl({ id: 'sfac', label: 'Flash made dimmer by', unit: '×', min: 2, max: 50, step: 1, get: () => p.suppressor.flashFactor, set: x => { p.suppressor.flashFactor = Math.round(x); }, kind: KIND.MODEL }),
      selectCtl({ id: 'sglow', label: 'Barrel glow with the suppressor', options: [['unchanged', 'Unchanged'], ['dimmed', 'Dimmed by the same factor'], ['hidden', 'Hidden completely']], get: () => p.suppressor.glowMode, set: x => { p.suppressor.glowMode = x; }, kind: KIND.MODEL, hint: 'Unknown, so it is a separate choice.' })
    ], () => p.suppressor.on ? `on, ÷${p.suppressor.flashFactor}` : 'off'));
    // Air
    rail.appendChild(group('Air', false, [
      numCtl({ id: 'beta', label: 'Loss rate in 3–5 µm', unit: '/km', min: 0, max: 2, step: 0.05, get: () => p.atmosphere.beta, set: x => { p.atmosphere.beta = x; }, kind: KIND.MODEL, hint: 'Simple exponential loss. 0.3 /km loses 21 % at 800 m. Real 3–5 µm loss depends on humidity and is stronger for hot CO₂ emission; run MODTRAN for real numbers.' }),
      numCtl({ id: 'sceneT', label: 'Background temperature', unit: 'K', min: 250, max: 330, step: 1, get: () => p.atmosphere.sceneT, set: x => { p.atmosphere.sceneT = x; }, kind: KIND.MODEL, hint: 'Sets the background light in each pixel and so the cameras’ noise and how full their pixels are.' })
    ], () => `${p.atmosphere.beta} /km`));
    // Sensors
    rail.appendChild(buildSensorGroup());
    // Study
    const st = p.study;
    rail.appendChild(group('Study settings', false, [
      numCtl({ id: 'pc', label: 'Required correct calls', unit: '%', min: 70, max: 99, step: 1, get: () => Math.round(st.pc * 100), set: x => { st.pc = Math.round(x) / 100; }, kind: KIND.STUDY, hint: 'A sensor can tell an angle apart from dead-on when it calls the two correctly this often.' }),
      numCtl({ id: 'det', label: 'Detection threshold', unit: 'σ', min: 3, max: 10, step: 0.5, get: () => st.detSNR, set: x => { st.detSNR = x; }, kind: KIND.STUDY }),
      numCtl({ id: 'fvar', label: 'Flash brightness variation', unit: '%', min: 0, max: 60, step: 1, get: () => Math.round(st.flashVar * 100), set: x => { st.flashVar = x / 100; }, kind: KIND.STUDY, hint: 'Shot-to-shot spread (1 σ), realistic case only.' }),
      numCtl({ id: 'gvar', label: 'Glow brightness variation', unit: '%', min: 0, max: 60, step: 1, get: () => Math.round(st.glowVar * 100), set: x => { st.glowVar = x / 100; }, kind: KIND.STUDY }),
      numCtl({ id: 'svar', label: 'Flash size variation', unit: '%', min: 0, max: 40, step: 1, get: () => Math.round(st.shapeVar * 100), set: x => { st.shapeVar = x / 100; }, kind: KIND.STUDY }),
      numCtl({ id: 'tvar', label: 'Flash and glow timing variation', unit: '%', min: 0, max: 40, step: 1, get: () => Math.round(st.timeVar * 100), set: x => { st.timeVar = x / 100; }, kind: KIND.STUDY }),
      selectCtl({ id: 'qual', label: 'Simulated shots per angle', options: [['fast', '150 (fast)'], ['normal', '300'], ['fine', '600 (slow)']], get: () => st.quality, set: x => { st.quality = x; }, kind: KIND.STUDY }),
      numCtl({ id: 'swr', label: 'Distance for the glow-brightness plot', unit: 'm', min: 50, max: 800, step: 50, get: () => st.sweepRange, set: x => { st.sweepRange = Math.round(x / 50) * 50; }, kind: KIND.STUDY }),
      selectCtl({ id: 'ammo', label: 'Round', options: [['M80', 'M80 ball, 147 gr'], ['M118LR', 'M118LR sniper, 175 gr']], get: () => st.ammo, set: x => { st.ammo = x; }, kind: KIND.BALLISTIC }),
      numCtl({ id: 'lat', label: 'Processing delay', unit: 'ms', min: 0, max: 300, step: 5, get: () => Math.round(st.latency * 1e3), set: x => { st.latency = x / 1e3; }, kind: KIND.BALLISTIC })
    ], () => `${Math.round(st.pc * 100)} % correct`));
    rail.appendChild(el('div', { class: 'rail-actions' }, [
      el('button', { class: 'btn', type: 'button', onclick: () => { state.p = C.defaultParams(); state.sensors = C.defaultSensors(); state.view = Object.assign(state.view, { sensor: 1, range: 300, angle: 2 }); buildRail(); changed(KIND.MODEL); toast('Defaults restored'); } }, ['Restore defaults'])
    ]));
    refreshDerived();
    ctlRefs.forEach(f => f());
  }
  function derivedBox(key) { const b = el('div', { class: 'derived' }); derivedBoxes[key] = b; return b; }
  function buildSensorGroup() {
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Sensor to edit' });
    const body = el('div', { style: 'display:grid;gap:10px' });
    function renderBody() {
      body.innerHTML = '';
      const s = state.sensors[state.editSensor];
      body.appendChild(el('p', { class: 'hint', text: s.desc }));
      const K = KIND.MODEL;
      body.appendChild(numCtl({ id: 'snx', label: 'Pixels across', unit: 'px', min: 1, max: 2048, step: 1, get: () => s.nx, set: x => { s.nx = Math.max(1, Math.round(x)); s.ny = Math.max(1, Math.round(s.nx * 0.8)); }, kind: K }));
      body.appendChild(numCtl({ id: 'spitch', label: 'Pixel size', unit: 'µm', min: 5, max: 3000, log: true, fmt: x => +x.toPrecision(3), get: () => s.pitch * 1e6, set: x => { s.pitch = x / 1e6; }, kind: K }));
      body.appendChild(numCtl({ id: 'sfov', label: 'Field of view (across)', unit: '°', min: 2, max: 140, step: 1, get: () => s.fov, set: x => { s.fov = x; }, kind: K }));
      body.appendChild(numCtl({ id: 'sfn', label: 'Lens f-number', unit: 'F/', min: 0.7, max: 8, step: 0.1, get: () => s.fnum, set: x => { s.fnum = x; }, kind: K }));
      body.appendChild(numCtl({ id: 'sfr', label: 'Frame rate', unit: 'Hz', min: 10, max: 20000, log: true, fmt: x => Math.round(x), get: () => s.frameRate, set: x => { s.frameRate = Math.round(x); }, kind: K }));
      body.appendChild(numCtl({ id: 'stint', label: 'Exposure time', unit: 'ms', min: 0.005, max: 50, log: true, fmt: x => +x.toPrecision(3), get: () => s.tint * 1e3, set: x => { s.tint = x / 1e3; }, kind: K, hint: 'Capped at one frame period.' }));
      body.appendChild(numCtl({ id: 'sqe', label: 'Quantum efficiency', unit: '', min: 0.05, max: 1, step: 0.01, get: () => s.qe, set: x => { s.qe = x; }, kind: K }));
      body.appendChild(numCtl({ id: 'stau', label: 'Optics transmission', unit: '', min: 0.2, max: 1, step: 0.01, get: () => s.tau, set: x => { s.tau = x; }, kind: K }));
      if (isFinite(s.well)) body.appendChild(numCtl({ id: 'swell', label: 'Full well', unit: 'Me⁻', min: 0.1, max: 100, log: true, fmt: x => +x.toPrecision(3), get: () => s.well / 1e6, set: x => { s.well = x * 1e6; }, kind: K, hint: 'Pixels clip here. Saturated pixels carry no shape or brightness information.' }));
      if (s.read > 0 || isFinite(s.well)) body.appendChild(numCtl({ id: 'sread', label: 'Read noise', unit: 'e⁻', min: 0, max: 2000, step: 10, get: () => s.read, set: x => { s.read = x; }, kind: K }));
      if (s.dstar > 0) body.appendChild(numCtl({ id: 'sdstar', label: 'Detectivity D*', unit: 'Jones', min: 1e8, max: 1e11, log: true, fmt: x => x.toExponential(2), get: () => s.dstar, set: x => { s.dstar = x; }, kind: K, hint: 'Uncooled PbSe datasheets give 2–6 × 10⁹ at peak; the default is lower because the response falls off above about 4.7 µm.' }));
      body.appendChild(derivedBox('sensor'));
      refreshDerived();
    }
    state.sensors.forEach((s, i) => {
      const b = el('button', { type: 'button', 'aria-pressed': String(i === state.editSensor) }, [el('span', { class: 'swatch', style: `background:var(--s${i + 1})` }), s.short]);
      b.addEventListener('click', () => { state.editSensor = i; [...seg.children].forEach((c, j) => c.setAttribute('aria-pressed', String(j === i))); renderBody(); });
      seg.appendChild(b);
    });
    renderBody();
    return group('Sensors', false, [seg, body], () => state.sensors[state.editSensor].short);
  }
  function kv(box, rows) { box.innerHTML = ''; rows.forEach(([k, v]) => { box.appendChild(el('span', { text: k })); box.appendChild(el('b', { text: v })); }); }
  function refreshDerived() {
    const p = state.p;
    if (derivedBoxes.flash) {
      const fr = C.plumeIntensity(p, 0) / C.plumeIntensity(p, 90 * D);
      kv(derivedBoxes.flash, [
        ['Front / side brightness', fr.toFixed(2) + ' (measured 0.83)'],
        ['Dead-on peak', sig(C.plumeIntensity(p, 0), 3) + ' W/sr'],
        ['Glow let through dead-on', Math.round(100 * C.glowCloudTransmission(p, 0)) + ' %']
      ]);
    }
    if (derivedBoxes.glow) {
      kv(derivedBoxes.glow, [
        ['Visible within', C.glowCutoffDeg(p.glow).toFixed(2) + '° of the barrel'],
        ['Same as a black body at', Math.round(C.glowEquivalentTemperature(p.glow)) + ' K'],
        ['Reaches a dead-on sensor', sig(C.glowIntensity(p, 0), 3) + ' W/sr']
      ]);
    }
    if (derivedBoxes.sensor) {
      const s = state.sensors[state.editSensor];
      const d = C.sensorDerived(s, p.atmosphere);
      const rows = [
        ['Lens diameter', (d.D * 1e3).toFixed(2) + ' mm'],
        ['Focal length', (d.f * 1e3).toFixed(2) + ' mm'],
        ['Pixel angle', s.nx > 1 ? (d.ifov * 1e3).toFixed(2) + ' mrad' : s.fov + '° (whole view)'],
        ['Exposure used', (d.tint * 1e3).toFixed(3) + ' ms' + (d.tintClamped ? ' (capped)' : '')]
      ];
      if (isFinite(s.well)) rows.push(['Background fills', Math.round(100 * d.wellFill) + ' % of a pixel']);
      rows.push(['Noise per reading', sig(d.sigma, 3) + ' e⁻'], ['NETD (300 K scene)', (d.netd * 1e3).toFixed(1) + ' mK']);
      kv(derivedBoxes.sensor, rows);
    }
  }

  // ------------------------------------------------------------------ change handling
  let liveTimer = null, studyTimer = null;
  function changed(kind) {
    ctlRefs.forEach(f => f());
    refreshDerived();
    renderChips();
    if (kind === KIND.MODEL || kind === KIND.STUDY) {
      cancelStudy();
      state.progress = { frac: 0, label: 'Settings changed. Updating…', running: false, stale: true };
      renderProgress();
      clearTimeout(studyTimer); studyTimer = setTimeout(startStudy, 650);
    }
    if (kind === KIND.MODEL || kind === KIND.BALLISTIC) { balCache = null; }
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { renderLive(); renderStrip(); renderBallistics(); renderAnswer(); renderMain(); renderSweep(); }, 40);
  }
  function renderChips() {
    const p = state.p, c = $('chips');
    c.innerHTML = '';
    const chip = (cls, txt) => c.appendChild(el('span', { class: 'chip ' + cls }, [el('i'), txt]));
    const pr = state.progress;
    if (pr.running) chip('run', `Study ${Math.round(pr.frac * 100)} %`);
    else if (pr.stale) chip('warn', 'Study out of date');
    else chip('ok', 'Study up to date');
    chip(p.glow.on ? 'ok' : 'warn', p.glow.on ? `Glow ${sig(p.glow.peak, 2)} W/sr` : 'Glow off');
    if (p.suppressor.on) chip('warn', `Suppressor ÷${p.suppressor.flashFactor}`);
    chip('', `Flash ${p.flash.peakSide} W/sr`);
  }

  // ------------------------------------------------------------------ study runner (time-sliced)
  function* studyGen(P, sensors) {
    const nS = sensors.length;
    const res = { ranges: RANGES.slice(), best: sensors.map(() => []), real: sensors.map(() => []), sweepVals: SWEEP.slice(), sweepRange: P.study.sweepRange, sweepBest: sensors.map(() => []), sweepReal: sensors.map(() => []), done: false };
    state.results = res;
    const units = nS * RANGES.length * 2 + nS * SWEEP.length;
    let done = 0;
    const prog = (label) => { state.progress.frac = done / units; state.progress.label = label; };
    for (let si = 0; si < nS; si++) for (let ri = 0; ri < RANGES.length; ri++) {
      res.best[si][ri] = C.bestCaseThreshold(P, sensors[si], RANGES[ri]);
      done++; prog(`Best case: ${sensors[si].short}, ${RANGES[ri]} m`);
      yield 'best';
    }
    for (let si = 0; si < nS; si++) for (let ri = 0; ri < RANGES.length; ri++) {
      prog(`Realistic case: ${sensors[si].short}, ${RANGES[ri]} m`);
      const r = yield* C.realisticThreshold(P, sensors[si], RANGES[ri], si, ri);
      res.real[si][ri] = r; done++;
      yield 'real';
    }
    for (let gi = 0; gi < SWEEP.length; gi++) {
      const Q = C.clone(P); Q.glow.on = true; Q.glow.peak = SWEEP[gi];
      for (let si = 0; si < nS; si++) {
        prog(`Glow brightness ${SWEEP[gi]} W/sr: ${sensors[si].short}`);
        res.sweepBest[si][gi] = C.bestCaseThreshold(Q, sensors[si], P.study.sweepRange);
        const r = yield* C.realisticThreshold(Q, sensors[si], P.study.sweepRange, si, 100 + gi);
        res.sweepReal[si][gi] = r; done++;
        yield 'sweep';
      }
    }
    res.done = true;
  }
  function cancelStudy() { if (state.job) state.job.cancelled = true; state.job = null; }
  function startStudy() {
    cancelStudy();
    const P = C.clone(state.p), sensors = C.clone(state.sensors);
    const job = { gen: studyGen(P, sensors), cancelled: false, lastDraw: 0 };
    state.job = job;
    state.progress = { frac: 0, label: 'Starting…', running: true, stale: false };
    renderChips(); renderProgress();
    const pump = () => {
      if (job.cancelled) return;
      const t0 = performance.now();
      let r = null, kinds = new Set();
      while (performance.now() - t0 < 14) {
        r = job.gen.next();
        if (r.done) break;
        if (r.value && r.value !== 1) kinds.add(r.value);
      }
      const now = performance.now();
      if (r && r.done) {
        state.progress = { frac: 1, label: 'Study complete.', running: false, stale: false };
        state.job = null;
        renderProgress(); renderChips(); renderAnswer(); renderMain(); renderSweep(); renderLiveReadouts();
        return;
      }
      if (now - job.lastDraw > 350) {
        job.lastDraw = now;
        renderProgress(); renderChips();
        if (kinds.size) { renderAnswer(); renderMain(); renderSweep(); }
      }
      setTimeout(pump, 0);
    };
    setTimeout(pump, 0);
  }
  function renderProgress() {
    const pr = state.progress;
    $('prog-bar').style.width = Math.round(pr.frac * 100) + '%';
    $('prog-label').textContent = pr.running ? `${Math.round(pr.frac * 100)} % · ${pr.label}` : pr.label;
  }

  // ------------------------------------------------------------------ ballistics
  let balCache = null;
  function ballistics() {
    if (balCache) return balCache;
    balCache = { M80: C.ballisticsTable(C.AMMO.M80, BAL_RANGES), M118LR: C.ballisticsTable(C.AMMO.M118LR, BAL_RANGES) };
    return balCache;
  }
  function balAt(ammoId, R) {
    const t = ballistics()[ammoId];
    if (R <= t[0].R) return t[0];
    for (let i = 1; i < t.length; i++) if (t[i].R >= R) {
      const a = t[i - 1], b = t[i], f = (R - a.R) / (b.R - a.R);
      const o = {}; for (const k in a) o[k] = a[k] + f * (b[k] - a[k]);
      return o;
    }
    return t[t.length - 1];
  }
  function fmtWarn(t) { return t <= 0 ? 'none' : t.toFixed(2) + ' s'; }
  function warningTime(s, ammoId, R) {
    const sd = C.sensorDerived(s, state.p.atmosphere);
    return balAt(ammoId, R).tof - state.p.study.latency - sd.Tf;
  }

  // ------------------------------------------------------------------ answer block
  function renderAnswer() {
    const res = state.results, v = state.view, p = state.p;
    const ri = nearestRangeIndex(v.range), R = RANGES[ri];
    const ammo = p.study.ammo;
    const se = balAt(ammo, R).superDeg;
    $('answer-eyebrow').textContent = `Answer at ${R} m` + (R !== v.range ? ` (nearest computed distance to ${v.range} m)` : '');
    const tbl = $('answer-table');
    tbl.innerHTML = '';
    tbl.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Sensor' }), el('th', { class: 'num', text: 'Catches the flash' }), el('th', { class: 'num', text: 'Best case' }),
      el('th', { class: 'num', text: 'Realistic' }), el('th', { class: 'num', text: 'Realistic as miss distance' }), el('th', { class: 'num', text: 'Warning time' })
    ])]));
    const tb = el('tbody');
    state.sensors.forEach((s, si) => {
      const b = res && res.best[si] ? res.best[si][ri] : null;
      const r = res && res.real[si] ? res.real[si][ri] : null;
      const pd = r && r.pd != null ? Math.round(r.pd * 100) + ' %' : '…';
      const miss = r && r.value != null ? (r.flag === 'lt' ? '< ' : '') + fmtLen(R * Math.tan(r.value * D)) : (r ? '—' : '…');
      const realCell = el('td', { class: 'num' });
      if (r && r.flag === 'gt90') realCell.appendChild(el('span', { class: 'pill bad', text: 'cannot tell' }));
      else if (r && r.flag === 'undetected') realCell.appendChild(el('span', { class: 'pill warn', text: 'not detected' }));
      else realCell.textContent = resText(r);
      tb.appendChild(el('tr', {}, [
        el('td', {}, [el('span', { class: 'swatch', style: `background:var(--s${si + 1});margin-right:6px` }), s.short]),
        el('td', { class: 'num', text: pd }),
        el('td', { class: 'num', text: b ? (b.flag === 'undetected' ? 'not detected' : resText(b)) + (b.saturated ? ' · sat.' : '') : '…' }),
        realCell,
        el('td', { class: 'num', text: miss }),
        el('td', { class: 'num', text: fmtWarn(warningTime(s, ammo, R)) })
      ]));
    });
    tbl.appendChild(tb);
    // lead sentence
    const lead = $('answer-lead');
    const cut = C.glowCutoffDeg(p.glow);
    if (!res || !res.real.every(a => a[ri])) {
      lead.innerHTML = `Working out the realistic case for ${R} m. The shooter’s barrel points <strong>${fmtAngle(se)}</strong> above the target at this distance (${C.AMMO[ammo].name}), and the barrel glow is only visible within <strong>${fmtAngle(cut)}</strong> of the barrel line.`;
    } else {
      const ok = state.sensors.map((s, si) => ({ s, r: res.real[si][ri] })).filter(o => o.r.value != null);
      const bestReal = ok.sort((a, b) => a.r.value - b.r.value)[0];
      const bestB = state.sensors.map((s, si) => ({ s, r: res.best[si][ri] })).filter(o => o.r.value != null).sort((a, b) => a.r.value - b.r.value)[0];
      let txt = '';
      if (!bestReal) txt = `At ${R} m, with these settings, <strong>no sensor can reliably tell a shot aimed at you from one aimed well to the side</strong> in the realistic case: even for a sensor 90° off the barrel line, none calls “dead-on” vs “off-axis” correctly ${Math.round(p.study.pc * 100)} % of the time.`;
      else {
        const md = R * Math.tan(bestReal.r.value * D);
        txt = `At ${R} m the best sensor in the realistic case is the <strong>${bestReal.s.short.toLowerCase()}</strong>, which tells dead-on apart from <strong>${resText(bestReal.r)}</strong> off the barrel line: a shot that passes <strong>${fmtLen(md)}</strong> from you.`;
        txt += bestReal.r.value > cut ? ' That is outside the barrel-glow zone, so it relies on the flash shape and brightness.' : ' That is inside the barrel-glow zone, so the glow is doing the work.';
      }
      if (bestB) txt += ` With only sensor noise (best case) the ${bestB.s.short.toLowerCase()} could reach ${resText(bestB.r)}, so the limit is how much each flash differs from the last, not sensor noise.`;
      txt += ` The shooter’s barrel points ${fmtAngle(se)} above the target here (${C.AMMO[ammo].name}).`;
      lead.innerHTML = txt;
    }
    $('answer-note').textContent = `“Catches the flash” is how often a shot is detected at all (matched filter, ${p.study.detSNR} σ), with random exposure timing. The smallest angle is where the sensor calls “dead-on” vs “off-axis” correctly ${Math.round(p.study.pc * 100)} % of the time on detected shots. “sat.” means pixels saturate in the best case. Warning time: ${C.AMMO[ammo].name} flight time minus one frame and ${Math.round(p.study.latency * 1e3)} ms processing.`;
  }

  // ------------------------------------------------------------------ main and sweep charts
  let chartMain, chartSweep, chartTime, chartTof, chartSe;
  const ANG_AXIS = { type: 'log', min: 0.008, max: 90, ticks: [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 90], fmt: t => t < 1 ? t + '°' : t + '°', label: 'Smallest angle told apart from dead-on' };
  const MISS_AXIS = { type: 'log', min: 0.003, max: 3000, ticks: [0.01, 0.1, 1, 10, 100, 1000], fmt: t => t >= 1 ? t + ' m' : (t * 100) + ' cm', label: 'Smallest miss distance told apart from a direct hit' };
  const BANDS = [{ key: 'gt90', short: '> 90°', long: 'cannot tell, even 90° off' }, { key: 'undetected', short: 'none', long: 'flash not detected' }];
  function seriesFrom(list, xs, si, isBest, toY) {
    return {
      name: state.sensors[si].short + (isBest ? ' · best case' : ' · realistic'),
      color: TH.s[si], dash: isBest ? [5, 4] : [], width: isBest ? 1.5 : 2.4, marker: isBest ? 'ring' : 'dot',
      bandSlot: (si - 1.5) * 8, bandRow: isBest ? 0 : 1,
      pts: xs.map((x, i) => {
        const r = list[i];
        if (!r) return { x, y: null };
        if (r.value != null) return { x, y: toY(r.value, x), flag: r.flag };
        return { x, y: null, flag: r.flag };
      })
    };
  }
  function legendItems(extra) {
    const L = state.sensors.map((s, i) => ({ kind: 'block', color: TH.s[i], label: s.short }));
    L.push({ kind: 'line', color: TH.muted, width: 2.4, label: 'realistic', marker: 'dot' }, { kind: 'line', color: TH.muted, width: 1.5, dash: [5, 4], label: 'best case', marker: 'ring' });
    return L.concat(extra || []);
  }
  function mainSpec() {
    const res = state.results, p = state.p, ammo = p.study.ammo;
    const miss = state.mode === 'miss';
    const toY = (deg, R) => (miss ? R * Math.tan(deg * D) : deg);
    const series = [];
    if (res) state.sensors.forEach((s, si) => {
      series.push(seriesFrom(res.best[si] || [], RANGES, si, true, toY));
      series.push(seriesFrom(res.real[si] || [], RANGES, si, false, toY));
    });
    const cut = C.glowCutoffDeg(p.glow);
    const tab = ballistics()[ammo];
    const refs = [
      { kind: 'curve', pts: tab.filter(r => r.R >= 50).map(r => [r.R, miss ? r.R * Math.tan(r.superDeg * D) : r.superDeg]), color: TH.ink, dash: [1.5, 3], width: 1.6, label: 'the targeted soldier sits here (barrel aims high)', labelAt: tab.findIndex(r => r.R >= 425) - tab.findIndex(r => r.R >= 50), labelBelow: true },
      miss ? { kind: 'curve', pts: RANGES.map(R => [R, R * Math.tan(cut * D)]), color: TH.accent, dash: [6, 3], label: `glow zone edge (${fmtAngle(cut)})` }
        : { kind: 'h', y: cut, color: TH.accent, dash: [6, 3], label: `glow visible inside ${fmtAngle(cut)}`, align: 'left' }
    ];
    return {
      x: { type: 'lin', min: 40, max: 810, ticks: [50, 100, 200, 300, 400, 500, 600, 700, 800], fmt: t => t + ' m', label: 'Distance to the shooter' },
      y: miss ? MISS_AXIS : ANG_AXIS,
      bands: BANDS, series, refs, hoverXs: RANGES,
      legend: legendItems([{ kind: 'line', color: TH.ink, dash: [1.5, 3], width: 1.6, label: `target position (${C.AMMO[ammo].name})` }, { kind: 'line', color: TH.accent, dash: [6, 3], width: 1.25, label: 'glow zone edge' }]),
      title: 'Smallest angle off the barrel line told apart from dead-on',
      subtitle: `${Math.round(p.study.pc * 100)} % correct calls. Solid: realistic case; dashed: best case (sensor noise only).`,
      footnote: settingsLines().slice(0, 5),
      tooltip: x => tipRows(RANGES.indexOf(x), x + ' m', res && res.best, res && res.real, toY, miss)
    };
  }
  function tipRows(i, head, best, real, toY, miss) {
    if (i < 0) return null;
    const f = (r, x) => {
      if (!r) return '…';
      if (r.value == null) return r.flag === 'gt90' ? '> 90°' : 'not seen';
      return miss ? fmtLen(toY(r.value, x)) : resText(r);
    };
    const x = parseFloat(head);
    let h = `<div style="margin-bottom:3px;color:var(--muted)">${head}</div>`;
    state.sensors.forEach((s, si) => {
      const b = best && best[si] ? best[si][i] : null, r = real && real[si] ? real[si][i] : null;
      h += `<div class="row"><span><span class="swatch" style="background:${TH.s[si]};display:inline-block;margin-right:5px"></span>${s.short}</span><span>${f(b, x)} · ${f(r, x)}${r && r.pd != null ? ` · ${Math.round(r.pd * 100)}%` : ''}</span></div>`;
    });
    h += `<div style="margin-top:3px;color:var(--muted)">best · realistic · catches</div>`;
    return h;
  }
  function renderMain() { if (chartMain) chartMain.set(mainSpec()); }
  function sweepSpec() {
    const res = state.results, p = state.p;
    const series = [];
    if (res) state.sensors.forEach((s, si) => {
      series.push(seriesFrom(res.sweepBest[si] || [], SWEEP, si, true, v => v));
      series.push(seriesFrom(res.sweepReal[si] || [], SWEEP, si, false, v => v));
    });
    const R = res ? res.sweepRange : p.study.sweepRange;
    const cut = C.glowCutoffDeg(p.glow);
    const refs = [
      { kind: 'h', y: cut, color: TH.accent, dash: [6, 3], label: `glow visible inside ${fmtAngle(cut)}` },
      { kind: 'v', x: clamp(p.glow.peak, 0.1, 100), color: TH.ink, dash: [2, 3], label: 'current glow' },
      { kind: 'v', x: C.plumeIntensity(p, 0), color: TH.muted, dash: [2, 3], label: 'flash, dead-on' }
    ];
    return {
      x: { type: 'log', min: 0.08, max: 125, ticks: [0.1, 0.3, 1, 3, 10, 30, 100], fmt: t => String(t), label: 'Barrel glow, on-axis peak before the cloud (W/sr)' },
      y: ANG_AXIS, bands: BANDS, series, refs, hoverXs: SWEEP,
      legend: legendItems([{ kind: 'line', color: TH.accent, dash: [6, 3], width: 1.25, label: 'glow zone edge' }]),
      title: `Smallest angle told apart from dead-on vs barrel-glow brightness, ${R} m`,
      subtitle: `${Math.round(p.study.pc * 100)} % correct calls. Solid: realistic case; dashed: best case (sensor noise only).`,
      footnote: settingsLines().slice(0, 5),
      tooltip: x => tipRows(SWEEP.indexOf(x), x + ' W/sr', res && res.sweepBest, res && res.sweepReal, v => v, false)
    };
  }
  function renderSweep() {
    const R = state.results ? state.results.sweepRange : state.p.study.sweepRange;
    $('sweep-sub').textContent = `At ${R} m. The glow is the only part of the signal that changes within a degree of the barrel line, and its brightness is the least certain number in the model.`;
    if (chartSweep) chartSweep.set(sweepSpec());
  }

  // ------------------------------------------------------------------ images
  // amber "white-hot" ramp; saturated pixels in cyan
  const RAMP = [[0, [11, 12, 10]], [0.22, [58, 26, 8]], [0.45, [150, 70, 0]], [0.7, [240, 162, 59]], [0.88, [255, 217, 138]], [1, [255, 251, 234]]];
  const LUT = (() => {
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let k = 0; while (k < RAMP.length - 2 && t > RAMP[k + 1][0]) k++;
      const a = RAMP[k], b = RAMP[k + 1], f = (t - a[0]) / (b[0] - a[0]);
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = a[1][c] + f * (b[1][c] - a[1][c]);
    }
    return lut;
  })();
  function rampCss() { return 'linear-gradient(90deg,' + RAMP.map(r => `rgb(${r[1].join(',')}) ${r[0] * 100}%`).join(',') + ')'; }
  function paint(canvas, data, W, H, vmax, satMask) {
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const im = g.createImageData(W, H);
    const satRGB = hexToRgb(TH.sat || '#2bb8d6');
    for (let i = 0; i < W * H; i++) {
      let r, gg, b;
      if (satMask && satMask[i]) { [r, gg, b] = satRGB; }
      else {
        const t = vmax > 0 ? clamp(data[i] / vmax, 0, 1) : 0;
        const k = Math.round(t * 255) * 3; r = LUT[k]; gg = LUT[k + 1]; b = LUT[k + 2];
      }
      im.data[i * 4] = r; im.data[i * 4 + 1] = gg; im.data[i * 4 + 2] = b; im.data[i * 4 + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }
  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // true flash: window u in [-0.3, 1.0] m, v +/- 0.4 m
  const TRUE_WIN = { x0: -0.3, spanX: 1.2, spanY: 1.2 };
  function paintTrue(canvas, thDeg, vmaxOverride, nx, ny, decor) {
    const p = state.p;
    const m = C.radianceMap(p, thDeg, nx, ny, TRUE_WIN.spanX, TRUE_WIN.spanY, TRUE_WIN.x0);
    const vmax = vmaxOverride || m.max;
    const off = document.createElement('canvas');
    paint(off, m.data, nx, ny, vmax, null);
    const W = canvas.width, H = canvas.height;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = true; g.fillStyle = '#0b0c0a'; g.fillRect(0, 0, W, H);
    g.drawImage(off, 0, 0, W, H);
    // muzzle and glow marker
    const mx = (0 - TRUE_WIN.x0) / TRUE_WIN.spanX * W, my = H / 2;
    const gI = C.glowIntensity(p, thDeg * D);
    if (gI > 0) {
      const rr = Math.max(2, Math.min(W * 0.06, 3 + 9 * Math.sqrt(gI / 2)));
      const grad = g.createRadialGradient(mx, my, 0, mx, my, rr * 2);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)'); grad.addColorStop(0.35, 'rgba(255,240,200,0.6)'); grad.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = grad; g.beginPath(); g.arc(mx, my, rr * 2, 0, 2 * Math.PI); g.fill();
    }
    if (decor) {
      g.strokeStyle = 'rgba(230,235,225,0.55)'; g.lineWidth = Math.max(1, W / 480);
      g.setLineDash([3, 3]); g.beginPath(); g.moveTo(mx, my - H * 0.06); g.lineTo(mx, my + H * 0.06); g.stroke(); g.setLineDash([]);
      // 10 cm scale bar
      const px10 = 0.1 / TRUE_WIN.spanX * W;
      g.fillStyle = 'rgba(230,235,225,0.85)'; g.fillRect(W - px10 - 12, H - 14, px10, 2);
      g.font = `${Math.max(10, W / 44)}px ${FONT_DATA}`; g.textAlign = 'right'; g.textBaseline = 'bottom';
      g.fillText('10 cm', W - 12, H - 17);
      g.textAlign = 'center'; g.textBaseline = 'top';
      const bpx = state.p.flash.width / 2 / TRUE_WIN.spanY * H;
      g.fillText('▲ muzzle', mx, my + bpx + 10);
    }
    return m.max;
  }

  // ------------------------------------------------------------------ live view
  let lastCapture = null;
  function renderLive() {
    const p = state.p, v = state.view, s = state.sensors[v.sensor];
    const sd = C.sensorDerived(s, p.atmosphere);
    const rng = C.makeRng(v.seed * 7919 + 13);
    const opts = { noise: v.noise, seed: v.seed, phase: v.random ? rng.u() * sd.Tf : 0, dx: v.random ? rng.u() - 0.5 : 0, dy: v.random ? rng.u() - 0.5 : 0, orient: 0 };
    const cap = C.simulateCapture(p, s, v.range, v.angle, opts);
    lastCapture = { cap, s, v: Object.assign({}, v), opts };
    $('live-sub').textContent = `${s.name} at ${v.range} m, ${fmtAngle(v.angle)} off the barrel line (the barrel line passes ${fmtLen(v.range * Math.tan(v.angle * D))} from the sensor).`;
    // true flash
    const tc = $('true-canvas');
    paintTrue(tc, v.angle, null, 220, 220, true);
    const g = C.plumeGeom(p.flash, v.angle * D);
    $('true-cap').textContent = `outline ${(2 * g.ap * 100).toFixed(0)} × ${(2 * g.b * 100).toFixed(0)} cm`;
    // sensor image: frame with most signal
    let kbest = 0;
    cap.frames.forEach((f, k) => { if (f.meanSum > cap.frames[kbest].meanSum) kbest = k; });
    const fr = cap.frames[kbest];
    const sc = $('sens-canvas');
    let vmax = 0; for (let i = 0; i < fr.img.length; i++) if (fr.img[i] > vmax) vmax = fr.img[i];
    if (fr.nsat) vmax = cap.satLevel;
    paint(sc, fr.img, cap.W, cap.W, Math.max(vmax, 3 * cap.sigma), fr.sat);
    $('sens-title').textContent = s.nx > 1 ? `${s.short}: brightest frame` : `${s.short}: one element, no image`;
    $('sens-cap').textContent = s.nx > 1 ? `${cap.W} × ${cap.W} px around the muzzle · ${(cap.ctx.sd.ifov * 1e3).toFixed(2)} mrad/px${fr.nsat ? ' · ' + fr.nsat + ' saturated' : ''}` : 'total signal only';
    renderTimeChart(cap, s);
    renderLiveReadouts();
  }
  function renderTimeChart(cap, s) {
    const p = state.p, v = state.view;
    const pp = C.plumePulse(p.flash), gp = C.glowPulse(p.glow);
    const tEnd = Math.max(pp.tEnd, p.glow.on ? gp.tEnd : 0) * 1.25;
    const t0 = -0.3e-3, t1 = Math.max(tEnd, 2e-3);
    const ser = C.irradianceSeries(p, v.range, v.angle, t0, t1, 260);
    let ymax = 0;
    ser.ep.forEach((e, i) => { ymax = Math.max(ymax, e + ser.eg[i]); });
    const vis = cap.frames.filter(f => f.end > t0 && f.start < t1);
    vis.forEach(f => { ymax = Math.max(ymax, f.irr); });
    const scl = siScale(ymax || 1e-9);
    const k = scl.k;
    const series = [
      { name: 'total', color: TH.ink, width: 2, pts: ser.t.map((t, i) => ({ x: t * 1e3, y: (ser.ep[i] + ser.eg[i]) * k })) },
      { name: 'flash cloud', color: TH.muted, width: 1.5, dash: [5, 3], pts: ser.t.map((t, i) => ({ x: t * 1e3, y: ser.ep[i] * k })) },
      { name: 'barrel glow', color: TH.accent, width: 1.75, pts: ser.t.map((t, i) => ({ x: t * 1e3, y: ser.eg[i] * k })) }
    ];
    const si = state.view.sensor;
    const rects = vis.map(f => ({ x0: Math.max(t0, f.start) * 1e3, x1: Math.min(t1, f.end) * 1e3, y: Math.max(0, f.irr) * k, color: TH.s[si], alpha: 0.28, edge: true }));
    const anySat = vis.some(f => f.nsat > 0);
    const satRefs = anySat ? vis.map(f => ({ kind: 'seg', x0: Math.max(t0, f.start) * 1e3, x1: Math.min(t1, f.end) * 1e3, y: f.meanIrr * k, color: TH.s[si], dash: [3, 3] })) : [];
    vis.forEach(f => { ymax = Math.max(ymax, f.meanIrr); });
    const ytop = (ymax || 1e-9) * k * 1.08;
    const step = niceStep(ytop / 4);
    const yt = []; for (let y = 0; y < ytop + step - 1e-12; y += step) yt.push(+y.toPrecision(6));
    const spec = {
      x: { type: 'lin', min: t0 * 1e3, max: t1 * 1e3, ticks: niceTicks(t0 * 1e3, t1 * 1e3, 6), fmt: t => sig(t, 2), label: 'Time after the bullet leaves the muzzle (ms)' },
      y: { type: 'lin', min: 0, max: yt[yt.length - 1] || ytop, ticks: yt, fmt: t => sig(t, 3), label: `Irradiance (${scl.p}W/m²)` },
      series, rects, refs: satRefs,
      legend: [{ kind: 'line', color: TH.ink, width: 2, label: 'total at the sensor' }, { kind: 'line', color: TH.muted, dash: [5, 3], width: 1.5, label: 'flash cloud' }, { kind: 'line', color: TH.accent, width: 1.75, label: 'barrel glow' }, { kind: 'block', color: TH.s[si], label: `${s.short}: average during each exposure` }].concat(anySat ? [{ kind: 'line', color: TH.s[si], dash: [3, 3], width: 1.25, label: 'what it would read without saturation' }] : []),
      title: `Signal over time: ${s.short}, ${v.range} m, ${fmtAngle(v.angle)} off the barrel line`,
      subtitle: vis.length ? `${vis.length} exposure${vis.length > 1 ? 's' : ''} overlap the flash` : 'No exposure overlaps the flash in this shot',
      footnote: settingsLines().slice(0, 4),
      tooltip: x => {
        const i = series[0].pts.findIndex(pt => pt.x === x);
        if (i < 0) return null;
        let h = `<div style="color:var(--muted)">${sig(x, 3)} ms</div>`;
        series.forEach(sr => { h += `<div class="row"><span>${sr.name}</span><span>${sig(sr.pts[i].y, 3)} ${scl.p}W/m²</span></div>`; });
        const f = vis.find(fr => x >= fr.start * 1e3 && x <= fr.end * 1e3);
        if (f) h += `<div class="row"><span>exposure average</span><span>${sig(f.irr * k, 3)} ${scl.p}W/m²</span></div>`;
        return h;
      }
    };
    chartTime.set(spec);
  }
  function niceStep(x) { const e = Math.pow(10, Math.floor(Math.log10(x))); const f = x / e; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e; }
  function niceTicks(a, b, n) { const st = niceStep((b - a) / n); const out = []; for (let t = Math.ceil(a / st) * st; t <= b + 1e-9; t += st) out.push(+t.toPrecision(6)); return out; }
  function renderLiveReadouts() {
    if (!lastCapture) return;
    const p = state.p, v = state.view, s = state.sensors[v.sensor];
    const { cap } = lastCapture;
    const th = v.angle * D;
    const Ip = C.plumeIntensity(p, th), Ig = C.glowIntensity(p, th);
    const sd = cap.ctx.sd;
    const g = C.plumeGeom(p.flash, th);
    const Lpx = 2 * g.ap / (v.range * sd.ifov), Wpx = 2 * g.b / (v.range * sd.ifov);
    let peak = 0, nsat = 0;
    cap.frames.forEach(f => { f.img.forEach(x => { if (x > peak) peak = x; }); nsat += f.nsat; });
    const ref = C.bestCaseReference(cap.ctx);
    const ri = nearestRangeIndex(v.range);
    const rr = state.results && state.results.real[v.sensor] ? state.results.real[v.sensor][ri] : null;
    const items = [
      ['Barrel line passes', fmtLen(v.range * Math.tan(th)) + ' from you'],
      ['Air lets through', Math.round(100 * C.atmTransmission(p, v.range)) + ' %'],
      ['Flash toward you', sig(Ip, 3) + ' W/sr'],
      ['Glow toward you', Ig > 0 ? sig(Ig, 3) + ' W/sr' : 'none'],
      ['Glow share of the light', (100 * Ig / (Ip + Ig)).toFixed(1) + ' %'],
      ['Bore far end visible', p.glow.on ? Math.round(100 * C.boreFraction(p.glow, th)) + ' %' : '—'],
      ['Flash size on sensor', s.nx > 1 ? `${sig(Lpx, 2)} × ${sig(Wpx, 2)} px` : 'one element'],
      ['Peak signal / noise', sig(ref.peakSNR, 3) + ' (best timing)'],
      ['Saturated pixels', isFinite(s.well) ? (nsat ? nsat + ' in this shot' : 'none') : 'cannot saturate'],
      ['Lens diameter', (sd.D * 1e3).toFixed(2) + ' mm'],
      ['Catches the flash', rr && rr.pd != null ? Math.round(rr.pd * 100) + ' % of shots' : '…'],
      ['Warning time', fmtWarn(warningTime(s, p.study.ammo, v.range))]
    ];
    const box = $('readouts'); box.innerHTML = '';
    items.forEach(([k, val]) => box.appendChild(el('div', { class: 'readout' }, [el('span', { class: 'k', text: k }), el('span', { class: 'v', text: val })])));
  }

  // ------------------------------------------------------------------ angle strip
  let stripCells = null;
  function renderStrip() {
    const p = state.p, v = state.view;
    const box = $('strip');
    box.innerHTML = '';
    box.appendChild(el('div'));
    STRIP_ANGLES.forEach(a => box.appendChild(el('div', { class: 'hd', text: a + '°' })));
    stripCells = [];
    // true flash row: common brightness scale
    const maxes = STRIP_ANGLES.map(a => C.radianceMap(p, a, 110, 110, TRUE_WIN.spanX, TRUE_WIN.spanY, TRUE_WIN.x0).max);
    const vmaxT = Math.max.apply(null, maxes);
    box.appendChild(el('div', { class: 'rowlab', text: 'True flash' }));
    const row0 = [];
    STRIP_ANGLES.forEach(a => {
      const cv = el('canvas', { width: 160, height: 160, style: 'image-rendering:auto' });
      const g = C.plumeGeom(p.flash, a * D);
      const gl = C.glowIntensity(p, a * D);
      const cell = el('div', { class: 'cell' }, [cv, el('div', { class: 'c', text: `${(g.ap / g.b).toFixed(2)}:1 · glow ${gl > 0 ? sig(gl, 2) : '0'}` })]);
      box.appendChild(cell);
      paintTrueSquare(cv, a, vmaxT);
      row0.push(cv);
    });
    stripCells.push({ label: 'True flash', canvases: row0, captions: STRIP_ANGLES.map(a => { const g = C.plumeGeom(p.flash, a * D); return `${(g.ap / g.b).toFixed(2)}:1`; }) });
    // sensor rows
    state.sensors.forEach((s, si) => {
      const caps = STRIP_ANGLES.map(a => C.simulateCapture(p, s, v.range, a, { noise: v.stripNoise, seed: 3 + si, phase: 0 }));
      const frames = caps.map(cp => { let kb = 0; cp.frames.forEach((f, k) => { if (f.meanSum > cp.frames[kb].meanSum) kb = k; }); return cp.frames[kb]; });
      let vmax = 0, anySat = false;
      frames.forEach((f, i) => { f.img.forEach(x => { if (x > vmax) vmax = x; }); if (f.nsat) anySat = true; vmax = Math.max(vmax, 3 * caps[i].sigma); });
      if (anySat) vmax = caps[0].satLevel;
      const tot0 = frames[0].meanSum;
      box.appendChild(el('div', { class: 'rowlab' }, [el('span', { class: 'swatch', style: `background:var(--s${si + 1})` }), s.short]));
      const row = [], capsTxt = [];
      frames.forEach((f, i) => {
        const cv = el('canvas');
        let txt;
        if (s.nx > 1) { paint(cv, f.img, caps[i].W, caps[i].W, vmax, f.sat); txt = `${(f.meanSum / tot0).toFixed(2)}×${f.nsat ? ' · ' + f.nsat + ' sat' : ''}`; }
        else { const tot = caps[i].frames.reduce((a, fr) => a + fr.meanSum, 0), t0 = caps[0].frames.reduce((a, fr) => a + fr.meanSum, 0); paint(cv, [tot], 1, 1, t0 * 1.3, null); txt = `${(tot / t0).toFixed(2)}× total`; }
        box.appendChild(el('div', { class: 'cell' }, [cv, el('div', { class: 'c', text: txt })]));
        row.push(cv); capsTxt.push(txt);
      });
      stripCells.push({ label: s.short, canvases: row, captions: capsTxt });
    });
    $('strip-sub').textContent = `Top row: the true flash (same brightness scale, glow drawn at the muzzle). Below: each sensor at ${v.range} m, exposure starting as the bullet leaves, brightest frame, same scale within a row. Numbers under the sensor images are the signal relative to 0°.`;
    const lg = $('strip-legend'); lg.innerHTML = '';
    lg.appendChild(el('span', {}, [el('span', { class: 'ramp', style: `background:${rampCss()}` }), ' dark to bright']));
    lg.appendChild(el('span', {}, [el('span', { class: 'swatch', style: `background:var(--sat)` }), ' saturated pixel']));
    lg.appendChild(el('span', { text: 'Top-row captions: outline length:width and glow toward the sensor (W/sr).' }));
  }
  function paintTrueSquare(cv, a, vmax) {
    // square crop of the true window centred on the flash's long axis
    const W = cv.width;
    const tmp = el('canvas', { width: W, height: W });
    paintTrue(tmp, a, vmax, 110, 110, false);
    cv.getContext('2d').drawImage(tmp, 0, 0);
  }

  // ------------------------------------------------------------------ ballistics view
  function renderBallistics() {
    const tab = ballistics();
    const p = state.p, ammo = p.study.ammo;
    const sel = tab[ammo].filter(r => r.R >= 50);
    const xAx = { type: 'lin', min: 40, max: 810, ticks: [100, 200, 300, 400, 500, 600, 700, 800], fmt: t => String(t), label: 'Distance to the shooter (m)' };
    const yMaxT = Math.ceil(Math.max(tab.M80[tab.M80.length - 1].soundArrival, tab.M80[tab.M80.length - 1].tof) * 2) / 2;
    const yt = []; for (let y = 0; y <= yMaxT + 1e-9; y += 0.5) yt.push(+y.toFixed(1));
    const std = state.sensors[1];
    const lat = p.study.latency + C.sensorDerived(std, p.atmosphere).Tf;
    chartTof.set({
      x: xAx, y: { type: 'lin', min: 0, max: yMaxT, ticks: yt, fmt: t => t.toFixed(1) + ' s', label: 'Seconds after the shot' },
      series: [
        { name: 'M80 ball', color: TH.ink, width: 2, pts: tab.M80.filter(r => r.R >= 50).map(r => ({ x: r.R, y: r.tof })) },
        { name: 'M118LR', color: TH.accent, width: 2, pts: tab.M118LR.filter(r => r.R >= 50).map(r => ({ x: r.R, y: r.tof })) },
        { name: 'sound of the shot', color: TH.muted, width: 1.5, dash: [5, 3], pts: tab.M80.filter(r => r.R >= 50).map(r => ({ x: r.R, y: r.soundArrival })) },
        { name: `warning (${C.AMMO[ammo].name}, standard camera)`, color: TH.s[1], width: 1.5, dash: [2, 2], pts: sel.map(r => ({ x: r.R, y: Math.max(0, r.tof - lat) })) }
      ],
      legend: [{ kind: 'line', color: TH.ink, width: 2, label: 'M80 ball arrives' }, { kind: 'line', color: TH.accent, width: 2, label: 'M118LR arrives' }, { kind: 'line', color: TH.muted, dash: [5, 3], width: 1.5, label: 'sound of the shot arrives' }, { kind: 'line', color: TH.s[1], dash: [2, 2], width: 1.5, label: `warning left (${C.AMMO[ammo].name}, standard camera)` }],
      hoverXs: sel.map(r => r.R),
      title: 'Time until the bullet arrives', subtitle: '7.62×51 mm, G7 drag, ICAO sea-level air, no wind', footnote: [C.AMMO.M80.name + ': ' + C.AMMO.M80.detail, C.AMMO.M118LR.name + ': ' + C.AMMO.M118LR.detail],
      tooltip: x => {
        const a = balAt('M80', x), b = balAt('M118LR', x);
        return `<div style="color:var(--muted)">${x} m</div><div class="row"><span>M80 ball</span><span>${a.tof.toFixed(3)} s · ${Math.round(a.v)} m/s</span></div><div class="row"><span>M118LR</span><span>${b.tof.toFixed(3)} s · ${Math.round(b.v)} m/s</span></div><div class="row"><span>sound</span><span>${a.soundArrival.toFixed(3)} s</span></div>`;
      }
    });
    const cut = C.glowCutoffDeg(p.glow);
    const yMaxS = Math.max(1, Math.ceil(Math.max(cut, tab.M80[tab.M80.length - 1].superDeg) * 5 + 0.5) / 5);
    const ys = []; for (let y = 0; y <= yMaxS + 1e-9; y += 0.2) ys.push(+y.toFixed(1));
    chartSe.set({
      x: xAx, y: { type: 'lin', min: 0, max: yMaxS, ticks: ys, fmt: t => t.toFixed(1) + '°', label: 'Barrel line above the target' },
      series: [
        { name: 'M80 ball', color: TH.ink, width: 2, pts: tab.M80.filter(r => r.R >= 50).map(r => ({ x: r.R, y: r.superDeg })) },
        { name: 'M118LR', color: TH.accent, width: 2, pts: tab.M118LR.filter(r => r.R >= 50).map(r => ({ x: r.R, y: r.superDeg })) }
      ],
      refs: [{ kind: 'h', y: cut, color: TH.muted, dash: [6, 3], label: `glow visible inside ${fmtAngle(cut)}` }],
      legend: [{ kind: 'line', color: TH.ink, width: 2, label: 'M80 ball' }, { kind: 'line', color: TH.accent, width: 2, label: 'M118LR' }, { kind: 'line', color: TH.muted, dash: [6, 3], width: 1.25, label: 'glow zone edge' }],
      hoverXs: sel.map(r => r.R),
      title: 'How far the barrel points above the target', subtitle: 'Launch angle needed to hit a target at the same height', footnote: [],
      tooltip: x => {
        const a = balAt('M80', x), b = balAt('M118LR', x);
        const fa = Math.round(100 * C.boreFraction(p.glow, a.superDeg * D)), fb = Math.round(100 * C.boreFraction(p.glow, b.superDeg * D));
        return `<div style="color:var(--muted)">${x} m</div><div class="row"><span>M80 ball</span><span>${a.superDeg.toFixed(3)}° · target sees ${fa}% of glow</span></div><div class="row"><span>M118LR</span><span>${b.superDeg.toFixed(3)}° · target sees ${fb}% of glow</span></div>`;
      }
    });
    // table
    const rows = [50, 100, 200, 300, 400, 500, 600, 700, 800];
    const t = $('bal-table'); t.innerHTML = '';
    t.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Distance' }), el('th', { class: 'num', text: 'M80 flight' }), el('th', { class: 'num', text: 'M118LR flight' }),
      el('th', { class: 'num', text: `Speed (${C.AMMO[ammo].name})` }),
      ...state.sensors.map(s => el('th', { class: 'num', text: `Warning: ${s.short}` })),
      el('th', { class: 'num', text: 'Barrel above target' }), el('th', { class: 'num', text: 'Glow the target sees' })
    ])]));
    const tb = el('tbody');
    rows.forEach(R => {
      const a = balAt('M80', R), b = balAt('M118LR', R), c = balAt(ammo, R);
      tb.appendChild(el('tr', {}, [
        el('td', { class: 'num', style: 'text-align:left', text: R + ' m' }),
        el('td', { class: 'num', text: a.tof.toFixed(3) + ' s' }), el('td', { class: 'num', text: b.tof.toFixed(3) + ' s' }),
        el('td', { class: 'num', text: `${Math.round(c.v)} m/s (M ${c.mach.toFixed(2)})` }),
        ...state.sensors.map(s => el('td', { class: 'num', text: fmtWarn(warningTime(s, ammo, R)) })),
        el('td', { class: 'num', text: `${c.superDeg.toFixed(3)}° (${c.superMrad.toFixed(1)} mrad)` }),
        el('td', { class: 'num', text: p.glow.on ? Math.round(100 * C.boreFraction(p.glow, c.superDeg * D)) + ' %' : '—' })
      ]));
    });
    t.appendChild(tb);
  }

  // ------------------------------------------------------------------ notes
  function renderNotes() {
    const n = $('notes');
    n.innerHTML = `
      <h2 id="notes-h">How the model works</h2>
      <h3>Flash cloud</h3>
      <ul>
        <li>A uniform glowing ellipsoid whose rear tip sits at the muzzle and whose long axis lies on the barrel line. Each line of sight adds up emission and self-absorption through the gas (radiance = source × (1 − e<sup>−κℓ</sup>)), so a see-through cloud looks equally bright from every side and an opaque one looks brighter side-on.</li>
        <li>The default opacity (optical depth 0.5 across the width) gives a front/side ratio of 0.85. Kastek et al. (Military University of Technology, Warsaw) measured 56.82 and 68.32 W/sr in 3–5 µm, a ratio of 0.83, with a 0.71 m flash. Their test conditions are not published in what I could find, so treat 60 W/sr as a guess.</li>
        <li>Time profile: smooth rise to peak, then exponential fall to 10 % at the set duration. The opacity is held for the whole event, which can only dim the glow more than reality would.</li>
      </ul>
      <h3>Barrel glow</h3>
      <ul>
        <li>Hard-edge model: the glow is the part of the bore's far end visible through the muzzle. It shrinks as two overlapping circles and vanishes at atan(bore / barrel) = 0.87°. The soft-tail option treats the bore as see-through gas, so off-axis lines of sight still count the gas they cross.</li>
        <li>The glow starts as the bullet leaves and fades exponentially. It shines through the cloud dead-on (a 0.7 m path), so at the default opacity only 37 % gets out.</li>
        <li>2 W/sr is a black body at about 1900 K filling the 7.62 mm hole. Gas is not a black body in 3–5 µm, so this is an upper estimate for that temperature.</li>
      </ul>
      <h3>Sensors</h3>
      <ul>
        <li>Lens size comes from pixel count, pixel size, field of view and f-number, so a wide view automatically gets a small lens. Blur is diffraction: a Gaussian core plus a halo that carries the Airy-ring energy.</li>
        <li>Cameras count photo-electrons with shot noise from the flash and from the 300 K background, read noise, and a full well where pixels clip. The cheap detector uses its datasheet detectivity (D*). Derived NETD: about 17 mK for the standard camera (datasheets: 19–20 mK).</li>
        <li>Cooled cameras saturate on this flash at most distances with normal exposures. That hides the glow in the muzzle pixel. Shorter exposures avoid it but miss more flashes.</li>
      </ul>
      <h3>How “told apart” is decided</h3>
      <ul>
        <li><b>Best case</b>: everything about the flash is known exactly and only sensor noise is random. The ideal test is right with probability Φ(d′/2), where d′ is the noise-weighted difference between the two images. Saturated pixels are left out. This is a bound, not a design target.</li>
        <li><b>Realistic case</b>: every shot draws its own flash and glow brightness, flash size and duration, exposure timing, position on the pixel grid and which way the flash points in the image. The sensor measures total signal, how concentrated the light is, the flash length and width, how far the brightest point sits from the centre, and for fast sensors the time profile. A quadratic classifier is trained on half the simulated shots and scored on the other half. Only detected shots count.</li>
        <li>The smallest angle is found by bisection over a fixed grid of angles. Results carry Monte Carlo noise of a few percent in the correct-call rate; use “600 shots” for final figures.</li>
      </ul>
      <h3>Ballistics</h3>
      <ul>
        <li>Point-mass trajectory with the standard G7 drag table (Lowry 1965), ICAO sea-level air, no wind. Muzzle velocities from the military specs (2750 ft/s and 2580 ft/s). The drag constant matches the open-source py-ballisticcalc library. The barrel elevation is the launch angle needed to hit a target at the shooter's height.</li>
      </ul>
      <h3>Not modelled</h3>
      <ul>
        <li>False alarms (sun glints, fires, other weapons), turbulence, wind, moving shooters, flash hiders, unknown range (raise the brightness variation to stand in for it), and the 4.3 µm CO₂ band's extra loss over distance.</li>
      </ul>
      <h3>Sources</h3>
      <ul>
        <li>Muzzle flash 3–5 µm intensities: Kastek et al., <a href="https://www.researchgate.net/publication/233864769_Measurement_of_sniper_infrared_signatures" target="_blank" rel="noopener">Measurement of sniper infrared signatures</a> and <a href="https://www.researchgate.net/publication/261203068_Concept_of_infrared_sensor_module_for_sniper_detection_system" target="_blank" rel="noopener">Concept of infrared sensor module for sniper detection system</a>.</li>
        <li>G7 drag table and drag constant: <a href="https://pypi.org/project/py-ballisticcalc/" target="_blank" rel="noopener">py-ballisticcalc</a> (Lowry, 1965).</li>
        <li>Sierra 175 gr MatchKing, G7 0.250: <a href="https://ravenrocksprecision.com/product/sierra-30-cal-308-175gr-hpbt-matchking-bullets/" target="_blank" rel="noopener">retailer listing</a>. M80 147 gr, G7 about 0.200 (calculator estimate): <a href="https://www.snipershide.com/shooting/threads/g1-and-g7-for-30-cal-175gr-bthp-and-brit-147gr.87283/" target="_blank" rel="noopener">forum figures</a>.</li>
        <li>Cooled 640 × 512 cameras: <a href="https://www.flir.com/products/sc7650/" target="_blank" rel="noopener">FLIR SC7650</a> (6.5 Me⁻ well, &lt;20 mK), <a href="https://www.lynred.com/sites/default/files/2019-10/Scorpio-MW-datasheet.pdf" target="_blank" rel="noopener">Lynred Scorpio MW</a> (&lt;420 e⁻ read noise, 19 mK).</li>
        <li>Uncooled PbSe: <a href="https://review.lasercomponents.com/us/product/pbse-detectors" target="_blank" rel="noopener">Laser Components PB45</a> (D* 6 × 10⁹ at peak), <a href="https://agiltron.com/PDFs/PbSe%20amplified%20infrared%20detector.pdf" target="_blank" rel="noopener">Agiltron PbSe detector</a> (D* 2 × 10⁹).</li>
      </ul>`;
  }

  // ------------------------------------------------------------------ exports
  function mainCsv() {
    const res = state.results; if (!res) return null;
    const rows = [['sensor', 'range_m', 'case', 'min_angle_deg', 'status', 'miss_distance_m', 'detection_probability', 'best_case_peak_snr', 'best_case_saturated']];
    state.sensors.forEach((s, si) => RANGES.forEach((R, ri) => {
      const b = res.best[si][ri], r = res.real[si][ri];
      if (b) rows.push([s.short, R, 'best', b.value != null ? b.value.toPrecision(4) : '', b.flag || 'ok', b.value != null ? (R * Math.tan(b.value * D)).toPrecision(4) : '', '', b.peakSNR.toPrecision(4), b.saturated ? 'yes' : 'no']);
      if (r) rows.push([s.short, R, 'realistic', r.value != null ? r.value.toPrecision(4) : '', r.flag || 'ok', r.value != null ? (R * Math.tan(r.value * D)).toPrecision(4) : '', r.pd != null ? r.pd.toFixed(3) : '', '', '']);
    }));
    return csvWithHeader(rows);
  }
  function sweepCsv() {
    const res = state.results; if (!res) return null;
    const rows = [['sensor', 'range_m', 'glow_peak_W_sr', 'case', 'min_angle_deg', 'status', 'detection_probability']];
    state.sensors.forEach((s, si) => SWEEP.forEach((gv, gi) => {
      const b = res.sweepBest[si][gi], r = res.sweepReal[si][gi];
      if (b) rows.push([s.short, res.sweepRange, gv, 'best', b.value != null ? b.value.toPrecision(4) : '', b.flag || 'ok', '']);
      if (r) rows.push([s.short, res.sweepRange, gv, 'realistic', r.value != null ? r.value.toPrecision(4) : '', r.flag || 'ok', r.pd != null ? r.pd.toFixed(3) : '']);
    }));
    return csvWithHeader(rows);
  }
  function balCsv() {
    const tab = ballistics(), ammo = state.p.study.ammo;
    const rows = [['range_m', 'M80_tof_s', 'M80_speed_m_s', 'M80_mach', 'M80_barrel_above_target_deg', 'M118LR_tof_s', 'M118LR_speed_m_s', 'M118LR_mach', 'M118LR_barrel_above_target_deg', 'sound_arrival_s', ...state.sensors.map(s => `warning_${s.id}_${ammo}_s`)]];
    BAL_RANGES.forEach((R, i) => {
      const a = tab.M80[i], b = tab.M118LR[i];
      rows.push([R, a.tof.toFixed(4), a.v.toFixed(1), a.mach.toFixed(3), a.superDeg.toFixed(4), b.tof.toFixed(4), b.v.toFixed(1), b.mach.toFixed(3), b.superDeg.toFixed(4), a.soundArrival.toFixed(4), ...state.sensors.map(s => warningTime(s, ammo, R).toFixed(4))]);
    });
    return csvWithHeader(rows);
  }
  function liveCsv() {
    if (!lastCapture) return null;
    const { cap, s, v } = lastCapture;
    const p = state.p;
    const pp = C.plumePulse(p.flash), gp = C.glowPulse(p.glow);
    const t1 = Math.max(pp.tEnd, p.glow.on ? gp.tEnd : 0) * 1.25;
    const ser = C.irradianceSeries(p, v.range, v.angle, -0.3e-3, t1, 400);
    const rows = [['kind', 'time_ms', 'end_ms', 'flash_W_m2', 'glow_W_m2', 'total_W_m2', 'exposure_average_W_m2', 'exposure_noiseless_W_m2', 'saturated_pixels']];
    ser.t.forEach((t, i) => rows.push(['true', (t * 1e3).toFixed(4), '', ser.ep[i].toExponential(5), ser.eg[i].toExponential(5), (ser.ep[i] + ser.eg[i]).toExponential(5), '', '', '']));
    cap.frames.forEach(f => rows.push(['exposure', (f.start * 1e3).toFixed(4), (f.end * 1e3).toFixed(4), '', '', '', f.irr.toExponential(5), f.meanIrr.toExponential(5), f.nsat]));
    return `# ${s.name}, ${v.range} m, ${v.angle} deg off the barrel line\n` + csvWithHeader(rows);
  }
  async function compositePng(parts, W, H, title, sub) {
    const cv = document.createElement('canvas'); const sc = 2;
    cv.width = W * sc; cv.height = H * sc;
    const g = cv.getContext('2d'); g.setTransform(sc, 0, 0, sc, 0, 0);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.fillStyle = LIGHT.ink; g.font = `600 17px ${FONT_BODY}`; g.fillText(title, 14, 26);
    if (sub) { g.fillStyle = LIGHT.muted; g.font = `12px ${FONT_BODY}`; g.fillText(sub, 14, 44); }
    for (const pt of parts) pt(g);
    return new Promise(res => cv.toBlob(res, 'image/png'));
  }
  async function exportStrip() {
    if (!stripCells) return;
    const cell = 120, gap = 8, labW = 150, top = 76;
    const W = labW + STRIP_ANGLES.length * (cell + gap) + 14;
    const H = top + stripCells.length * (cell + 26) + 50;
    const blob = await compositePng([g => {
      g.font = `12px ${FONT_DATA}`; g.fillStyle = LIGHT.muted; g.textAlign = 'center';
      STRIP_ANGLES.forEach((a, i) => g.fillText(a + '°', labW + i * (cell + gap) + cell / 2, top - 8));
      stripCells.forEach((row, r) => {
        const y = top + r * (cell + 26);
        g.textAlign = 'left'; g.fillStyle = LIGHT.ink; g.font = `13px ${FONT_BODY}`;
        g.fillText(row.label, 14, y + cell / 2 + 4);
        row.canvases.forEach((cv, i) => {
          const x = labW + i * (cell + gap);
          g.fillStyle = '#0b0c0a'; g.fillRect(x, y, cell, cell);
          g.imageSmoothingEnabled = r === 0;
          g.drawImage(cv, x, y, cell, cell);
          g.fillStyle = LIGHT.muted; g.font = `10.5px ${FONT_DATA}`; g.textAlign = 'center';
          g.fillText(row.captions[i] || '', x + cell / 2, y + cell + 14);
        });
      });
      g.textAlign = 'left'; g.font = `11px ${FONT_BODY}`; g.fillStyle = LIGHT.muted;
      g.fillText('Cyan: saturated pixel. Sensor captions: signal relative to 0°. True-flash captions: outline length:width.', 14, H - 30);
      g.fillText(settingsLines()[0], 14, H - 14);
    }], W, H, `The flash at 0°, 2°, 5°, 20° and 90°, ${state.view.range} m`, 'Top row: true flash. Below: what each sensor records (exposure starting as the bullet leaves, brightest frame).');
    saveFile(`flash-angles-${state.view.range}m.png`, blob);
  }
  async function exportLive() {
    if (!lastCapture) return;
    const W = 1000, H = 900;
    const blob = await compositePng([g => {
      g.imageSmoothingEnabled = true; g.drawImage($('true-canvas'), 14, 64, 560, 350);
      g.imageSmoothingEnabled = false; g.drawImage($('sens-canvas'), 594, 64, 350, 350);
      g.fillStyle = LIGHT.muted; g.font = `11px ${FONT_BODY}`;
      g.fillText('The flash itself (true shape)', 14, 430); g.fillText($('sens-title').textContent + ' · ' + $('sens-cap').textContent, 594, 430);
      g.save(); g.translate(0, 450);
      drawChart(g, W, 440, chartTime.spec, LIGHT, null, false);
      g.restore();
    }], W, H, $('live-sub').textContent, null);
    saveFile(`sensor-view-${state.sensors[state.view.sensor].id}-${state.view.range}m-${state.view.angle}deg.png`, blob);
  }
  async function exportBal() {
    const W = 1200, H = 560;
    const blob = await compositePng([g => {
      g.save(); g.translate(0, 54); drawChart(g, 600, 480, Object.assign({}, chartTof.spec, { title: null }), LIGHT, null, false); g.restore();
      g.save(); g.translate(600, 54); drawChart(g, 600, 480, Object.assign({}, chartSe.spec, { title: null }), LIGHT, null, false); g.restore();
      g.fillStyle = LIGHT.muted; g.font = `11px ${FONT_BODY}`;
      g.fillText(C.AMMO.M80.name + ': ' + C.AMMO.M80.detail + ' · ' + C.AMMO.M118LR.name + ': ' + C.AMMO.M118LR.detail, 14, H - 10);
    }], W, H, 'Bullet flight time and barrel elevation', '7.62×51 mm, G7 drag model, ICAO sea-level air, no wind');
    saveFile('ballistics.png', blob);
  }

  // ------------------------------------------------------------------ boot
  function wire() {
    $('run-btn').addEventListener('click', () => startStudy());
    $('mode-angle').addEventListener('click', () => { state.mode = 'angle'; $('mode-angle').setAttribute('aria-pressed', 'true'); $('mode-miss').setAttribute('aria-pressed', 'false'); renderMain(); });
    $('mode-miss').addEventListener('click', () => { state.mode = 'miss'; $('mode-miss').setAttribute('aria-pressed', 'true'); $('mode-angle').setAttribute('aria-pressed', 'false'); renderMain(); });
    $('fire-btn').addEventListener('click', () => { state.view.seed++; renderLive(); });
    $('live-noise').addEventListener('change', e => { state.view.noise = e.target.checked; renderLive(); });
    $('live-random').addEventListener('change', e => { state.view.random = e.target.checked; renderLive(); });
    $('strip-noise').addEventListener('change', e => { state.view.stripNoise = e.target.checked; renderStrip(); });
    $('exp-main-png').addEventListener('click', async () => { if (!state.results) return; saveFile(state.mode === 'miss' ? 'min-miss-distance-vs-range.png' : 'min-angle-vs-range.png', await chartMain.exportBlob(1000, 680)); });
    $('exp-main-csv').addEventListener('click', () => { const d = mainCsv(); if (d) saveFile('min-angle-vs-range.csv', d); else toast('Results are not ready yet.'); });
    $('exp-sweep-png').addEventListener('click', async () => { if (!state.results) return; saveFile(`min-angle-vs-glow-${state.results.sweepRange}m.png`, await chartSweep.exportBlob(1000, 680)); });
    $('exp-sweep-csv').addEventListener('click', () => { const d = sweepCsv(); if (d) saveFile(`min-angle-vs-glow-${state.results.sweepRange}m.csv`, d); else toast('Results are not ready yet.'); });
    $('exp-live-png').addEventListener('click', exportLive);
    $('exp-live-csv').addEventListener('click', () => { const d = liveCsv(); if (d) saveFile('sensor-signal.csv', d); });
    $('exp-strip-png').addEventListener('click', exportStrip);
    $('exp-bal-png').addEventListener('click', exportBal);
    $('exp-bal-csv').addEventListener('click', () => saveFile('ballistics.csv', balCsv()));
    const rethemed = () => { readTheme(); renderMain(); renderSweep(); renderLive(); renderBallistics(); };
    if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', rethemed);
    new MutationObserver(rethemed).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  function boot() {
    readTheme();
    chartMain = new Chart($('chart-main'), w => clamp(w * 0.58, 300, 470));
    chartSweep = new Chart($('chart-sweep'), w => clamp(w * 0.5, 280, 420));
    chartTime = new Chart($('chart-time'), w => clamp(w * 0.42, 240, 340));
    chartTof = new Chart($('chart-tof'), w => clamp(w * 0.62, 240, 340));
    chartSe = new Chart($('chart-se'), w => clamp(w * 0.62, 240, 340));
    buildRail();
    renderNotes();
    wire();
    renderChips(); renderProgress();
    renderBallistics(); renderAnswer(); renderMain(); renderSweep(); renderLive(); renderStrip();
    setTimeout(startStudy, 60);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
