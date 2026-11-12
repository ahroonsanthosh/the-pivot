/* Wearable APS Sim: model engine. Pure functions, no DOM. Loads in the browser (window.APSEngine) and in Node (require).
 *
 * Frame: x right, y up, z forward (the wearer faces +z). Bearings are degrees from the wearer's front, positive to the right.
 * Units inside the engine are SI (m, s, kg, W) unless a name says otherwise (Ms = milliseconds, Deg = degrees).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.APSEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
"use strict";

const VERSION = "2.0.0";
const D2R = Math.PI / 180;
const RHO_AIR = 1.225;
const G = 9.81;
const LEVEL_RANK = { none: 0, fragment: 1, handgun: 2, rifle: 3, heavy: 4, never: 99 };
const BASE_MASS = 105, BASE_COM_Y = 1.0;      // wearer + standard kit
const POD_HOUSING = 0.020, HARNESS_USB = 0.030, HARNESS_MIPI = 0.012, RADAR_HOUSING = 0.015;
const HAPTICS = 0.025, CYLINDER = 0.030, CARRIAGE = 0.030, DEPLOY_SWING_DEG = 90;
const CONVERSION_LOSS = 1.1, USABLE_CAPACITY = 0.9, FUSION_MS = 0.1, EVENT_BATCH_MS = 1.0;
const TORSO_Y = 1.32;

/* ------------------------------------------------------------------ maths */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* Complementary error function, fractional error < 1.2e-7 (Numerical Recipes erfcc). */
function erfc(x) {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
    t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
const Q = (z) => 0.5 * erfc(z / Math.SQRT2);       // upper tail of the standard normal
const Phi = (z) => 1 - Q(z);
function gauss(rng) { let u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }
function choose(n, k) { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; }
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const angDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
function quantile(sorted, q) { if (!sorted.length) return null; const i = clamp(Math.floor(q * sorted.length), 0, sorted.length - 1); return sorted[i]; }

/* ------------------------------------------------------------------ ballistics
 * Constant-Cd quadratic drag gives closed forms. With drag length L = 2m / (rho Cd A):
 *   v(s) = v0 exp(-s/L),  t(s) = (L/v0)(exp(s/L) - 1),  s(t) = L ln(1 + v0 t / L).
 * Powered threats (rockets, drones) fly at constant speed (L = infinity).
 */
function threatSI(th) {
  const d = th.d / 1000, m = th.mass / 1000;
  const lam = th.powered || !(th.cd > 0) ? Infinity : (2 * m) / (RHO_AIR * th.cd * Math.PI * d * d / 4);
  return { ...th, dM: d, mKg: m, lam };
}
const tAtDist = (s, v0, lam) => (lam === Infinity ? s / v0 : (lam / v0) * Math.expm1(s / lam));
const distAtT = (t, v0, lam) => (lam === Infinity ? v0 * t : lam * Math.log1p((v0 * t) / lam));
const velAtDist = (s, v0, lam) => (lam === Infinity ? v0 : v0 * Math.exp(-s / lam));

/* ------------------------------------------------------------------ body geometry and mounts */
const POD_MOUNTS = {
  helmet:   { y: 1.70, a: 0.165, b: 0.175, tilt: 4, head: true,  label: "Helmet rail" },
  shoulder: { y: 1.47, a: 0.25,  b: 0.18,  tilt: 0, head: false, label: "Shoulder straps" },
  vest:     { y: 1.22, a: 0.235, b: 0.19,  tilt: 0, head: false, label: "Plate carrier" },
};
const RADAR_RING = { y: 1.33, a: 0.215, b: 0.175 };
const RESP_MOUNTS = {
  back:     { pos: [0, 1.36, -0.30], label: "Back plate" },
  shoulder: { pos: [0.27, 1.55, -0.06], label: "Right shoulder" },
};
function bodyOccluders(withPack) {
  const o = [
    { t: "sph", c: [0, 1.655, 0], r: 0.13 },                           // head and helmet
    { t: "cyl", cx: 0, cz: 0, a: 0.19, b: 0.13, y0: 0.95, y1: 1.50 },    // torso and plate carrier
    { t: "cyl", cx: 0, cz: 0, a: 0.18, b: 0.12, y0: 0.05, y1: 0.95 },    // hips and legs
  ];
  if (withPack) o.push({ t: "cyl", cx: 0, cz: -0.23, a: 0.15, b: 0.075, y0: 1.0, y1: 1.42 }); // response pack
  return o;
}
function rayHits(o, p, d) {
  if (o.t === "sph") {
    const ox = p[0] - o.c[0], oy = p[1] - o.c[1], oz = p[2] - o.c[2];
    const b = ox * d[0] + oy * d[1] + oz * d[2], c = ox * ox + oy * oy + oz * oz - o.r * o.r;
    if (c <= 0) return true;
    const disc = b * b - c; return disc >= 0 && -b - Math.sqrt(disc) > 0;
  }
  const px = (p[0] - o.cx) / o.a, pz = (p[2] - o.cz) / o.b, dx = d[0] / o.a, dz = d[2] / o.b;
  const A = dx * dx + dz * dz, B = 2 * (px * dx + pz * dz), C = px * px + pz * pz - 1;
  if (C <= 0) return p[1] >= o.y0 && p[1] <= o.y1;
  if (A < 1e-12) return false;
  const disc = B * B - 4 * A * C; if (disc < 0) return false;
  const s = (-B - Math.sqrt(disc)) / (2 * A); if (s <= 0) return false;
  const y = p[1] + s * d[1]; return y >= o.y0 && y <= o.y1;
}
function inside(o, p) {
  if (o.t === "sph") return Math.hypot(p[0] - o.c[0], p[1] - o.c[1], p[2] - o.c[2]) < o.r;
  const px = (p[0] - o.cx) / o.a, pz = (p[2] - o.cz) / o.b;
  return px * px + pz * pz < 1 && p[1] >= o.y0 && p[1] <= o.y1;
}
/* Place n units evenly round an ellipse, first one facing front, pushed clear of any occluder. */
function ringPlacement(ring, n, tilt, occ) {
  return Array.from({ length: n }, (_, i) => {
    const az = (i * 360) / n, a = az * D2R;
    const pos = [Math.sin(a) * ring.a, ring.y, Math.cos(a) * ring.b];
    for (let k = 0; k < 30 && occ.some((o) => inside(o, pos)); k++) { pos[0] += Math.sin(a) * 0.01; pos[2] += Math.cos(a) * 0.01; }
    return { az, tilt, pos };
  });
}
const dirVec = (azDeg, elDeg) => { const a = azDeg * D2R, e = elDeg * D2R; return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)]; };
/* Direction into a unit's frame (forward +z) given its yaw and tilt in degrees. */
function toLocal(d, yawDeg, tiltDeg) {
  const y = yawDeg * D2R, t = tiltDeg * D2R;
  const x1 = d[0] * Math.cos(y) - d[2] * Math.sin(y), z1 = d[0] * Math.sin(y) + d[2] * Math.cos(y);
  return [x1, d[1] * Math.cos(t) - z1 * Math.sin(t), d[1] * Math.sin(t) + z1 * Math.cos(t)];
}

