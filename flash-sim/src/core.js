/*
 * Muzzle Flash Aspect: physics core.
 * Pure functions, no DOM. Runs in the browser (window.FlashCore) and in Node (module.exports).
 * SI units internally: metres, seconds, radians, watts. Angles in the public API are degrees where named *Deg.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ constants
  const PHYS = { h: 6.62607015e-34, c: 2.99792458e8, kB: 1.380649e-23 };
  const BAND = [3e-6, 5e-6];          // sensor band, m
  const LAMBDA_EFF = 4.3e-6;          // effective flash wavelength: photon energy and diffraction blur
  const E_PHOT = PHYS.h * PHYS.c / LAMBDA_EFF;
  const DEG = Math.PI / 180;
  const RHO_STD = 1.2250;             // ICAO sea-level air density, kg/m^3
  const SOUND_STD = 340.29;           // ICAO sea-level speed of sound, m/s
  const G = 9.80665;
  const LB_IN2_TO_KG_M2 = 703.0696;   // 1 lb/in^2 in kg/m^2 (ballistic coefficient units)

  // ------------------------------------------------------------------ maths helpers
  // erf, Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7)
  function erf(x) {
    const s = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * ax);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
    return s * y;
  }
  function normCdf(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }
  // Inverse normal CDF (Acklam), relative error < 1.2e-9
  function normInv(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const pl = 0.02425;
    let q, r;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - pl) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  // Seeded PRNG (mulberry32) with Gaussian draws (Box-Muller)
  function makeRng(seed) {
    let a = seed >>> 0;
    let spare = null;
    function u() {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function n() {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u1 = u();
      while (u1 <= 1e-300) u1 = u();
      const u2 = u();
      const r = Math.sqrt(-2 * Math.log(u1));
      spare = r * Math.sin(2 * Math.PI * u2);
      return r * Math.cos(2 * Math.PI * u2);
    }
    return { u, n };
  }
  function hashSeed() {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < arguments.length; i++) {
      let v = Math.floor(arguments[i] * 1000003) | 0;
      for (let k = 0; k < 4; k++) { h ^= (v & 0xff); h = Math.imul(h, 16777619) >>> 0; v >>>= 8; }
    }
    return h >>> 0;
  }
  function simpson(f, a, b, n) {
    if (n % 2) n++;
    const h = (b - a) / n;
    let s = f(a) + f(b);
    for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
    return s * h / 3;
  }
  function logSumExp(arr, n) {
    let m = -Infinity;
    for (let i = 0; i < n; i++) if (arr[i] > m) m = arr[i];
    if (m === -Infinity) return -Infinity;
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.exp(arr[i] - m);
    return m + Math.log(s);
  }

  // ------------------------------------------------------------------ black-body helpers
  const C2 = PHYS.h * PHYS.c / PHYS.kB;
  // Photon radiance in band, photons s^-1 m^-2 sr^-1
  function planckPhotonRadiance(T, l1, l2) {
    l1 = l1 || BAND[0]; l2 = l2 || BAND[1];
    if (!(T > 0)) return 0;
    return simpson(l => 2 * PHYS.c / Math.pow(l, 4) / Math.expm1(C2 / (l * T)), l1, l2, 400);
  }
  // Band radiance, W m^-2 sr^-1
  function planckBandRadiance(T, l1, l2) {
    l1 = l1 || BAND[0]; l2 = l2 || BAND[1];
    if (!(T > 0)) return 0;
    return simpson(l => 2 * PHYS.h * PHYS.c * PHYS.c / Math.pow(l, 5) / Math.expm1(C2 / (l * T)), l1, l2, 400);
  }
  // Black-body temperature that gives radiance L (W m^-2 sr^-1) in band (bisection)
  function bandRadianceToTemperature(L) {
    if (!(L > 0)) return 0;
    let lo = 200, hi = 6000;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      if (planckBandRadiance(mid) < L) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  // ------------------------------------------------------------------ defaults
  const DEFAULTS = {
    flash: {
      length: 0.7,        // m, along the barrel line
      width: 0.35,        // m
      peakSide: 60,       // W/sr, side-on peak radiant intensity, 3-5 um
      duration: 2.0e-3,   // s, onset to 10 % of peak
      rise: 0.3e-3,       // s, onset to peak
      opacity: 0.5,       // optical depth straight across the cloud's width
      onset: 0            // s, delay of cloud ignition after the bullet leaves
    },
    glow: {
      on: true,
      peak: 2.0,          // W/sr, on-axis peak before passing through the cloud
      decay: 1.0e-3,      // s, exponential fade time
      model: 'edge',      // 'edge' = seen only while the far end of the bore is visible; 'column' = see-through gas column
      bore: 7.62e-3,      // m
      barrel: 0.5         // m
    },
    suppressor: { on: false, flashFactor: 10, glowMode: 'unchanged' }, // glowMode: unchanged | dimmed | hidden
    atmosphere: { beta: 0.3, sceneT: 300 },  // beta: extinction per km (Beer-Lambert); scene temperature K
    study: { flashVar: 0.30, glowVar: 0.15, shapeVar: 0.15, timeVar: 0.15, detSNR: 5, pc: 0.90, latency: 0.05, ammo: 'M80', quality: 'normal', sweepRange: 300 }
  };

  // Sensor presets. All optics are derived from pixel count, pitch, field of view and f-number,
  // so a wide view automatically gets a small lens.
  const SENSORS = [
    {
      id: 'single', name: 'Single detector', short: 'Single detector',
      desc: 'One uncooled PbSe-type element, 2 × 2 mm, 3–5 µm filter. No image.',
      nx: 1, ny: 1, pitch: 2e-3, fov: 60, fnum: 1.0, tau: 0.8,
      frameRate: 10000, tint: 1.0e-4, qe: 0.5, well: Infinity, read: 0, dark: 0, dstar: 2e9
    },
    {
      id: 'std', name: 'Standard MWIR camera', short: 'Standard camera',
      desc: 'Cooled 640 × 512 camera, 15 µm pixels, 60 frames/s, 40° view.',
      nx: 640, ny: 512, pitch: 15e-6, fov: 40, fnum: 2.0, tau: 0.85,
      frameRate: 60, tint: 2.0e-3, qe: 0.8, well: 6.5e6, read: 400, dark: 0, dstar: 0
    },
    {
      id: 'wide', name: 'Standard MWIR camera, wide view', short: 'Wide-view camera',
      desc: 'Same camera with a 120° lens. Covers more sky with coarser pixels and a smaller lens.',
      nx: 640, ny: 512, pitch: 15e-6, fov: 120, fnum: 2.0, tau: 0.85,
      frameRate: 60, tint: 2.0e-3, qe: 0.8, well: 6.5e6, read: 400, dark: 0, dstar: 0
    },
    {
      id: 'fast', name: 'High-speed MWIR camera (best case)', short: 'High-speed camera',
      desc: 'Cooled lab camera, 320 × 256 window of a 25 µm array at 2000 frames/s. Not wearable.',
      nx: 320, ny: 256, pitch: 25e-6, fov: 40, fnum: 2.0, tau: 0.85,
      frameRate: 2000, tint: 0.45e-3, qe: 0.8, well: 1.1e7, read: 500, dark: 0, dstar: 0
    }
  ];

  function clone(o) { return JSON.parse(JSON.stringify(o, (k, v) => (v === Infinity ? 'Infinity' : v)), (k, v) => (v === 'Infinity' ? Infinity : v)); }
  function defaultParams() {
    return { flash: clone(DEFAULTS.flash), glow: clone(DEFAULTS.glow), suppressor: clone(DEFAULTS.suppressor), atmosphere: clone(DEFAULTS.atmosphere), study: clone(DEFAULTS.study) };
  }
  function defaultSensors() { return SENSORS.map(clone); }

  // ------------------------------------------------------------------ flash cloud (ellipsoid)
  // Homogeneous ellipsoid, semi-axes a (along barrel) and b, rear tip at the muzzle.
  // Absorption coefficient kappa = opacity / width. Emission coefficient j (W m^-3 sr^-1).
  // Radiance of a line of sight with chord l: L = (j/kappa) (1 - exp(-kappa l)).
  // Seen at angle theta from the barrel axis the projected outline is an ellipse with semi-axes ap, b,
  // and the chord through the projected point at normalised elliptical radius r is lc sqrt(1 - r^2).
  function plumeGeom(fl, th) {
    const a = fl.length / 2, b = fl.width / 2;
    const s = Math.sin(th), c = Math.cos(th);
    const ap = Math.sqrt(a * a * s * s + b * b * c * c);
    return { a, b, ap, lc: 2 * a * b / ap, uc: a * s, kappa: fl.opacity / fl.width };
  }
  // H(tau) = F(tau)/tau with F(tau) = 1/2 - (1 - e^-tau (1 + tau))/tau^2.  H(0) = 1/3.
  function Hfun(t) {
    if (t < 0.02) return 1 / 3 - t / 8 + t * t / 30 - t * t * t / 144 + t * t * t * t / 840;
    return 0.5 / t - (1 - Math.exp(-t) * (1 + t)) / (t * t * t);
  }
  // phi(x) = (1 - e^-x)/x
  function phiFun(x) { return x < 1e-6 ? 1 - x / 2 : -Math.expm1(-x) / x; }
  function flashScale(p) { return p.suppressor && p.suppressor.on ? 1 / Math.max(1, p.suppressor.flashFactor) : 1; }
  // Emission coefficient set so that the side-on peak equals peakSide.
  function plumeEmission(p) {
    const fl = p.flash, a = fl.length / 2, b = fl.width / 2;
    const kappa = fl.opacity / fl.width;
    return fl.peakSide * flashScale(p) / (4 * Math.PI * a * b * b * Hfun(kappa * fl.width));
  }
  // Peak radiant intensity of the cloud seen at angle th (W/sr): I = j 4 pi a b^2 H(kappa lc)
  function plumeIntensity(p, th) {
    const g = plumeGeom(p.flash, th);
    return plumeEmission(p) * 4 * Math.PI * g.a * g.b * g.b * Hfun(g.kappa * g.lc);
  }
  // Radiance at a projected point (u along the projected barrel, v across), metres from the muzzle
  function plumeRadiance(p, th, u, v, geom) {
    const g = geom || plumeGeom(p.flash, th);
    const du = (u - g.uc) / g.ap, dv = v / g.b;
    const r2 = du * du + dv * dv;
    if (r2 >= 1) return 0;
    const l = g.lc * Math.sqrt(1 - r2);
    return plumeEmission(p) * l * phiFun(g.kappa * l);
  }
  // Path length inside the cloud for light leaving the muzzle (rear tip) towards the sensor
  function glowCloudPath(fl, th) {
    const a = fl.length / 2, b = fl.width / 2;
    const c = Math.cos(th), s = Math.sin(th);
    if (c <= 0) return 0;
    return 2 * c / a / (c * c / (a * a) + s * s / (b * b));
  }

  // ------------------------------------------------------------------ barrel glow
  // Visible fraction of the bore's hot gas seen down the barrel at angle th.
  // 'edge':   fraction of the bore's far end visible through the muzzle (overlap of two circles).
  // 'column': see-through gas: each line of sight counts its path length inside the bore, up to the full barrel.
  // Both multiplied by cos(th) for the projected muzzle area.
  function boreFraction(gl, th) {
    if (th <= 0) return 1;
    const r = gl.bore / 2, s = gl.barrel * Math.tan(th), c = Math.cos(th);
    if (gl.model !== 'column') {
      if (s >= 2 * r) return 0;
      const x = s / (2 * r);
      return (2 / Math.PI) * (Math.acos(x) - x * Math.sqrt(1 - x * x)) * c;
    }
    // integrate over chords across the muzzle: y = r sin(f), chord length 2w, w = r cos(f)
    const N = 400;
    let acc = 0;
    for (let i = 0; i < N; i++) {
      const f = -Math.PI / 2 + (i + 0.5) * Math.PI / N;
      const w = r * Math.cos(f);
      const len = 2 * w;
      const inner = len <= s ? len * len / (2 * s) : len - s / 2;
      acc += inner * r * Math.cos(f) * (Math.PI / N);
    }
    return Math.min(1, acc / (Math.PI * r * r)) * c;
  }
  function glowCutoffDeg(gl) { return Math.atan(gl.bore / gl.barrel) / DEG; }
  function glowSuppressorScale(p) {
    if (!p.suppressor || !p.suppressor.on) return 1;
    if (p.suppressor.glowMode === 'hidden') return 0;
    if (p.suppressor.glowMode === 'dimmed') return 1 / Math.max(1, p.suppressor.flashFactor);
    return 1;
  }
  function glowCloudTransmission(p, th) {
    const g = plumeGeom(p.flash, th);
    return Math.exp(-g.kappa * glowCloudPath(p.flash, th));
  }
  // Peak glow intensity reaching the sensor direction (after the cloud), W/sr
  function glowIntensity(p, th) {
    if (!p.glow.on) return 0;
    return p.glow.peak * boreFraction(p.glow, th) * glowSuppressorScale(p) * glowCloudTransmission(p, th);
  }
  // Equivalent black-body temperature of the glow (radiance = peak / bore area)
  function glowEquivalentTemperature(gl) {
    const A = Math.PI * gl.bore * gl.bore / 4;
    return bandRadianceToTemperature(gl.peak / A);
  }

  // ------------------------------------------------------------------ time profiles
  // Cloud: sin^2 rise over 'rise', then exponential fall reaching 10 % of peak at 'duration' after onset.
  function plumePulse(fl, scale) {
    scale = scale || 1;
    const t0 = fl.onset || 0;
    const tr = Math.max(1e-6, fl.rise * scale);
    const D = Math.max(fl.duration * scale, tr * 1.05);
    const td = (D - tr) / Math.LN10;
    function g(t) {
      const s = t - t0;
      if (s <= 0) return 0;
      if (s < tr) { const q = Math.sin(Math.PI * s / (2 * tr)); return q * q; }
      return Math.exp(-(s - tr) / td);
    }
    function Gc(t) {
      const s = t - t0;
      if (s <= 0) return 0;
      if (s < tr) return s / 2 - tr / (2 * Math.PI) * Math.sin(Math.PI * s / tr);
      return tr / 2 + td * (1 - Math.exp(-(s - tr) / td));
    }
    return { g, G: Gc, tEnd: t0 + tr + td * Math.log(100), energy: tr / 2 + td, t0, tr, td };
  }
  // Glow: visible from the moment the bullet leaves (t = 0), exponential fade.
  function glowPulse(gl, scale) {
    const tau = Math.max(1e-6, gl.decay * (scale || 1));
    return {
      g: t => (t < 0 ? 0 : Math.exp(-t / tau)),
      G: t => (t <= 0 ? 0 : tau * (1 - Math.exp(-t / tau))),
      tEnd: tau * Math.log(100), energy: tau, tau
    };
  }
  function atmTransmission(p, R) { return Math.exp(-(p.atmosphere.beta || 0) * R / 1000); }

  // ------------------------------------------------------------------ sensor radiometry
  // PSF: diffraction from a circular aperture, fitted as 84 % core Gaussian (sigma 0.42 lambda/D, matches the
  // Airy core) plus 16 % halo Gaussian (sigma 2.0 lambda/D, carries the ring energy). Encircled energy within
  // 1.22 and 2.23 lambda/D: 0.85 and 0.91 (Airy: 0.84 and 0.91).
  const PSF_CORE_W = 0.84, PSF_CORE_K = 0.42, PSF_HALO_K = 2.0;
  function sensorDerived(s, atm) {
    const ifov = s.fov * DEG / s.nx;                  // rad per pixel (equal-angle lens mapping)
    const f = s.pitch / ifov;
    const D = f / s.fnum;
    const Aap = Math.PI * D * D / 4;
    const Apix = s.pitch * s.pitch;
    const sigPsf = PSF_CORE_K * LAMBDA_EFF / D;
    const sigHalo = PSF_HALO_K * LAMBDA_EFF / D;
    const Tf = 1 / s.frameRate;
    const tint = Math.min(s.tint, Tf);
    const T = (atm && atm.sceneT) || 300;
    const Lq = planckPhotonRadiance(T);
    const geomFactor = Math.PI / (4 * s.fnum * s.fnum + 1);
    const bgRate = s.qe * geomFactor * Lq * Apix;     // electrons/s/pixel from a black-body scene and optics at T
    const Nbg = bgRate * tint;
    const df = 1 / (2 * tint);
    const nep = s.dstar > 0 ? Math.sqrt(Apix * 1e4 * df) / s.dstar : 0;  // noise power in the sample bandwidth, W
    const sigDet = nep / E_PHOT * s.qe * tint;        // detector noise expressed in electrons
    const varBase = Nbg + (s.dark || 0) * tint + s.read * s.read + sigDet * sigDet;
    const dLq = (planckPhotonRadiance(T + 0.5) - planckPhotonRadiance(T - 0.5));
    const dN = s.qe * geomFactor * dLq * Apix * tint;
    const netd = Math.sqrt(varBase) / dN;
    return {
      ifov, f, D, Aap, Apix, sigPsf, sigHalo, sigPsfPx: sigPsf / ifov,
      haloPx: Math.sqrt(Math.max(0, sigHalo * sigHalo - sigPsf * sigPsf)) / ifov,
      Tf, tint, bgRate, Nbg, bgMean: Nbg + (s.dark || 0) * tint, varBase, sigma: Math.sqrt(varBase), nep, netd,
      wellFill: isFinite(s.well) ? Nbg / s.well : 0, tintClamped: s.tint > Tf
    };
  }
  // Electrons per (W/sr of source) per (second of the normalised time profile) at range R
  function electronsPerJoulePerSr(p, s, sd, R) {
    return sd.Aap * s.tau * s.qe / E_PHOT / (R * R) * atmTransmission(p, R);
  }

  // ------------------------------------------------------------------ image formation
  // Point samples of the cloud's projected radiance on a polar grid in normalised elliptical coordinates.
  // The grid deforms smoothly with viewing angle and size, so two renders differ only through the physics.
  // Weights sum to 1; the absolute level comes from the analytic intensity.
  const _sampleCache = new Map();
  function plumeSamples(fl, th, nr, nps, noCache) {
    const key = noCache ? null : [fl.length, fl.width, fl.opacity, th.toFixed(12), nr, nps].join('|');
    if (key) { const hit = _sampleCache.get(key); if (hit) return hit; }
    const g = plumeGeom(fl, th);
    const n = nr * nps;
    const u = new Float64Array(n), v = new Float64Array(n), w = new Float64Array(n);
    let tot = 0, k = 0;
    for (let i = 0; i < nr; i++) {
      const rho = (i + 0.5) / nr;
      const l = g.lc * Math.sqrt(1 - rho * rho);
      const wr = l * phiFun(g.kappa * l) * rho;          // radiance x ring area element
      for (let m = 0; m < nps; m++) {
        const psi = (m + 0.5) * 2 * Math.PI / nps;
        u[k] = g.uc + rho * Math.cos(psi) * g.ap;
        v[k] = rho * Math.sin(psi) * g.b;
        w[k] = wr; tot += wr; k++;
      }
    }
    for (let i = 0; i < n; i++) w[i] /= tot;
    const out = { u, v, w };
    if (key) { if (_sampleCache.size > 600) _sampleCache.clear(); _sampleCache.set(key, out); }
    return out;
  }
  // Quadrature density for a sensor and range (independent of angle)
  function quadrature(p, sd, R) {
    const Lpx = Math.max(p.flash.length, p.flash.width) / (R * sd.ifov);
    const nr = Math.max(6, Math.min(40, Math.ceil(1.8 * Lpx)));
    const nps = Math.max(32, 8 * Math.ceil(0.75 * nr));
    return { nr, nps };
  }
  // Separable pixel response: Gaussian PSF core integrated over square pixels. Adds weight*PRF into img.
  function splat(img, h, x, y, weight, sp) {
    const W = 2 * h + 1;
    const ext = 0.5 + 4 * sp;
    const i0 = Math.max(-h, Math.floor(x - ext)), i1 = Math.min(h, Math.ceil(x + ext));
    const j0 = Math.max(-h, Math.floor(y - ext)), j1 = Math.min(h, Math.ceil(y + ext));
    if (i0 > i1 || j0 > j1) return;
    const k = 1 / (Math.SQRT2 * Math.max(sp, 1e-4));
    const wx = [], wy = [];
    let prev = erf((i0 - 0.5 - x) * k);
    for (let i = i0; i <= i1; i++) { const e = erf((i + 0.5 - x) * k); wx.push(0.5 * (e - prev)); prev = e; }
    prev = erf((j0 - 0.5 - y) * k);
    for (let j = j0; j <= j1; j++) { const e = erf((j + 0.5 - y) * k); wy.push(0.5 * (e - prev)); prev = e; }
    for (let j = j0; j <= j1; j++) {
      const wyj = wy[j - j0] * weight;
      if (wyj === 0) continue;
      const row = (j + h) * W + h;
      for (let i = i0; i <= i1; i++) img[row + i] += wx[i - i0] * wyj;
    }
  }
  // Add the PSF halo: img = core_w * img + (1 - core_w) * (img (x) Gaussian), separable, energy leaving the ROI is lost.
  function applyHalo(img, W, sig) {
    if (W === 1 || sig <= 0) return img;
    const r = Math.max(1, Math.ceil(3 * sig));
    const ker = new Float64Array(2 * r + 1);
    let ks = 0;
    for (let i = -r; i <= r; i++) {
      const v = erf((i + 0.5) / (Math.SQRT2 * sig)) - erf((i - 0.5) / (Math.SQRT2 * sig));
      ker[i + r] = v; ks += v;
    }
    for (let i = 0; i < ker.length; i++) ker[i] /= ks;
    const tmp = new Float64Array(W * W), out = new Float64Array(W * W);
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      let a = 0;
      for (let q = -r; q <= r; q++) { const ii = i + q; if (ii >= 0 && ii < W) a += img[j * W + ii] * ker[q + r]; }
      tmp[j * W + i] = a;
    }
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      let a = 0;
      for (let q = -r; q <= r; q++) { const jj = j + q; if (jj >= 0 && jj < W) a += tmp[jj * W + i] * ker[q + r]; }
      out[j * W + i] = PSF_CORE_W * img[j * W + i] + (1 - PSF_CORE_W) * a;
    }
    return out;
  }
  function roiHalf(p, s, sd, R) {
    if (s.nx === 1) return 0;
    const L = 1.5 * Math.max(p.flash.length, p.flash.width);   // room for shot-to-shot size variation
    return Math.min(48, Math.ceil(L / (R * sd.ifov) + 0.5 + 4 * sd.sigPsfPx + 2 * sd.haloPx + 0.5));
  }
  // Fractions of cloud and glow energy landing in each ROI pixel.
  // Muzzle at sub-pixel offset (dx, dy) from the centre pixel; cloud axis points along angle phi in the image.
  function renderSpatial(q, s, sd, R, th, phi, dx, dy, h, noCache) {
    const W = 2 * h + 1, npix = W * W;
    let plume = new Float64Array(npix), glow = new Float64Array(npix);
    if (s.nx === 1) { plume[0] = 1; glow[0] = 1; return { plume, glow }; }
    const qd = quadrature(q, sd, R);
    const smp = plumeSamples(q.flash, th, qd.nr, qd.nps, noCache);
    const cs = Math.cos(phi), sn = Math.sin(phi);
    const kpx = 1 / (R * sd.ifov);
    const sp = sd.sigPsfPx;
    for (let n = 0; n < smp.w.length; n++) {
      const u = smp.u[n], v = smp.v[n];
      splat(plume, h, (u * cs - v * sn) * kpx + dx, (u * sn + v * cs) * kpx + dy, smp.w[n], sp);
    }
    splat(glow, h, dx, dy, 1, sp);
    plume = applyHalo(plume, W, sd.haloPx);
    glow = applyHalo(glow, W, sd.haloPx);
    return { plume, glow };
  }
  function frameStarts(sd, phase, K) {
    const st = new Float64Array(K);
    for (let k = 0; k < K; k++) st[k] = -phase + k * sd.Tf;
    return st;
  }

  // ------------------------------------------------------------------ evaluation context
  // Everything fixed for one (sensor, range) pair.
  function makeContext(p, s, R) {
    const sd = sensorDerived(s, p.atmosphere);
    const h = roiHalf(p, s, sd, R);
    const W = 2 * h + 1;
    const npix = W * W;
    const pp = plumePulse(p.flash, 1.5), gp = glowPulse(p.glow, 1.5);   // room for timing variation
    const tEnd = Math.max(pp.tEnd, p.glow.on ? gp.tEnd : 0);
    const K = Math.max(1, Math.ceil((tEnd + sd.Tf) / sd.Tf));
    const eK = electronsPerJoulePerSr(p, s, sd, R);
    const nomPP = plumePulse(p.flash, 1), nomGP = glowPulse(p.glow, 1);
    const multiFrame = Math.max(nomPP.tEnd, p.glow.on ? nomGP.tEnd : 0) / sd.Tf >= 3;
    return { p, s, sd, R, h, W, npix, K, n: npix * K, eK, multiFrame, well: s.well, sat: s.well - sd.bgMean };
  }
  // Mean signal (electrons above background), dense over (frame, pixel), for one realisation.
  function buildMean(ctx, q, th, spatial, phase, ap, ag, out) {
    const { sd, K, npix, eK } = ctx;
    const pp = plumePulse(q.flash, 1), gp = glowPulse(q.glow, 1);
    const st = frameStarts(sd, phase, K);
    const Ip = plumeIntensity(q, th) * (ap == null ? 1 : ap);
    const Ig = glowIntensity(q, th) * (ag == null ? 1 : ag);
    const mean = out || new Float64Array(ctx.n);
    for (let k = 0; k < K; k++) {
      const wp = (pp.G(st[k] + sd.tint) - pp.G(st[k])) * Ip * eK;
      const wg = Ig > 0 ? (gp.G(st[k] + sd.tint) - gp.G(st[k])) * Ig * eK : 0;
      const off = k * npix;
      if (wp <= 0 && wg <= 0) { for (let i = 0; i < npix; i++) mean[off + i] = 0; continue; }
      for (let i = 0; i < npix; i++) mean[off + i] = wp * spatial.plume[i] + wg * spatial.glow[i];
    }
    return mean;
  }
  // Detection statistic: per-pixel matched filter over frames on the expected pulse shape.
  // stat = max over pixels of sum_k x_k mu_k / (sigma sqrt(sum_k mu_k^2)).
  function matchedStat(ctx, x, mu) {
    const { npix, K } = ctx;
    let best = 0;
    for (let i = 0; i < npix; i++) {
      let num = 0, den = 0;
      for (let k = 0; k < K; k++) { const m = mu[k * npix + i]; if (m > 0) { num += x[k * npix + i] * m; den += m * m; } }
      if (den > 0) { const st = num / Math.sqrt(den); if (st > best) best = st; }
    }
    return best / ctx.sd.sigma;
  }

  // ------------------------------------------------------------------ best case (only sensor noise)
  // Everything about the flash is known: timing (exposure starts as the bullet leaves), muzzle centred on a pixel,
  // nominal brightness, size and orientation. Ideal observer for two known signals in Gaussian noise:
  // P(correct) = Phi(d'/2), d'^2 = sum (mu1 - mu0)^2 / var, saturated pixels excluded.
  function bestCaseMean(ctx, th) {
    const sp = renderSpatial(ctx.p, ctx.s, ctx.sd, ctx.R, th, 0, 0, 0, ctx.h);
    return buildMean(ctx, ctx.p, th, sp, 0, 1, 1);
  }
  function bestCaseDprime(ctx, th, mu0) {
    const mu1 = bestCaseMean(ctx, th);
    const v0 = ctx.sd.varBase, sat = ctx.sat;
    let d2 = 0;
    for (let i = 0; i < ctx.n; i++) {
      const a = mu0[i], b = mu1[i];
      if (a === 0 && b === 0) continue;
      if (a >= sat || b >= sat) continue;
      const df = b - a;
      d2 += df * df / (v0 + 0.5 * (a + b));
    }
    return Math.sqrt(d2);
  }
  function bestCaseReference(ctx) {
    const mu0 = bestCaseMean(ctx, 0);
    let peak = 0;
    for (let i = 0; i < ctx.n; i++) if (mu0[i] > peak) peak = mu0[i];
    const clipped = mu0.map(v => Math.min(v, ctx.sat));
    return { mu0, peakSNR: matchedStat(ctx, clipped, mu0), pixelSNR: Math.min(peak, ctx.sat) / ctx.sd.sigma, saturated: peak >= ctx.sat };
  }

  // ------------------------------------------------------------------ realistic case
  // Every unknown varies continuously from shot to shot: flash and glow brightness, flash size and duration,
  // muzzle position on the pixel grid, which way the flash points in the image, and exposure timing.
  // The sensor measures features of the image and time series; a quadratic classifier trained on simulated
  // shots decides 'dead-on' or 'off-axis'. P(correct) is measured on shots it was not trained on.
  function qualityN(q) { return q === 'fast' ? 150 : q === 'fine' ? 600 : 300; }
  function variantParams(p, rng) {
    const st = p.study;
    const f = () => Math.max(0.4, 1 + (st.shapeVar || 0) * rng.n());
    const ft = () => Math.max(0.4, 1 + (st.timeVar || 0) * rng.n());
    const fl = Object.assign({}, p.flash), gl = Object.assign({}, p.glow);
    fl.length = p.flash.length * f(); fl.width = p.flash.width * f();
    const dsc = ft(); fl.duration = p.flash.duration * dsc; fl.rise = p.flash.rise * dsc;
    gl.decay = p.glow.decay * ft();
    return { flash: fl, glow: gl, suppressor: p.suppressor, atmosphere: p.atmosphere, study: st };
  }
  function featureKind(ctx) {
    if (ctx.s.nx === 1) return 'temporal';
    return ctx.multiFrame ? 'imaging+temporal' : 'imaging';
  }
  const FEATURE_NAMES = {
    temporal: ['log total signal', 'peak sample share', 'share before peak', 'pulse width'],
    imaging: ['log total signal', 'brightest-pixel share', 'log length', 'log width', 'brightest-pixel offset'],
    'imaging+temporal': ['log total signal', 'brightest-pixel share', 'log length', 'log width', 'brightest-pixel offset',
      'peak frame share', 'share before peak', 'pulse width', 'brightest-pixel share before peak']
  };
  function computeFeatures(ctx, x, kind) {
    const { npix, K, W, h } = ctx;
    const sig = ctx.sd.sigma;
    const f = [];
    // frame totals
    const sk = new Float64Array(K);
    let E = 0;
    for (let k = 0; k < K; k++) { let a = 0; for (let i = 0; i < npix; i++) a += x[k * npix + i]; sk[k] = a; E += a; }
    f.push(Math.log(Math.max(E, sig)));
    if (kind !== 'temporal') {
      const S = new Float64Array(npix);
      for (let k = 0; k < K; k++) for (let i = 0; i < npix; i++) S[i] += x[k * npix + i];
      let pk = -Infinity, ipk = 0;
      for (let i = 0; i < npix; i++) if (S[i] > pk) { pk = S[i]; ipk = i; }
      f.push(Math.max(pk, 0) / Math.max(E, pk, sig));
      const thr = 3 * sig * Math.sqrt(K);
      let sw = 0, sx = 0, sy = 0;
      for (let i = 0; i < npix; i++) if (S[i] > thr) { const xi = (i % W) - h, yi = Math.floor(i / W) - h; sw += S[i]; sx += S[i] * xi; sy += S[i] * yi; }
      let l1 = 0, l2 = 0, off = 0;
      if (sw > 0) {
        const cx = sx / sw, cy = sy / sw;
        let cxx = 0, cyy = 0, cxy = 0;
        for (let i = 0; i < npix; i++) if (S[i] > thr) { const dx = (i % W) - h - cx, dy = Math.floor(i / W) - h - cy; cxx += S[i] * dx * dx; cyy += S[i] * dy * dy; cxy += S[i] * dx * dy; }
        cxx /= sw; cyy /= sw; cxy /= sw;
        const tr = cxx + cyy, dt = Math.sqrt(Math.max(0, (cxx - cyy) * (cxx - cyy) / 4 + cxy * cxy));
        l1 = tr / 2 + dt; l2 = Math.max(0, tr / 2 - dt);
        off = Math.hypot((ipk % W) - h - cx, Math.floor(ipk / W) - h - cy);
      }
      f.push(Math.log(Math.sqrt(l1) + 0.1), Math.log(Math.sqrt(l2) + 0.1), off);
      if (kind === 'imaging') return f;
      // temporal part for multi-frame imagers, plus the brightest pixel's own time profile
      pushTemporal(f, sk, K);
      let km = 0; for (let k = 1; k < K; k++) if (sk[k] > sk[km]) km = k;
      let a = 0, b = 0;
      for (let k = 0; k < K; k++) { const v = Math.max(0, x[k * npix + ipk]); b += v; if (k < km) a += v; }
      f.push(b > 0 ? a / b : 0);
      return f;
    }
    pushTemporal(f, sk, K);
    return f;
  }
  function pushTemporal(f, sk, K) {
    let tot = 0, km = 0;
    for (let k = 0; k < K; k++) { tot += Math.max(0, sk[k]); if (sk[k] > sk[km]) km = k; }
    if (tot <= 0) { f.push(0, 0, 0); return; }
    let before = 0, m1 = 0;
    for (let k = 0; k < K; k++) { const v = Math.max(0, sk[k]); if (k < km) before += v; m1 += v * k; }
    m1 /= tot;
    let m2 = 0;
    for (let k = 0; k < K; k++) { const v = Math.max(0, sk[k]); m2 += v * (k - m1) * (k - m1); }
    f.push(Math.max(0, sk[km]) / tot, before / tot, Math.sqrt(m2 / tot));
  }
  function makeBuf(ctx) { return { x: new Float64Array(ctx.n), mean: new Float64Array(ctx.n) }; }
  // One simulated shot with random unknowns. Returns {detected, f}.
  function drawRealistic(ctx, thDeg, rng, buf, kind) {
    const { p, s, sd, R, h, n } = ctx;
    const st = p.study;
    const q = variantParams(p, rng);
    const ap = Math.max(0.05, 1 + st.flashVar * rng.n());
    const ag = Math.max(0.05, 1 + st.glowVar * rng.n());
    const phi = 2 * Math.PI * rng.u(), dx = rng.u() - 0.5, dy = rng.u() - 0.5, phase = rng.u() * sd.Tf;
    const spatial = renderSpatial(q, s, sd, R, thDeg * DEG, phi, dx, dy, h, true);
    const mean = buildMean(ctx, q, thDeg * DEG, spatial, phase, ap, ag, buf.mean);
    const x = buf.x, v0 = sd.varBase, sat = ctx.sat;
    for (let i = 0; i < n; i++) {
      const mu = mean[i];
      let v = mu + Math.sqrt(v0 + (mu > 0 ? mu : 0)) * rng.n();
      if (v > sat) v = sat;
      x[i] = v;
    }
    const detected = matchedStat(ctx, x, mean) >= st.detSNR;
    return { detected, f: detected ? computeFeatures(ctx, x, kind) : null };
  }
  // Gaussian fit with a small ridge, via Cholesky
  function fitGauss(rows) {
    const d = rows[0].length, n = rows.length;
    const mu = new Float64Array(d);
    for (const r of rows) for (let j = 0; j < d; j++) mu[j] += r[j] / n;
    const C = [];
    for (let a = 0; a < d; a++) { C.push(new Float64Array(d)); }
    for (const r of rows) for (let a = 0; a < d; a++) { const da = r[a] - mu[a]; for (let b = 0; b <= a; b++) C[a][b] += da * (r[b] - mu[b]) / (n - 1); }
    for (let a = 0; a < d; a++) for (let b = 0; b < a; b++) C[b][a] = C[a][b];
    for (let a = 0; a < d; a++) C[a][a] += 1e-4 * C[a][a] + 1e-10;
    // Cholesky
    const L = C.map(r => new Float64Array(d));
    for (let i = 0; i < d; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = C[i][j];
        for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
        if (i === j) L[i][i] = Math.sqrt(Math.max(sum, 1e-300)); else L[i][j] = sum / L[j][j];
      }
    }
    let logdet = 0;
    for (let i = 0; i < d; i++) logdet += 2 * Math.log(L[i][i]);
    return { mu, L, logdet, d };
  }
  function gaussLogPdf(g, r) {
    const d = g.d, z = new Float64Array(d);
    for (let i = 0; i < d; i++) {
      let s = r[i] - g.mu[i];
      for (let k = 0; k < i; k++) s -= g.L[i][k] * z[k];
      z[i] = s / g.L[i][i];
    }
    let q = 0;
    for (let i = 0; i < d; i++) q += z[i] * z[i];
    return -0.5 * (q + g.logdet);
  }
  // Rank-based normal scores: each feature is mapped through the empirical distribution of the training data,
  // so heavy tails (shots where only the flash's faint tail was caught) cannot dominate the Gaussian fits.
  function makeNormalizer(rows) {
    const d = rows[0].length, n = rows.length;
    const cols = [];
    for (let j = 0; j < d; j++) cols.push(Float64Array.from(rows.map(r => r[j])).sort());
    return function (r) {
      const out = new Float64Array(d);
      for (let j = 0; j < d; j++) {
        const c = cols[j], v = r[j];
        let lo = 0, hi = n;
        while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < v) lo = m + 1; else hi = m; }
        let hi2 = lo;
        while (hi2 < n && c[hi2] === v) hi2++;
        const rank = 0.5 * (lo + hi2);                      // mid-rank for ties
        out[j] = normInv((rank + 0.5) / (n + 1));
      }
      return out;
    };
  }
  // Two-fold cross-validated balanced accuracy of a quadratic classifier on normal scores
  function qdaPc(F0, F1) {
    let acc = 0;
    for (let fold = 0; fold < 2; fold++) {
      const tr0 = F0.filter((_, i) => i % 2 !== fold), te0 = F0.filter((_, i) => i % 2 === fold);
      const tr1 = F1.filter((_, i) => i % 2 !== fold), te1 = F1.filter((_, i) => i % 2 === fold);
      const norm = makeNormalizer(tr0.concat(tr1));
      const g0 = fitGauss(tr0.map(norm)), g1 = fitGauss(tr1.map(norm));
      let c0 = 0, c1 = 0;
      for (const r of te0) { const z = norm(r); if (gaussLogPdf(g0, z) >= gaussLogPdf(g1, z)) c0++; }
      for (const r of te1) { const z = norm(r); if (gaussLogPdf(g1, z) > gaussLogPdf(g0, z)) c1++; }
      acc += 0.5 * (c0 / te0.length + c1 / te1.length);
    }
    return acc / 2;
  }
  // Collect N detected shots at angle thDeg (up to 4N attempts). Generator; returns {F, attempts}.
  function* collectShots(ctx, thDeg, cls, N, sIdx, rIdx, buf, kind) {
    const F = [];
    let attempts = 0;
    for (let i = 0; F.length < N && i < 4 * N; i++) {
      const rng = makeRng(hashSeed(sIdx, rIdx, cls, i));
      const r = drawRealistic(ctx, thDeg, rng, buf, kind);
      attempts++;
      if (r.detected) F.push(r.f);
      if ((i & 3) === 3) yield 1;
    }
    return { F, attempts };
  }

  // ------------------------------------------------------------------ threshold searches
  const ANG_GRID = [0.02, 0.03, 0.05, 0.07, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.5, 2, 3, 4, 5, 7, 10, 15, 20, 30, 45, 60, 75, 90];
  function interpLogTheta(thLo, pLo, thHi, pHi, req) {
    const f = (pHi === pLo) ? 0.5 : Math.min(1, Math.max(0, (req - pLo) / (pHi - pLo)));
    return Math.exp(Math.log(thLo) + f * (Math.log(thHi) - Math.log(thLo)));
  }
  // Best case: smallest angle above which the ideal observer is right at least pc of the time.
  function bestCaseThreshold(p, s, R) {
    const ctx = makeContext(p, s, R);
    const ref = bestCaseReference(ctx);
    const req = p.study.pc;
    const dreq = 2 * normInv(req);
    const res = { detected: ref.peakSNR >= p.study.detSNR, peakSNR: ref.peakSNR, saturated: ref.saturated, value: null, flag: null };
    if (!res.detected) { res.flag = 'undetected'; return res; }
    const grid = [];
    for (let i = 0; i <= 44; i++) grid.push(0.01 * Math.pow(9000, i / 44)); // 0.01 .. 90 deg
    const dp = grid.map(g => bestCaseDprime(ctx, g * DEG, ref.mu0));
    let k = grid.length;
    while (k > 0 && dp[k - 1] >= dreq) k--;
    if (k === grid.length) { res.flag = 'gt90'; return res; }
    if (k === 0) { res.value = grid[0]; res.flag = 'lt'; return res; }
    let lo = grid[k - 1], hi = grid[k];
    for (let it = 0; it < 12; it++) {
      const mid = Math.sqrt(lo * hi);
      if (bestCaseDprime(ctx, mid * DEG, ref.mu0) >= dreq) hi = mid; else lo = mid;
    }
    res.value = Math.sqrt(lo * hi);
    return res;
  }
  // Realistic: P(correct) rises with angle; bisection over ANG_GRID. Generator returning a result object.
  function* realisticThreshold(p, s, R, sIdx, rIdx) {
    const ctx = makeContext(p, s, R);
    const kind = featureKind(ctx);
    const N = qualityN(p.study.quality);
    const buf = makeBuf(ctx);
    const res = { value: null, flag: null, pd: null, evals: [], kind };
    const h0 = yield* collectShots(ctx, 0, 0, N, sIdx, rIdx, buf, kind);
    res.pd = h0.F.length / h0.attempts;
    if (h0.F.length < 40) { res.flag = 'undetected'; return res; }
    const req = p.study.pc;
    const cache = new Map();
    function* pcAt(i) {
      if (cache.has(i)) return cache.get(i);
      const h1 = yield* collectShots(ctx, ANG_GRID[i], 1, N, sIdx, rIdx, buf, kind);
      const n = Math.min(h0.F.length, h1.F.length);
      const pc = n < 40 ? null : qdaPc(h0.F.slice(0, n), h1.F.slice(0, n));
      cache.set(i, pc);
      res.evals.push([ANG_GRID[i], pc, n]);
      return pc;
    }
    const last = ANG_GRID.length - 1;
    const pTop = yield* pcAt(last);
    if (pTop === null) { res.flag = 'undetected'; return res; }
    if (pTop < req) { res.flag = 'gt90'; return res; }
    let lo = -1, hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      const pm = yield* pcAt(mid);
      if (pm !== null && pm >= req) hi = mid; else lo = mid;
    }
    if (lo < 0) { res.value = ANG_GRID[0]; res.flag = 'lt'; return res; }
    const pl = cache.get(lo);
    res.value = interpLogTheta(ANG_GRID[lo], pl == null ? 0.5 : pl, ANG_GRID[hi], cache.get(hi), req);
    return res;
  }

  // ------------------------------------------------------------------ ballistics (G7, ICAO standard atmosphere, no wind)
  const G7_TABLE = [
    [0.00, 0.1198], [0.05, 0.1197], [0.10, 0.1196], [0.15, 0.1194], [0.20, 0.1193], [0.25, 0.1194], [0.30, 0.1194], [0.35, 0.1194],
    [0.40, 0.1193], [0.45, 0.1193], [0.50, 0.1194], [0.55, 0.1193], [0.60, 0.1194], [0.65, 0.1197], [0.70, 0.1202], [0.725, 0.1207],
    [0.75, 0.1215], [0.775, 0.1226], [0.80, 0.1242], [0.825, 0.1266], [0.85, 0.1306], [0.875, 0.1368], [0.90, 0.1464], [0.925, 0.1660],
    [0.95, 0.2054], [0.975, 0.2993], [1.0, 0.3803], [1.025, 0.4015], [1.05, 0.4043], [1.075, 0.4034], [1.10, 0.4014], [1.125, 0.3987],
    [1.15, 0.3955], [1.20, 0.3884], [1.25, 0.3810], [1.30, 0.3732], [1.35, 0.3657], [1.40, 0.3580], [1.50, 0.3440], [1.55, 0.3376],
    [1.60, 0.3315], [1.65, 0.3260], [1.70, 0.3209], [1.75, 0.3160], [1.80, 0.3117], [1.85, 0.3078], [1.90, 0.3042], [1.95, 0.3010],
    [2.00, 0.2980], [2.05, 0.2951], [2.10, 0.2922], [2.15, 0.2892], [2.20, 0.2864], [2.25, 0.2835], [2.30, 0.2807], [2.35, 0.2779],
    [2.40, 0.2752], [2.45, 0.2725], [2.50, 0.2697], [2.55, 0.2670], [2.60, 0.2643], [2.65, 0.2615], [2.70, 0.2588], [2.75, 0.2561],
    [2.80, 0.2533], [2.85, 0.2506], [2.90, 0.2479], [2.95, 0.2451], [3.00, 0.2424], [3.10, 0.2368], [3.20, 0.2313], [3.30, 0.2258],
    [3.40, 0.2205], [3.50, 0.2154], [3.60, 0.2106], [3.70, 0.2060], [3.80, 0.2017], [3.90, 0.1975], [4.00, 0.1935], [4.20, 0.1861],
    [4.40, 0.1793], [4.60, 0.1730], [4.80, 0.1672], [5.00, 0.1618]
  ];
  function cdG7(M) {
    const t = G7_TABLE;
    if (M <= t[0][0]) return t[0][1];
    if (M >= t[t.length - 1][0]) return t[t.length - 1][1];
    let lo = 0, hi = t.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid][0] <= M) lo = mid; else hi = mid; }
    const f = (M - t[lo][0]) / (t[hi][0] - t[lo][0]);
    return t[lo][1] + f * (t[hi][1] - t[lo][1]);
  }
  const AMMO = {
    M80: { id: 'M80', name: 'M80 ball', detail: '147 gr (9.5 g) FMJ, 838 m/s, G7 BC 0.200 (estimate)', mv: 838, bc7: 0.200 },
    M118LR: { id: 'M118LR', name: 'M118LR', detail: '175 gr (11.3 g) Sierra MatchKing, 786 m/s, G7 BC 0.250', mv: 786, bc7: 0.250 }
  };
  // Integrate a flat-fire trajectory launched at angle alpha (rad) above the line to the target.
  function trajectory(ammo, alpha, xMax) {
    const k0 = RHO_STD * Math.PI / (8 * ammo.bc7 * LB_IN2_TO_KG_M2);
    let x = 0, y = 0, vx = ammo.mv * Math.cos(alpha), vy = ammo.mv * Math.sin(alpha), t = 0;
    const dt = 2e-4;
    const out = [[0, 0, 0, ammo.mv]];
    function acc(vx_, vy_) {
      const v = Math.hypot(vx_, vy_);
      const k = k0 * cdG7(v / SOUND_STD) * v;
      return [-k * vx_, -k * vy_ - G];
    }
    while (x < xMax && t < 6) {
      const a1 = acc(vx, vy);
      const a2 = acc(vx + 0.5 * dt * a1[0], vy + 0.5 * dt * a1[1]);
      const a3 = acc(vx + 0.5 * dt * a2[0], vy + 0.5 * dt * a2[1]);
      const a4 = acc(vx + dt * a3[0], vy + dt * a3[1]);
      const nx = x + dt * (vx + dt / 6 * (a1[0] + a2[0] + a3[0]));
      const ny = y + dt * (vy + dt / 6 * (a1[1] + a2[1] + a3[1]));
      vx += dt / 6 * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0]);
      vy += dt / 6 * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1]);
      x = nx; y = ny; t += dt;
      out.push([t, x, y, Math.hypot(vx, vy)]);
    }
    return out;
  }
  function interpAtX(tr, X) {
    for (let i = 1; i < tr.length; i++) {
      if (tr[i][1] >= X) {
        const a = tr[i - 1], b = tr[i];
        const f = (X - a[1]) / (b[1] - a[1]);
        return { t: a[0] + f * (b[0] - a[0]), y: a[2] + f * (b[2] - a[2]), v: a[3] + f * (b[3] - a[3]) };
      }
    }
    return null;
  }
  // Launch angle (above the muzzle-to-target line) that puts the bullet on target at range R.
  function superelevation(ammo, R) {
    let a0 = 0, a1 = 0.002;
    let f0 = interpAtX(trajectory(ammo, a0, R + 1), R).y;
    let f1 = interpAtX(trajectory(ammo, a1, R + 1), R).y;
    for (let i = 0; i < 30 && Math.abs(f1) > 1e-6; i++) {
      const a2 = a1 - f1 * (a1 - a0) / (f1 - f0);
      a0 = a1; f0 = f1; a1 = a2;
      f1 = interpAtX(trajectory(ammo, a1, R + 1), R).y;
    }
    return a1;
  }
  function ballisticsTable(ammo, ranges) {
    const flat = trajectory(ammo, 0, Math.max.apply(null, ranges) + 5);
    return ranges.map(R => {
      const r = interpAtX(flat, R);
      const se = superelevation(ammo, R);
      return { R, tof: r.t, v: r.v, mach: r.v / SOUND_STD, dropBore: -r.y, superDeg: se / DEG, superMrad: se * 1000, soundArrival: R / SOUND_STD };
    });
  }

  // ------------------------------------------------------------------ live view helpers
  // Irradiance at the sensor (W/m^2) over time, for cloud and glow separately.
  function irradianceSeries(p, R, thDeg, t0, t1, n) {
    const th = thDeg * DEG;
    const Tat = atmTransmission(p, R);
    const Ip = plumeIntensity(p, th) * Tat / (R * R), Ig = glowIntensity(p, th) * Tat / (R * R);
    const pp = plumePulse(p.flash, 1), gp = glowPulse(p.glow, 1);
    const t = [], ep = [], eg = [];
    for (let i = 0; i < n; i++) {
      const ti = t0 + (t1 - t0) * i / (n - 1);
      t.push(ti); ep.push(Ip * pp.g(ti)); eg.push(Ig * gp.g(ti));
    }
    return { t, ep, eg };
  }
  // One simulated capture: per-frame images (electrons above background), saturation flags,
  // and the equivalent irradiance per frame (sum over the region / collecting factor).
  function simulateCapture(p, s, R, thDeg, opts) {
    opts = opts || {};
    const th = thDeg * DEG;
    const ctx = makeContext(p, s, R);
    const { sd, npix, K, h } = ctx;
    const spatial = renderSpatial(p, s, sd, R, th, opts.orient || 0, opts.dx || 0, opts.dy || 0, h);
    const phase = opts.phase == null ? 0 : opts.phase;
    const mean = buildMean(ctx, p, th, spatial, phase, 1, 1);
    const sat = ctx.sat;
    const rng = opts.noise ? makeRng(opts.seed || 1) : null;
    const frames = [];
    const starts = frameStarts(sd, phase, K);
    // irradiance-equivalent of one electron in one frame: E = N * E_ph / (Aap tau qe tint)
    const eToIrr = E_PHOT / (sd.Aap * s.tau * s.qe * sd.tint);
    for (let k = 0; k < K; k++) {
      const img = new Float64Array(npix), satm = new Uint8Array(npix);
      let sum = 0, nsat = 0;
      for (let i = 0; i < npix; i++) {
        const mu = mean[k * npix + i];
        let v = mu;
        if (rng) v = mu + Math.sqrt(sd.varBase + Math.max(mu, 0)) * rng.n();
        if (v >= sat) { v = sat; satm[i] = 1; nsat++; }
        img[i] = v; sum += v;
      }
      frames.push({ start: starts[k], end: starts[k] + sd.tint, img, sat: satm, nsat, sum, irr: sum * eToIrr, meanSum: 0 });
    }
    for (let k = 0; k < K; k++) {
      let ms = 0;
      for (let i = 0; i < npix; i++) ms += mean[k * npix + i];
      frames[k].meanSum = ms; frames[k].meanIrr = ms * eToIrr;
    }
    return { ctx, frames, h, W: 2 * h + 1, sigma: sd.sigma, satLevel: sat, eToIrr };
  }
  // High-resolution radiance map of the cloud for display (W m^-2 sr^-1), muzzle at the left-centre region.
  function radianceMap(p, thDeg, nx, ny, spanX, spanY, x0) {
    const th = thDeg * DEG;
    const g = plumeGeom(p.flash, th);
    const out = new Float64Array(nx * ny);
    let mx = 0;
    for (let j = 0; j < ny; j++) {
      const v = (0.5 - (j + 0.5) / ny) * spanY;
      for (let i = 0; i < nx; i++) {
        const u = x0 + (i + 0.5) / nx * spanX;
        const L = plumeRadiance(p, th, u, v, g);
        out[j * nx + i] = L; if (L > mx) mx = L;
      }
    }
    return { data: out, max: mx };
  }

  const API = {
    PHYS, BAND, LAMBDA_EFF, E_PHOT, DEG, SOUND_STD, ANG_GRID, AMMO, SENSORS, DEFAULTS, G7_TABLE, FEATURE_NAMES,
    erf, normCdf, normInv, makeRng, hashSeed, planckPhotonRadiance, planckBandRadiance, bandRadianceToTemperature,
    defaultParams, defaultSensors, clone,
    plumeGeom, Hfun, plumeEmission, plumeIntensity, plumeRadiance, glowCloudPath, boreFraction, glowCutoffDeg,
    glowCloudTransmission, glowIntensity, glowEquivalentTemperature, flashScale, glowSuppressorScale,
    plumePulse, glowPulse, atmTransmission, sensorDerived, electronsPerJoulePerSr,
    plumeSamples, quadrature, renderSpatial, applyHalo, roiHalf, makeContext, buildMean, matchedStat,
    bestCaseMean, bestCaseReference, bestCaseDprime, bestCaseThreshold,
    qualityN, variantParams, featureKind, computeFeatures, drawRealistic, fitGauss, gaussLogPdf, qdaPc, collectShots,
    makeBuf, realisticThreshold,
    cdG7, trajectory, superelevation, ballisticsTable, interpAtX,
    irradianceSeries, simulateCapture, radianceMap
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.FlashCore = API;
})(typeof window !== 'undefined' ? window : this);
