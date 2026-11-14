// Physics checks for the flash-sim core. Run: node --test flash-sim/test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');

const D = C.DEG;
const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b), 1e-300), `${msg}: ${a} vs ${b}`);
function runGen(g) { let r; while (!(r = g.next()).done) { /* step */ } return r.value; }

test('Planck: full-spectrum radiance equals sigma T^4 / pi', () => {
  const T = 1000;
  let L = 0;
  const n = 300, a = 0.2e-6, b = 2000e-6;
  for (let i = 0; i < n; i++) L += C.planckBandRadiance(T, a * Math.pow(b / a, i / n), a * Math.pow(b / a, (i + 1) / n));
  close(L, 5.670374e-8 * T ** 4 / Math.PI, 1e-4, 'Stefan-Boltzmann');
  close(C.bandRadianceToTemperature(C.planckBandRadiance(1875)), 1875, 1e-4, 'inverse');
});

test('H(tau): series and closed form agree at the switch point', () => {
  const t = 0.02;
  const closed = 0.5 / t - (1 - Math.exp(-t) * (1 + t)) / t ** 3;
  close(C.Hfun(t - 1e-12), closed, 1e-9, 'continuity');
  close(C.Hfun(0), 1 / 3, 1e-12, 'thin limit');
});

test('Cloud intensity: thin is isotropic, thick follows projected area', () => {
  const p = C.defaultParams();
  p.flash.opacity = 1e-6;
  close(C.plumeIntensity(p, 0), C.plumeIntensity(p, 90 * D), 1e-5, 'thin');
  p.flash.opacity = 200;
  close(C.plumeIntensity(p, 0) / C.plumeIntensity(p, 90 * D), p.flash.width / p.flash.length, 2e-2, 'thick');
  const q = C.defaultParams();
  close(C.plumeIntensity(q, 90 * D), q.flash.peakSide, 1e-12, 'side-on calibration');
});

test('Cloud intensity equals the integral of its radiance map', () => {
  const p = C.defaultParams();
  for (const a of [0, 20, 90]) {
    const g = C.plumeGeom(p.flash, a * D);
    const n = 1200, spanU = 2 * g.ap, spanV = 2 * g.b;
    let s = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n / 2; j++) {
      const u = g.uc - g.ap + (i + 0.5) / n * spanU, v = -g.b + (j + 0.5) / (n / 2) * spanV;
      s += C.plumeRadiance(p, a * D, u, v, g);
    }
    s *= (spanU / n) * (spanV / (n / 2));
    close(s, C.plumeIntensity(p, a * D), 2e-3, `angle ${a}`);
  }
});

test('Default opacity reproduces the measured front/side ratio (Kastek: 56.82/68.32)', () => {
  const p = C.defaultParams();
  const r = C.plumeIntensity(p, 0) / C.plumeIntensity(p, 90 * D);
  close(r, 56.82 / 68.32, 0.03, 'front/side');
});

test('Barrel glow geometry', () => {
  const p = C.defaultParams();
  const cut = C.glowCutoffDeg(p.glow);
  close(cut, Math.atan(7.62 / 500) / D, 1e-12, 'cutoff');
  assert.equal(C.boreFraction(p.glow, 0), 1);
  assert.equal(C.boreFraction(p.glow, cut * 1.0001 * D), 0);
  // closed form vs strip integral (column model reduces to the edge model when counting only full columns)
  const r = p.glow.bore / 2, th = 0.4 * D, s = p.glow.barrel * Math.tan(th);
  const lens = 2 * r * r * Math.acos(s / (2 * r)) - (s / 2) * Math.sqrt(4 * r * r - s * s);
  close(C.boreFraction(p.glow, th), lens / (Math.PI * r * r) * Math.cos(th), 1e-12, 'lens area');
  const col = Object.assign({}, p.glow, { model: 'column' });
  for (const a of [0.1, 0.5, 2, 10]) assert.ok(C.boreFraction(col, a * D) >= C.boreFraction(p.glow, a * D));
  // path through the cloud: full length dead-on, none side-on
  close(C.glowCloudPath(p.flash, 0), p.flash.length, 1e-12, 'path 0');
  assert.ok(C.glowCloudPath(p.flash, 90 * D) < 1e-12);
  close(C.glowCloudTransmission(p, 0), Math.exp(-p.flash.opacity * p.flash.length / p.flash.width), 1e-12, 'transmission');
});

test('Suppressor scales flash and glow as configured', () => {
  const p = C.defaultParams();
  const I0 = C.plumeIntensity(p, 0), G0 = C.glowIntensity(p, 0);
  p.suppressor.on = true;
  close(C.plumeIntensity(p, 0), I0 / 10, 1e-12, 'flash /10');
  close(C.glowIntensity(p, 0), G0, 1e-12, 'glow unchanged');
  p.suppressor.glowMode = 'dimmed'; close(C.glowIntensity(p, 0), G0 / 10, 1e-12, 'glow dimmed');
  p.suppressor.glowMode = 'hidden'; assert.equal(C.glowIntensity(p, 0), 0);
});