/* ------------------------------------------------------------------ coverage grid (az x el), cached by geometry */
const GRID = { az0: -180, el0: -40, step: 2, nAz: 180, nEl: 60 };
const covCache = new Map();
function cellIndex(az, el) {
  const i = clamp(Math.floor((wrap180(az) - GRID.az0) / GRID.step), 0, GRID.nAz - 1);
  const j = clamp(Math.floor((el - GRID.el0) / GRID.step), 0, GRID.nEl - 1);
  return j * GRID.nAz + i;
}
function buildCoverage(pods, podFov, radars, radFov, occ) {
  const key = JSON.stringify([pods, podFov, radars, radFov, occ.length]);
  if (covCache.has(key)) return covCache.get(key);
  const N = GRID.nAz * GRID.nEl, cam = new Uint8Array(N), rad = new Uint8Array(N), occl = new Uint8Array(N);
  const th = podFov ? Math.tan((podFov.h / 2) * D2R) : 0, tv = podFov ? Math.tan((podFov.v / 2) * D2R) : 0;
  for (let j = 0; j < GRID.nEl; j++) {
    const el = GRID.el0 + (j + 0.5) * GRID.step;
    for (let i = 0; i < GRID.nAz; i++) {
      const az = GRID.az0 + (i + 0.5) * GRID.step, d = dirVec(az, el), idx = j * GRID.nAz + i;
      for (const p of pods) {
        const l = toLocal(d, p.az, p.tilt);
        if (l[2] > 1e-6 && Math.abs(l[0] / l[2]) <= th && Math.abs(l[1] / l[2]) <= tv) {
          if (occ.some((o) => rayHits(o, p.pos, d))) occl[idx] = 1; else cam[idx]++;
        }
      }
      for (const r of radars) {
        const l = toLocal(d, r.az, r.tilt);
        if (l[2] > 0 && Math.abs(Math.atan2(l[0], l[2])) <= radFov.az * D2R && Math.abs(Math.asin(clamp(l[1], -1, 1))) <= radFov.el * D2R) {
          if (!occ.some((o) => rayHits(o, r.pos, d))) rad[idx]++;
        }
      }
    }
  }
  const g = { cam, rad, occ: occl };
  if (covCache.size > 300) covCache.clear();
  covCache.set(key, g);
  return g;
}
/* Share of directions covered inside an elevation band, weighted by solid angle. */
function coverageShare(grid, layer, el0, el1) {
  let tot = 0, hit = 0;
  for (let j = 0; j < GRID.nEl; j++) {
    const el = GRID.el0 + (j + 0.5) * GRID.step; if (el < el0 || el > el1) continue;
    const w = Math.cos(el * D2R);
    for (let i = 0; i < GRID.nAz; i++) { tot += w; if (grid[layer][j * GRID.nAz + i] > 0) hit += w; }
  }
  return tot ? hit / tot : 0;
}

/* ------------------------------------------------------------------ library helpers */
function makeLibrary(parts) {
  const byId = Object.create(null), byCat = Object.create(null);
  for (const p of parts) { byId[p.id] = p; (byCat[p.cat] = byCat[p.cat] || []).push(p); }
  return { byId, byCat, parts };
}
const findById = (arr, id) => arr.find((x) => x.id === id) || arr[0];

/* ------------------------------------------------------------------ derive a build into a system model */
function derive(b, lib, scen, cat) {
  const issues = [];
  const bad = (msg, slot) => issues.push({ level: "bad", msg, slot });
  const warn = (msg, slot) => issues.push({ level: "warn", msg, slot });
  const get = (slot, catName) => {
    const id = b[slot]; if (!id || id === "none") return null;
    const p = lib.byId[id];
    if (!p) { bad(`Part "${id}" in the ${slot} slot is not in the library.`, slot); return null; }
    if (catName && p.cat !== catName) { bad(`${p.name} is not a ${catName} part.`, slot); return null; }
    return p;
  };
  const env = findById(cat.ENVIRONMENTS, scen.env), act = findById(cat.ACTIVITIES, scen.activity), chem = findById(cat.BATTERIES, b.battChem);
  const cam = get("camera", "camera"), lens = get("lens", "lens"), comp = get("compute", "compute");
  const radar = b.radars > 0 ? get("radar", "radar") : null;
  const ctrl = get("controller", "controller"), drv = get("driver", "driver");
  const aimAct = get("aim", "actuator");
  const frame = aimAct ? get("frame", "structure") : null, gear = aimAct ? get("gearing", "structure") : null;  // structure only matters with an aiming actuator
  const shield = get("shield", "shield");
  const deployMode = !b.deploy || b.deploy === "none" ? "none" : b.deploy === "pneumatic" ? "pneumatic" : "actuator";
  const depAct = deployMode === "actuator" ? get("deploy", "actuator") : null;
  const pSrc = deployMode === "pneumatic" ? get("pSource", "pneumatic") : null;
  const pValve = deployMode === "pneumatic" ? get("pValve", "pneumatic") : null;
  const pLine = deployMode === "pneumatic" ? get("pLine", "pneumatic") : null;
  if (!comp) bad("No compute selected: nothing processes the sensors.", "compute");
  if (!ctrl) bad("No controller selected: the cue has no output.", "controller");

  const respMode = shield ? "shield" : aimAct || deployMode !== "none" ? "mech" : "warn";
  const hasPack = respMode !== "warn" && b.respMount === "back";
  const occ = bodyOccluders(hasPack);

  /* ---------------- cameras */
  let camSys = null, pods = [], podFov = null;
  if (cam && lens && b.pods > 0 && comp) {
    const band = cam.band, event = band === "event";
    let ok = true;
    if ((lens.band === "lwir") !== (band === "lwir")) {
      bad(`${lens.name} is a ${lens.band === "lwir" ? "thermal" : "visible"} lens; ${cam.name} needs a ${band === "lwir" ? "germanium LWIR" : "visible"} lens.`, "lens");
      ok = false;
    }
    let active = b.pods;
    if (cam.iface === "mipi" && b.pods > comp.csiPorts) {
      if (comp.csiPorts === 0) { bad(`${comp.name} has no MIPI CSI ports for ${cam.name}.`, "compute"); ok = false; }
      else bad(`${b.pods} MIPI pods but ${comp.name} has ${comp.csiPorts} CSI ports: only ${comp.csiPorts} pods can stream.`, "pods");
      active = Math.min(b.pods, comp.csiPorts);
    }
    const roi = event ? 1 : clamp(b.roi || 1, 0.05, 1);
    const hres = cam.hres, vres = Math.max(8, Math.round(cam.vres * roi));
    const hfov = lens.hfov, vfov = (2 * Math.atan(Math.tan((hfov / 2) * D2R) * (vres / hres))) / D2R;
    const ifov = (2 * Math.tan((hfov / 2) * D2R)) / hres;  // centre-pixel angle of a rectilinear lens, rad
    const light = clamp(env.light, 1e-5, 1);
    let fpsSensor, dt0, tInt;
    if (event) { dt0 = (cam.latUs * 1e-6) / Math.sqrt(clamp(light, 0.01, 1)); fpsSensor = 1 / dt0; tInt = dt0; }
    else { fpsSensor = Math.min(cam.fpsMax || cam.fps, cam.fps / roi); dt0 = 1 / fpsSensor; }
    if (band === "vis") tInt = Math.min(dt0, Math.max(cam.minExpUs || 1, b.expUs || 100) * 1e-6);
    if (band === "lwir") tInt = cam.tauMs * 1e-3;

    // data and compute demand
    let bitsPerPod, pixPerPod, evRate = 0;
    if (event) { evRate = cam.evRate * (act.omega / 0.5) + (cam.bgRate * hres * vres) / 1e6; bitsPerPod = evRate * 1e6 * cam.bits; pixPerPod = evRate * 1e6 * 20; }
    else { bitsPerPod = hres * vres * cam.bits * fpsSensor; pixPerPod = hres * vres * fpsSensor; }
    const bwCap = cam.iface === "mipi" ? active * cam.linkGbps : comp.usbGbps;
    const bwDemand = (active * bitsPerPod) / 1e9;
    const bwLoad = bwCap > 0 ? bwDemand / bwCap : Infinity;
    const perPodLink = cam.iface === "mipi" ? cam.linkGbps : Math.min(cam.linkGbps, comp.usbGbps / Math.max(1, active));
    const linkLoad = (bitsPerPod / 1e9) / perPodLink;
    const pixLoad = (active * pixPerPod) / (comp.pixRate * 1e6);
    if (!(bwCap > 0)) { bad(`${comp.name} has no USB3 bandwidth for ${cam.name}.`, "compute"); ok = false; }
    const throttle = Math.max(1, bwLoad, pixLoad, linkLoad);
    if (throttle > 1.0001) warn(`Pipeline saturated by ${bwLoad >= pixLoad ? "camera bandwidth" : "compute throughput"}: ${event ? "event backlog adds latency" : `frame rate cut to ${Math.round(fpsSensor / throttle)} fps`}.`, "compute");
    const dt = event ? dt0 : 1 / (fpsSensor / throttle);
    let latS;
    const procMs = comp.baseLatMs + (event ? EVENT_BATCH_MS * throttle : (hres * vres) / ((comp.pixRate * 1e6) / Math.max(1, active)) * 1e3);
    const xferMs = event ? 0.05 : ((hres * vres * cam.bits) / (perPodLink * 1e9)) * 1e3;
    const outS = (cam.outLatMs || 0) / 1000;
    if (event) latS = dt + procMs / 1000 + outS;
    else latS = tInt / 2 + outS + xferMs / 1000 + procMs / 1000;

    // noise: sensor (photon-limited for visible) and residual clutter after frame differencing
    let sigS;
    if (band === "vis") sigS = (cam.noise * (lens.fno / 2)) / Math.sqrt(Math.max(1e-9, (light * tInt) / 1e-4));
    else if (band === "lwir") sigS = cam.noise;
    else sigS = (cam.evThresh / 5) * (light < 0.01 ? Math.sqrt(0.01 / light) : 1);
    const motionWindow = event ? EVENT_BATCH_MS / 1000 : dt;
    const motionPx = (act.omega * motionWindow) / ifov;
    const clutterBase = band === "lwir" ? env.irClutter : env.clutter;
    const sigC = clutterBase * Math.min(1, 0.05 + motionPx * (1 - clamp(b.stab, 0, 0.99)));
    const sigma = Math.hypot(sigS, sigC);
    // false alarms from noise: per pixel-sample, then M-of-N gating in a 3x3 gate
    const pfa = event ? Math.min(1, cam.bgRate * dt * (Q(b.k) / Q(5))) : Q(b.k);
    const M = clamp(Math.round(b.confM), 1, 12), Nw = clamp(Math.max(M, Math.round(b.confN)), M, 16);
    const seeds = active * hres * vres * (1 / dt) * pfa;
    const farH = seeds * choose(Nw - 1, M - 1) * Math.pow(Math.min(1, 9 * pfa), M - 1) * 3600;
    const bearingErr = (ifov / D2R) + 0.3;

    pods = ringPlacement(POD_MOUNTS[b.podMount] || POD_MOUNTS.shoulder, b.pods, (POD_MOUNTS[b.podMount] || POD_MOUNTS.shoulder).tilt, occ);
    podFov = { h: hfov, v: vfov };
    const activePods = pods.slice(0, active);
    camSys = {
      ok, part: cam, lens, band, event, lwir: band === "lwir", active, n: b.pods, hres, vres, roi, hfov, vfov, ifov, fpsSensor, fps: 1 / dt, dt, tInt,
      tauS: band === "lwir" ? cam.tauMs / 1000 : 0, eta: lens.eta, sigma, sigS, sigC, k: b.k, M, N: Nw, latS, xferMs, procMs, throttle, bwDemand, bwCap, bwLoad, pixLoad,
      pixDemand: active * pixPerPod, evRate, pfa, farH, bearingErr, motionPx,
      contrast: (th) => (band === "lwir" ? th.cIR : th.cVis * env.visMult),
      activePods,
    };
  } else if (b.pods > 0 && cam && !lens) warn("No lens selected.", "lens");

  /* ---------------- radars */
  let radSys = null, radars = [], radFov = null;
  if (radar && b.radars > 0) {
    const lambda = 0.299792458 / radar.freq;                  // m, freq in GHz
    const dR = 0.149896229 / radar.bw;                         // range resolution, m
    const loopS = radar.tcUs * 1e-6 * radar.tx;
    const burstS = radar.chirps * loopS;
    const vAmb = lambda / (4 * loopS);
    const rdet = (rcs, v) => {
      let R = radar.rRef * Math.pow(Math.max(rcs, 1e-12), 0.25);
      if (!radar.ballistic) {
        const nEff = clamp(dR / (v * loopS), 1, radar.chirps);      // chirps the target stays inside one range bin
        const intra = Math.min(1, dR / (v * radar.tcUs * 1e-6 * 0.8)); // smear inside one chirp
        R *= Math.pow((nEff / radar.chirps) * intra, 0.25);
      }
      return R;
    };
    const helmetRadar = radar.mount === "helmet";
    radars = ringPlacement(helmetRadar ? POD_MOUNTS.helmet : RADAR_RING, b.radars * Math.max(1, Math.round(radar.apertures || 1)), 0, occ);
    radFov = { az: radar.fovAz, el: radar.fovEl };
    if (radar.mode === "chronograph") warn(`${radar.name} reports shot records after the event; it cannot cue a response in time.`, "radar");
    radSys = { part: radar, n: b.radars, lambda, dR, loopS, burstS, vAmb, frameS: 1 / radar.frameHz, latS: burstS / 2 + radar.procMs / 1000,
      rdet, bearingErr: radar.mode === "chronograph" ? 180 : radar.bearingErr, confirm: Math.max(1, Math.round(radar.confirm)), farH: radar.farH * b.radars, mode: radar.mode };
  }

  /* ---------------- fusion and false alarms */
  const camFar = camSys ? camSys.farH : 0, radFar = radSys ? radSys.farH : 0;
  let fusion = b.fusion || "or";
  if (fusion === "and" && (!camSys || !radSys)) { warn("AND fusion needs both cameras and radar; using whichever is fitted.", "fusion"); fusion = camSys ? "cam" : "radar"; }
  if (fusion === "cam" && !camSys) fusion = "radar";
  if (fusion === "radar" && !radSys) fusion = "cam";
  const farH = fusion === "or" ? camFar + radFar : fusion === "and" ? camFar * radFar * (0.2 / 3600) : fusion === "cam" ? camFar : radFar;
  const coverage = buildCoverage(camSys && camSys.ok ? camSys.activePods.map((p) => ({ az: p.az, tilt: p.tilt, pos: p.pos.map((x) => +x.toFixed(4)) })) : [], podFov,
    radars.map((r) => ({ az: r.az, tilt: r.tilt, pos: r.pos.map((x) => +x.toFixed(4)) })), radFov || { az: 0, el: 0 }, occ);

  /* ---------------- response chain */
  const provides = new Set([...(ctrl ? ctrl.provides || [] : []), ...(drv ? drv.provides || [] : [])]);
  if (drv && drv.needsMcu && ctrl && drv.needsMcu !== ctrl.mcu) bad(`${drv.name} needs a ${drv.needsMcu} controller; ${ctrl.name} is not one.`, "driver");
  const needDrive = (a, slot) => { if (a && !provides.has(a.drive)) bad(`${a.name} needs a ${a.drive === "step" ? "step/dir" : a.drive === "dc" ? "DC H-bridge" : "PWM"} output; the controller and driver do not provide one.`, slot); };
  needDrive(aimAct, "aim"); needDrive(depAct, "deploy");
  let aim = null;
  const axes = aimAct ? clamp(Math.round(b.aimAxes || 1), 1, 2) : 0;   // 2 = pan and tilt: the element also points in elevation
  const gearRatio = gear ? gear.ratio : frame ? frame.ratio || 1 : 1;
  if (aimAct) {
    if (aimAct.kind === "linear") bad(`${aimAct.name} is linear; it cannot slew a turret. Use it for deployment.`, "aim");
    else {
      const speed = aimAct.speed / gearRatio, accel = aimAct.accel > 0 ? aimAct.accel / gearRatio : 0;
      const range = Math.min(aimAct.range / gearRatio, frame ? frame.slew : 360, gear ? gear.slew : 360);
      const posErr = Math.hypot(aimAct.posErr / gearRatio, frame ? frame.posErr : 0, gear ? gear.posErr : 0);
      const time = (deg) => {
        if (deg < 0.5) return 0;
        let s;
        if (accel > 0) s = deg <= (speed * speed) / accel ? 2 * Math.sqrt(deg / accel) : deg / speed + speed / accel;
        else s = deg / speed;
        return aimAct.deadMs + s * 1000;
      };
      aim = { part: aimAct, speed, accel, range, posErr, time };
    }
  }

  const shieldW = shield ? shield.w / 1000 : 0, shieldH = shield ? shield.h / 1000 : 0;
  const shieldKg = shield ? shieldW * shieldH * shield.areal : 0;
  let standoff = clamp(b.standoff || 0.25, 0.05, 1.5), deployMs = 0;
  if (deployMode === "pneumatic") {
    if (!pSrc || !pValve || !pLine) { bad("Pneumatic deployment needs a pressure source, a valve and a line.", "deploy"); deployMs = Infinity; }
    else {
      const area = Math.PI * Math.pow((b.bore || 16) / 2000, 2);
      const force = pSrc.bar * 1e5 * area, mMove = shieldKg + CARRIAGE;
      const accel = force / mMove;
      deployMs = pValve.deadMs + pLine.deadMs + Math.sqrt((2 * standoff) / accel) * 1000;
      if (pSrc.bar <= 0) { bad(`${pSrc.name} delivers no pressure.`, "deploy"); deployMs = Infinity; }
    }
  } else if (deployMode === "actuator" && depAct) {
    if (depAct.kind === "linear") {
      const reach = depAct.range / 1000;
      if (reach < standoff) { warn(`${depAct.name} strokes ${depAct.range} mm, so the element only reaches ${Math.round(reach * 1000)} mm out.`, "deploy"); standoff = reach; }
      deployMs = depAct.deadMs + ((standoff * 1000) / depAct.speed) * 1000;
      if (depAct.force > 0 && shieldKg > 0 && depAct.force < (shieldKg + CARRIAGE) * G) bad(`${depAct.name} gives ${depAct.force} N; lifting the element needs ${((shieldKg + CARRIAGE) * G).toFixed(1)} N.`, "deploy");
    } else {
      const sw = DEPLOY_SWING_DEG, sp = depAct.speed, ac = depAct.accel;
      const s = ac > 0 ? (sw <= (sp * sp) / ac ? 2 * Math.sqrt(sw / ac) : sw / sp + sp / ac) : sw / sp;
      deployMs = depAct.deadMs + s * 1000;
      const need = (shieldKg + CARRIAGE) * G * standoff;
      if (depAct.force > 0 && shieldKg > 0 && depAct.force < need) bad(`${depAct.name} gives ${depAct.force} N·m; swinging the element out ${Math.round(standoff * 1000)} mm needs ${need.toFixed(2)} N·m.`, "deploy");
    }
  }
  const staticShield = shield && !aim && deployMode === "none";
  const resp = {
    mode: respMode, aim, axes, deployMode, deployMs, standoff, shield, shieldW, shieldH, shieldKg, staticShield,
    drvMs: drv ? drv.latMs : 0, posErr: aim ? aim.posErr : 0, mount: RESP_MOUNTS[b.respMount] || RESP_MOUNTS.back,
  };

  /* ---------------- mass, power, cost */
  const pm = POD_MOUNTS[b.podMount] || POD_MOUNTS.shoulder;
  const items = [];
  const add = (key, name, kg, color, pos, head, part) => { if (kg > 0) items.push({ key, name, mass: kg, color, y: pos[1], z: pos[2], head: !!head, part }); };
  if (cam && b.pods > 0) add("cams", `Camera pods ×${b.pods}`, b.pods * ((cam.mass + (lens ? lens.mass : 0)) / 1000 + POD_HOUSING), "--accent", [0, pm.y, 0], pm.head, cam);
  if (cam && b.pods > 0) add("harness", `${cam.iface === "mipi" ? "MIPI" : "USB"} harness`, b.pods * (cam.iface === "mipi" ? HARNESS_MIPI : HARNESS_USB), "--muted", [0, (pm.y + 1.25) / 2, -0.05], false);
  if (radar && b.radars > 0) {
    const onHelmet = radar.mount === "helmet";
    add("radar", `${radar.name} ×${b.radars}`, b.radars * (radar.mass / 1000 + (onHelmet ? 0 : RADAR_HOUSING)), "--radar", [0, onHelmet ? POD_MOUNTS.helmet.y : RADAR_RING.y, 0.1], onHelmet, radar);
  }
  if (comp) add("compute", `${comp.name} + enclosure`, (comp.mass + (comp.enclosure || 0)) / 1000, "--sensor", [0, 1.30, -0.20], false, comp);
  const battKg = b.battWh / chem.whkg;
  add("batt", `Battery ${b.battWh} Wh`, battKg, "--warn", [0, 1.10, -0.20], false);
  if (ctrl) add("ctrl", `${ctrl.name} + haptics`, ctrl.mass / 1000 + HAPTICS, "--ok", [0, 1.42, 0.12], false, ctrl);
  if (drv && drv.mass > 0) add("drv", drv.name, drv.mass / 1000, "--ok", [0, 1.30, -0.18], false, drv);
  const rp = resp.mount.pos;
  const respKg = (aimAct ? aimAct.mass * axes : 0) / 1000 + (frame ? frame.mass : 0) / 1000 + (gear ? gear.mass : 0) / 1000 +
    (depAct ? depAct.mass / 1000 : 0) + (deployMode === "pneumatic" ? ((pSrc ? pSrc.mass : 0) + (pValve ? pValve.mass : 0) + (pLine ? pLine.mass : 0)) / 1000 + CYLINDER : 0);
  add("resp", "Response mechanism", respKg, "--resp", rp, false);
  add("shield", shield ? shield.name : "Protective element", shieldKg, "--bad", rp, false, shield);
  add("extra", "Other kit (placeholder)", b.extraMass || 0, "--kit", [0, 1.05, -0.22], false);
  const added = items.reduce((s, i) => s + i.mass, 0);
  const headMass = items.filter((i) => i.head).reduce((s, i) => s + i.mass, 0);
  const Mt = BASE_MASS + added;
  const comY = (BASE_MASS * BASE_COM_Y + items.reduce((s, i) => s + i.mass * i.y, 0)) / Mt;
  const comZ = items.reduce((s, i) => s + i.mass * i.z, 0) / Mt;

  const pw = [];
  const addP = (name, w) => { if (w > 0) pw.push({ name, w }); };
  if (cam && camSys) addP("Cameras", camSys.active * cam.power);
  if (comp) addP("Compute", comp.power);
  if (radSys && !radar.ownBattery) addP("Radar", b.radars * radar.power);
  if (ctrl) addP("Controller", ctrl.power);
  if (drv) addP("Driver", drv.power);
  if (aimAct) addP(axes > 1 ? "Aim actuators (idle, ×2)" : "Aim actuator (idle)", (aimAct.idleW || 0) * axes);
  if (depAct) addP("Deploy actuator (idle)", depAct.idleW || 0);
  if (pSrc) addP("Compressor (average)", pSrc.power * (pSrc.duty || 0));
  const pLoad = pw.reduce((s, x) => s + x.w, 0);
  const power = pLoad * CONVERSION_LOSS;
  const runtimeH = power > 0 ? (b.battWh * USABLE_CAPACITY) / power : Infinity;

  const costOf = (p, n = 1) => (p ? (p.cost || 0) * n : 0);
  const cost = costOf(cam, b.pods) + costOf(lens, b.pods) + costOf(radar, b.radars) + costOf(comp) + costOf(ctrl) + costOf(drv) + costOf(aimAct, axes) +
    costOf(frame) + costOf(gear) + costOf(depAct) + costOf(pSrc) + costOf(pValve) + costOf(pLine) + costOf(shield);

  /* ---------------- readiness (weakest rated link) */
  const slots = [["Camera", cam], ["Lens", lens], ["Radar", radar], ["Compute", comp], ["Controller", ctrl], ["Driver", drv && drv.id !== "direct" ? drv : null],
    ["Aim actuator", aimAct], ["Turret frame", frame], ["Gearing", gear], ["Deploy actuator", depAct], ["Pressure source", pSrc], ["Valve", pValve], ["Line", pLine], ["Protective element", shield]]
    .filter(([, p]) => p).map(([slot, p]) => ({ slot, part: p, rating: p.rating == null ? null : +p.rating, status: p.status || "unverified" }));
  slots.filter((s) => s.status === "eol").forEach((s) => warn(`${s.part.name} is end-of-life: it cannot be procured for a product.`, s.slot));
  slots.filter((s) => s.part.export).forEach((s) => warn(`${s.part.name}: ${s.part.export}.`, s.slot));
  slots.filter((s) => s.status === "claimed").forEach((s) => warn(`${s.part.name}: performance figures are vendor claims with no independent test data.`, s.slot));
  const rated = slots.filter((s) => s.rating != null);
  const readiness = { slots, min: rated.length ? Math.min(...rated.map((s) => s.rating)) : null, mean: rated.length ? rated.reduce((a, s) => a + s.rating, 0) / rated.length : null,
    unrated: slots.filter((s) => s.rating == null).map((s) => s.slot), weakest: rated.length ? rated.reduce((a, s) => (s.rating < a.rating ? s : a)) : null };

  return {
    build: b, env, act, chem, needMs: scen.needMs, ctrlMs: ctrl ? ctrl.latMs : 0, cam: camSys, rad: radSys, fusion, farH, camFar, radFar, coverage, pods, radars, podFov, radFov, occ, resp,
    items, added, headMass, comDy: (comY - BASE_COM_Y) * 1000, comDz: comZ * 1000, power, pLoad, powerItems: pw, runtimeH, battKg, cost, readiness, issues,
    covGround: coverageShare(coverage, "cam", -10, 20), covAir: coverageShare(coverage, "cam", 20, 80),
    radGround: coverageShare(coverage, "rad", -10, 20),
  };
}