test('Pulse shapes: cumulative integrals match numeric integration', () => {
  const p = C.defaultParams();
  for (const pulse of [C.plumePulse(p.flash), C.glowPulse(p.glow)]) {
    let s = 0; const dt = 1e-7;
    for (let t = 0; t < 0.03; t += dt) s += pulse.g(t + dt / 2) * dt;
    close(s, pulse.G(0.03), 1e-5, 'integral');
    close(pulse.G(1), pulse.energy, 1e-6, 'energy');
  }
  const pp = C.plumePulse(p.flash);
  close(pp.g(p.flash.rise), 1, 1e-12, 'peak');
  close(pp.g(p.flash.duration), 0.1, 1e-9, '10% at duration');
});

test('Rendering conserves energy (minus a small PSF halo loss at the ROI edge)', () => {
  const p = C.defaultParams();
  for (const s of C.defaultSensors().filter(x => x.nx > 1)) {
    for (const R of [50, 300, 800]) {
      const ctx = C.makeContext(p, s, R);
      for (const a of [0, 20, 90]) {
        const sp = C.renderSpatial(p, s, ctx.sd, R, a * D, 0.7, 0.2, -0.3, ctx.h);
        const sumP = sp.plume.reduce((x, y) => x + y, 0), sumG = sp.glow.reduce((x, y) => x + y, 0);
        assert.ok(sumP > 0.965 && sumP <= 1 + 1e-9, `${s.id} ${R} ${a} plume ${sumP}`);
        assert.ok(sumG > 0.965 && sumG <= 1 + 1e-9, `${s.id} ${R} glow ${sumG}`);
      }
    }
  }
});

test('Rendering is continuous in angle (no resampling artefacts)', () => {
  const p = C.defaultParams();
  p.glow.on = false;
  for (const s of C.defaultSensors().filter(x => x.nx > 1)) {
    const ctx = C.makeContext(p, s, 100);
    const ref = C.bestCaseReference(ctx);
    const d = C.bestCaseDprime(ctx, 1e-7 * D, ref.mu0);
    assert.ok(d < 1e-3, `${s.id}: d' for a 1e-7 degree change = ${d}`);
  }
});

test('Sensor radiometry: background fill and NETD are realistic', () => {
  const p = C.defaultParams();
  const [single, std, wide, fast] = C.defaultSensors().map(s => C.sensorDerived(s, p.atmosphere));
  assert.ok(std.wellFill > 0.3 && std.wellFill < 0.6, 'standard camera background fill');
  assert.ok(std.netd > 0.010 && std.netd < 0.025, `standard NETD ${std.netd}`);
  assert.ok(fast.netd > 0.010 && fast.netd < 0.030, `fast NETD ${fast.netd}`);
  close(wide.D * 3, std.D, 1e-9, 'wide lens is 3x smaller');
  close(single.nep, Math.sqrt(0.04 * 5000) / 2e9, 1e-9, 'single detector NEP from D*');
});

test('Best case: favourable geometry gives monotone d prime with angle when glow is off', () => {
  const p = C.defaultParams();
  p.glow.on = false;
  const s = C.defaultSensors()[1];
  s.tint = 2e-5;                      // avoid saturation for this check
  const ctx = C.makeContext(p, s, 50);
  const ref = C.bestCaseReference(ctx);
  let prev = 0;
  for (const a of [1, 5, 20, 45, 90]) {
    const d = C.bestCaseDprime(ctx, a * D, ref.mu0);
    assert.ok(d >= prev, `d' falls at ${a}`);
    prev = d;
  }
});

test('Realistic classifier: same angle on both sides gives chance accuracy', () => {
  const p = C.defaultParams();
  const s = C.defaultSensors()[1];
  const ctx = C.makeContext(p, s, 200);
  const kind = C.featureKind(ctx);
  const buf = C.makeBuf(ctx);
  const a = runGen(C.collectShots(ctx, 0, 0, 200, 1, 1, buf, kind)).F;
  const b = runGen(C.collectShots(ctx, 0, 5, 200, 1, 1, buf, kind)).F;
  const pc = C.qdaPc(a, b);
  assert.ok(Math.abs(pc - 0.5) < 0.08, `chance accuracy expected, got ${pc}`);
});

test('Realistic classifier: an obvious difference is detected when nothing varies shot to shot', () => {
  const p = C.defaultParams();
  p.glow.peak = 100;                  // glow comparable to the whole flash
  p.glow.bulletBlock = false;         // dead-on sees the glow, 5 deg does not
  Object.assign(p.study, { flashVar: 0, glowVar: 0, shapeVar: 0, timeVar: 0 });
  const s = C.defaultSensors()[3];
  const ctx = C.makeContext(p, s, 300);
  const kind = C.featureKind(ctx);
  const buf = C.makeBuf(ctx);
  const a = runGen(C.collectShots(ctx, 0, 0, 200, 2, 1, buf, kind)).F;
  const b = runGen(C.collectShots(ctx, 5, 1, 200, 2, 1, buf, kind)).F;
  assert.ok(C.qdaPc(a, b) > 0.95);
});