/* Requirement checks layered on top of the physical issues. */
function evaluate(sys, req) {
  const v = [];
  if (sys.added > req.maxMass) v.push({ level: "bad", msg: `Added mass ${sys.added.toFixed(2)} kg exceeds the ${req.maxMass} kg limit.` });
  if (sys.headMass > req.maxHead) v.push({ level: "bad", msg: `Head-borne mass ${(sys.headMass * 1000).toFixed(0)} g exceeds ${Math.round(req.maxHead * 1000)} g.` });
  if (sys.runtimeH < req.minRuntime) v.push({ level: "bad", msg: `Runtime ${sys.runtimeH.toFixed(1)} h is under the ${req.minRuntime} h requirement.` });
  if (sys.cost > req.maxCost) v.push({ level: "warn", msg: `Parts cost €${Math.round(sys.cost).toLocaleString("en-IE")} exceeds €${req.maxCost.toLocaleString("en-IE")}.` });
  if (sys.farH > req.maxFar) v.push({ level: "warn", msg: `${fmtRate(sys.farH)} false alerts per hour, above the ${req.maxFar}/h limit.` });
  if (req.minRating > 0 && sys.readiness.min != null && sys.readiness.min < req.minRating)
    v.push({ level: "warn", msg: `Weakest rated part is ${sys.readiness.weakest.part.name} at ${sys.readiness.min}/10 (minimum ${req.minRating}).` });
  return { violations: v, feasible: !v.some((x) => x.level === "bad") && !sys.issues.some((x) => x.level === "bad") };
}
function fmtRate(x) { return x >= 100 ? Math.round(x).toLocaleString("en-IE") : x >= 1 ? x.toFixed(1) : x >= 0.01 ? x.toFixed(2) : x > 0 ? x.toExponential(1) : "0"; }

/* ------------------------------------------------------------------ one round */
/* Signal gain from target size: a sub-pixel target gives its area fraction of one pixel; an extended target spreads
 * over many pixels, and a detector that sums over the blob gains with the square root of the pixels covered. */
const sizeGain = (area) => (area < 1 ? area : Math.sqrt(area));
/* Range where the (smear-free) SNR equals k for contrast c, or 0 if it never does. */
function rangeForSnr(cs, c, dM, k) {
  const S1 = (c * cs.eta) / cs.sigma;
  if (!(S1 > 0) || !(k > 0)) return 0;
  const a = S1 >= k ? k / S1 : Math.pow(k / S1, 2);      // pixels the target must cover
  return (dM / cs.ifov) * Math.sqrt(0.7853982 / a);
}
/* Camera path: per-frame detection probability from point-target SNR, M-of-N confirmation. */
function camTrack(cs, th, r0, tImp, ph, mult, bOff, rng, keep) {
  const c = cs.contrast(th);
  const out = { frames: keep ? [] : null, firstDet: null, tConf: null, tAlert: null, rConf: null, pdConf: null, n: 0 };
  if (!(c > 0)) return out;
  const rUb = rangeForSnr(cs, c, th.dM, Math.max(0.5, cs.k - 3.5)) * 1.05;
  const s0 = Math.max(0, r0 - rUb);
  const tStart = s0 >= r0 ? tImp : tAtDist(s0, th.v0, th.lam);
  const dt = cs.dt;
  let j = Math.max(0, Math.ceil(tStart / dt - ph - 1e-9));
  const ring = new Uint8Array(cs.N); let count = 0, n = 0;
  for (;; j++) {
    const t = (j + ph) * dt;
    if (t >= tImp || n > 250000) break;
    const s = distAtT(t, th.v0, th.lam), R = r0 - s; if (R <= 0.05) break;
    const v = velAtDist(s, th.v0, th.lam);
    const ratio = th.dM / (R * cs.ifov);
    let snr = (c * sizeGain(0.7853982 * ratio * ratio) * cs.eta) / cs.sigma;
    const omega = (v * bOff) / (R * R);
    snr /= 1 + (omega * cs.tInt) / cs.ifov;
    if (cs.lwir) snr /= 1 + (cs.tauS * 2 * v) / R;
    const pd1 = Phi(snr - cs.k);
    const pd = mult > 1 ? 1 - Math.pow(1 - pd1, mult) : pd1;
    const hit = rng() < pd ? 1 : 0;
    const slot = n % cs.N; count += hit - ring[slot]; ring[slot] = hit; n++;
    if (keep && out.frames.length < 30000) out.frames.push({ t, R, pd, hit });
    if (hit && out.firstDet == null) out.firstDet = t;
    if (out.tConf == null && count >= cs.M) { out.tConf = t; out.rConf = R; out.pdConf = pd; if (!keep) break; }
  }
  out.n = n;
  if (out.tConf != null) out.tAlert = out.tConf + cs.latS;
  return out;
}
/* Radar path: one look per frame at the burst centre; Pd from the R^-4 law with 3 dB fluctuation. */
function radTrack(rs, th, r0, tImp, rph, mult, rng, keep) {
  const out = { frames: keep ? [] : null, tConf: null, tAlert: null, rConf: null, n: 0 };
  const vImp = velAtDist(r0, th.v0, th.lam);
  const rUb = rs.rdet(th.rcs, vImp) * 2.2;
  const s0 = Math.max(0, r0 - rUb);
  const tStart = s0 >= r0 ? tImp : tAtDist(s0, th.v0, th.lam);
  const dt = rs.frameS;
  let j = Math.max(0, Math.ceil(tStart / dt - rph - 1e-9)), run = 0, n = 0;
  for (;; j++) {
    const t = (j + rph) * dt;
    if (t >= tImp || n > 100000) break;
    const s = distAtT(t, th.v0, th.lam), R = r0 - s; if (R <= 0.05) break;
    const v = velAtDist(s, th.v0, th.lam);
    const Rd = rs.rdet(th.rcs, v);
    const pd1 = Phi((40 * Math.log10(Rd / R)) / 3);
    const pd = mult > 1 ? 1 - Math.pow(1 - pd1, mult) : pd1;
    const hit = rng() < pd; n++;
    run = hit ? run + 1 : 0;
    if (keep && out.frames.length < 20000) out.frames.push({ t, R, pd, hit, rdet: Rd });
    if (out.tConf == null && run >= rs.confirm) { out.tConf = t; out.rConf = R; if (!keep) break; }
  }
  out.n = n;
  if (out.tConf != null) out.tAlert = out.tConf + rs.latS;
  return out;
}