test('Ballistics: drag constant matches the standard G7 formulation and integration converges', () => {
  // Standard point-mass form: a [ft/s^2] = 2.08551e-4 * Cd * v^2 / BC at 1.225 kg/m^3
  const kSI = 1.2250 * Math.PI / (8 * 703.0696);
  close(kSI * 0.3048, 2.08551e-4, 1e-4, 'drag constant');
  const ammo = C.AMMO.M80;
  const t1 = C.interpAtX(C.trajectory(ammo, 0, 805), 800);
  assert.ok(t1.t > 1.0 && t1.t < 1.6, `TOF ${t1.t}`);
  // vacuum limit
  const vac = C.interpAtX(C.trajectory({ mv: 800, bc7: 1e9 }, 0, 805), 800);
  close(vac.t, 1.0, 1e-4, 'vacuum TOF');
  close(-vac.y, 0.5 * 9.80665 * 1.0, 1e-3, 'vacuum drop');
  const se = C.superelevation(ammo, 800);
  const hit = C.interpAtX(C.trajectory(ammo, se, 805), 800);
  assert.ok(Math.abs(hit.y) < 1e-3, 'superelevation hits the target');
});

test('Bullet blocking: geometry and timing', () => {
  const p = C.defaultParams();
  // no shadow reproduces the plain bore fraction, both glow models
  for (const model of ['edge', 'column']) {
    const gl = Object.assign({}, p.glow, { model });
    for (const a of [0, 0.2, 0.5, 0.8, 2]) close(C.boreVisible(gl, a * D, 0, 0) + 1e-15, C.boreFraction(gl, a * D) + 1e-15, 1e-3, `${model} ${a}`);
  }
  // the bullet (7.82 mm) covers the 7.62 mm bore completely as it leaves
  assert.equal(C.blockedFraction(p, 0.3 * D, 300, 0), 0);
  // dead-on: only gravity moves it off the line of sight; clears when drop ~ bore radius + bullet radius
  const t0 = C.clearTime(p, 0, 300, 0.99);
  const est0 = Math.sqrt(2 * (p.glow.bore / 2 + p.glow.bulletDiameter / 2) / 9.80665);
  close(t0, est0, 0.06, 'dead-on clear time');
  // 0.3 deg: shadow edge passes the visible part's edge when x tan(th) ~ rb + r - barrel tan(th)
  const th = 0.3 * D, need = p.glow.bulletDiameter / 2 + p.glow.bore / 2 - p.glow.barrel * Math.tan(th);
  const est = need / Math.tan(th) / C.AMMO.M80.mv;
  const t3 = C.clearTime(p, th, 300, 0.99);
  assert.ok(t3 < est * 1.08 && t3 > est * 0.85, `0.3 deg clear ${t3} vs estimate ${est}`);
  // clearing gets faster with angle, and blocking never adds light
  let prev = Infinity;
  for (const a of [0.05, 0.1, 0.2, 0.4, 0.7]) { const t = C.clearTime(p, a * D, 300, 0.99); assert.ok(t < prev); prev = t; }
  const bt = C.blockTable(p, 0.2 * D, 300, 0.02);
  const e = C.glowPulseBlocked(p.glow, 1, bt).G(10);
  assert.ok(e > 0 && e < p.glow.decay);
});

test('Cloud gap: glow still crosses the whole cloud on the axis', () => {
  const p = C.defaultParams();
  for (const gap of [0, 0.1, 0.3]) close(C.glowCloudPath(Object.assign({}, p.flash, { gap }), 0), p.flash.length, 1e-9, 'gap ' + gap);
  const g = C.plumeGeom(Object.assign({}, p.flash, { gap: 0.2 }), 90 * D);
  close(g.uc, 0.35 + 0.2, 1e-12, 'cloud centre moves downrange');
});

test('With bullet blocking, the glow separates near-axis angles from dead-on, not 5 deg', () => {
  const p = C.defaultParams();
  p.glow.peak = 100;
  Object.assign(p.study, { flashVar: 0, glowVar: 0, shapeVar: 0, timeVar: 0 });
  const s = C.defaultSensors()[3];
  const ctx = C.makeContext(p, s, 300);
  const kind = C.featureKind(ctx);
  const buf = C.makeBuf(ctx);
  const a = runGen(C.collectShots(ctx, 0, 0, 200, 4, 1, buf, kind)).F;
  const near = runGen(C.collectShots(ctx, 0.4, 1, 200, 4, 1, buf, kind)).F;
  const far = runGen(C.collectShots(ctx, 5, 2, 200, 4, 1, buf, kind)).F;
  const pNear = C.qdaPc(a, near), pFar = C.qdaPc(a, far);
  assert.ok(pNear > 0.9, `0.4 deg vs dead-on: ${pNear}`);
  assert.ok(pFar < pNear, `5 deg (${pFar}) should be harder than 0.4 deg (${pNear})`);
});