const OUTCOMES = [
  ["protected", "Protected", "--ok"], ["reached", "Mechanism in place", "--ok"], ["warned", "Warned in time", "--ok"],
  ["stop", "Element did not stop it", "--radar"], ["geometry", "Element missed the path", "--warn"], ["slow", "Response too slow", "--accent"],
  ["reach", "Outside slew range", "--resp"], ["short", "Warning too short", "--sensor"], ["late", "Cue after impact", "--ink"],
  ["undetected", "Never confirmed", "--bad"], ["uncovered", "Outside every sensor", "--muted"],
];

function simRound(sys, th, p, rng, keep) {
  const tImp = tAtDist(p.r0, th.v0, th.lam);
  const cell = cellIndex(p.az, p.el);
  const nCam = sys.cam && sys.cam.ok ? sys.coverage.cam[cell] : 0;
  const nRad = sys.rad ? sys.coverage.rad[cell] : 0;
  const bOff = Math.hypot(p.ax, p.ay) + 0.12;
  const o = { tImp, vImp: velAtDist(p.r0, th.v0, th.lam), nCam, nRad, cam: null, rad: null, tAlert: null, src: null, warnS: null, cueErr: null, resp: null, outcome: null };
  if (nCam > 0) o.cam = camTrack(sys.cam, th, p.r0, tImp, p.ph, nCam, bOff, rng, keep);
  if (nRad > 0) o.rad = radTrack(sys.rad, th, p.r0, tImp, p.rph, nRad, rng, keep);
  const ca = o.cam && o.cam.tAlert != null ? o.cam.tAlert : null, ra = o.rad && o.rad.tAlert != null ? o.rad.tAlert : null;
  let t = null, src = null;
  if (sys.fusion === "or") { if (ca != null && (ra == null || ca <= ra)) { t = ca; src = "camera"; } else if (ra != null) { t = ra; src = "radar"; } }
  else if (sys.fusion === "and") { if (ca != null && ra != null) { t = Math.max(ca, ra); src = "camera + radar"; } }
  else if (sys.fusion === "cam") { t = ca; src = ca != null ? "camera" : null; }
  else { t = ra; src = ra != null ? "radar" : null; }
  if (t != null) {
    t += (FUSION_MS + sys.ctrlMs) / 1000;
    o.tAlert = t; o.src = src; o.warnS = tImp - t;
    o.cueErr = src === "radar" ? sys.rad.bearingErr : sys.cam ? sys.cam.bearingErr : 0;
  }
  const covered = nCam > 0 || nRad > 0;
  const anyConf = (o.cam && o.cam.tConf != null) || (o.rad && o.rad.tConf != null);
  const R = sys.resp;
  if (R.staticShield) {
    o.resp = geometry(sys, th, p, rng, 0, true, -Infinity, tImp, 0);
    o.outcome = !o.resp.hit ? "geometry" : !o.resp.stops ? "stop" : "protected";
    return o;
  }
  if (!covered) o.outcome = "uncovered";
  else if (o.tAlert == null) o.outcome = anyConf ? "late" : "undetected";
  else if (o.tAlert >= tImp) o.outcome = "late";
  else if (R.mode === "warn") o.outcome = o.warnS * 1000 >= sys.needMs ? "warned" : "short";
  else {
    const delta = angDiff(p.az, 0);
    let aimMs = 0, reach = true, off = delta;
    if (R.aim) {
      reach = delta <= R.aim.range / 2 + 1e-9;
      aimMs = R.aim.time(reach ? delta : R.aim.range / 2);
      off = reach ? gauss(rng) * Math.hypot(o.cueErr, R.posErr) : delta - R.aim.range / 2;
    }
    const tReady = o.tAlert + (R.drvMs + aimMs + (isFinite(R.deployMs) ? R.deployMs : 1e9)) / 1000;
    o.resp = geometry(sys, th, p, rng, off, reach, tReady, tImp, aimMs, o.cueErr);
    if (!reach) o.outcome = "reach";
    else if (!o.resp.inTime) o.outcome = "slow";
    else if (R.mode === "mech") o.outcome = "reached";
    else o.outcome = !o.resp.hit ? "geometry" : !o.resp.stops ? "stop" : "protected";
  }
  return o;
}
function geometry(sys, th, p, rng, offDeg, reach, tReady, tImp, aimMs, cueErr) {
  const R = sys.resp;
  const r = { aimMs, deployMs: R.deployMs, drvMs: R.drvMs, tReady, inTime: tReady <= tImp, reach, offDeg, hit: false, stops: false };
  if (!R.shield) return r;
  const s = R.standoff;
  const lateral = p.ax - s * Math.sin(offDeg * D2R);
  const elOff = R.axes === 2 && reach ? gauss(rng) * Math.hypot(cueErr || 0, R.posErr) : clamp(p.el, -80, 80);
  const vertical = p.ay + s * Math.tan(elOff * D2R);
  r.hit = Math.abs(offDeg) < 90 && Math.abs(lateral) <= R.shieldW / 2 && Math.abs(vertical) <= R.shieldH / 2;
  r.stops = (LEVEL_RANK[R.shield.level] ?? 0) >= (LEVEL_RANK[th.req] ?? 0);
  return r;
}

/* ------------------------------------------------------------------ Monte Carlo */
function drawBearing(kind, rng) {
  if (kind === "boresight") return -1 + rng() * 2;
  if (kind === "bench") return -5 + rng() * 10;
  if (kind === "front") return -60 + rng() * 120;
  if (kind === "flank") return (rng() < 0.5 ? -1 : 1) * (60 + rng() * 60);
  if (kind === "rear") return wrap180(120 + rng() * 120);
  return -180 + rng() * 360;
}
function drawRound(th, scen, rng) {
  return { r0: th.rmin + rng() * (th.rmax - th.rmin), az: drawBearing(scen.bearing, rng), el: th.elMin + rng() * (th.elMax - th.elMin),
    ph: rng(), rph: rng(), ax: (rng() * 2 - 1) * 0.17 * (scen.aimSpread || 1), ay: 0.04 + (rng() * 0.72 - 0.36) * (scen.aimSpread || 1) };
}
function runThreat(sys, th0, scen, N, seed) {
  const th = threatSI(th0), rng = mulberry32(seed >>> 0);
  const counts = Object.fromEntries(OUTCOMES.map(([k]) => [k, 0]));
  const warns = [], firstRange = [];
  let covered = 0, cued = 0, need = 0, ready = 0, prot = 0;
  for (let i = 0; i < N; i++) {
    const p = drawRound(th, scen, rng);
    const o = simRound(sys, th, p, rng, false);
    counts[o.outcome]++;
    if (o.nCam > 0 || o.nRad > 0) covered++;
    if (o.warnS != null && o.warnS > 0) { cued++; warns.push(o.warnS * 1000); if (o.warnS * 1000 >= scen.needMs) need++; }
    if (o.cam && o.cam.rConf != null) firstRange.push(o.cam.rConf);
    if (o.outcome === "reached" || o.outcome === "protected" || o.outcome === "geometry" || o.outcome === "stop") ready++;
    if (o.outcome === "protected") prot++;
  }
  warns.sort((a, b) => a - b); firstRange.sort((a, b) => a - b);
  const mode = sys.resp.staticShield ? "shield" : sys.resp.mode;
  const pNeed = need / N, pReady = ready / N, pProt = prot / N;
  return { id: th0.id, N, counts, warns, pCover: covered / N, pCue: cued / N, pNeed, pReady, pProt,
    pGoal: mode === "warn" ? pNeed : mode === "mech" ? pReady : pProt, mode,
    medWarn: quantile(warns, 0.5), p10Warn: quantile(warns, 0.1), p90Warn: quantile(warns, 0.9), medConfRange: quantile(firstRange, 0.5),
    tofMs: tAtDist((th.rmin + th.rmax) / 2, th.v0, th.lam) * 1000 };
}
function runScenario(sys, threats, scen, N, seed) {
  const out = []; let wSum = 0, goal = 0, needW = 0, readyW = 0, protW = 0;
  threats.forEach((th, i) => {
    const w = scen.threats && th.id in scen.threats ? +scen.threats[th.id] || 0 : 1;
    if (w <= 0) return;
    const r = runThreat(sys, th, scen, N, (seed || 1) + i * 7919);
    r.weight = w; out.push(r);
    wSum += w; goal += w * r.pGoal; needW += w * r.pNeed; readyW += w * r.pReady; protW += w * r.pProt;
  });
  return { per: out, goal: wSum ? goal / wSum : 0, need: wSum ? needW / wSum : 0, ready: wSum ? readyW / wSum : 0, prot: wSum ? protW / wSum : 0,
    mode: sys.resp.staticShield ? "shield" : sys.resp.mode };
}

/* Detection range where the per-frame Pd is 50% for one pod, ignoring smear (for display). */
function camRange50(cs, th0) {
  if (!cs) return null;
  const th = threatSI(th0);
  return rangeForSnr(cs, cs.contrast(th), th.dM, cs.k);
}
function radRange(rs, th0, v) { if (!rs) return null; const th = threatSI(th0); return rs.rdet(th.rcs, v == null ? th.v0 : v); }

return {
  VERSION, D2R, LEVEL_RANK, OUTCOMES, GRID, POD_MOUNTS, RADAR_RING, RESP_MOUNTS,
  mulberry32, erfc, Q, Phi, choose, clamp, angDiff, wrap180, quantile, gauss,
  threatSI, tAtDist, distAtT, velAtDist, sizeGain, rangeForSnr, dirVec, toLocal, bodyOccluders, rayHits, cellIndex, coverageShare,
  makeLibrary, derive, evaluate, simRound, runThreat, runScenario, drawRound, camRange50, radRange, fmtRate,
};
});
