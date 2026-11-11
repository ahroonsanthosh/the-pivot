/* ================================================================== 3D bench (three.js) */
const Scene = (() => {
  const vp = $("viewport");
  const stub = { rebuild() {}, play() {}, applyTheme() {}, toggleFov() { return true; }, toggleView() { return false; } };
  if (typeof THREE === "undefined" || !THREE.OrbitControls) {
    vp.insertAdjacentHTML("afterbegin", '<div class="vp-fallback">The 3D view needs three.js from cdn.jsdelivr.net, which did not load. Everything else on the page still works.</div>');
    return stub;
  }
  const D2R = Math.PI / 180;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
  catch (e) { vp.insertAdjacentHTML("afterbegin", '<div class="vp-fallback">WebGL is not available in this browser, so the 3D view is off. Everything else on the page still works.</div>'); return stub; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  vp.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.02, 4000);
  const HOME = { pos: [2.6, 2.0, 3.4], target: [0, 1.15, 0] };
  camera.position.set(...HOME.pos);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(...HOME.target); controls.enableDamping = true; controls.maxDistance = 800; controls.minDistance = 0.5; controls.update();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8); sun.position.set(3, 6, 4); scene.add(sun);

  const C = (n) => new THREE.Color(tok(n) || "#888888");
  const tracked = [];                       // [material, token] pairs recoloured on theme change
  const base = {};
  function mat(key, opts) {
    if (!opts && base[key]) return base[key];
    const m = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.05, color: C(key), ...(opts || {}) });
    tracked.push([m, key]); if (!opts) base[key] = m; return m;
  }
  function basic(key, opts) { const m = new THREE.MeshBasicMaterial({ color: C(key), ...(opts || {}) }); tracked.push([m, key]); return m; }
  function lineMat(key, opts, dashed) { const m = dashed ? new THREE.LineDashedMaterial({ color: C(key), ...(opts || {}) }) : new THREE.LineBasicMaterial({ color: C(key), ...(opts || {}) }); tracked.push([m, key]); return m; }

  const ground = new THREE.Mesh(new THREE.CircleGeometry(2000, 64), mat("--view-bg"));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  let grid = null;
  function buildGrid() {
    if (grid) scene.remove(grid);
    grid = new THREE.Group();
    const g1 = new THREE.GridHelper(40, 40, C("--line"), C("--line")); g1.material.transparent = true; g1.material.opacity = 0.7; grid.add(g1);
    const g2 = new THREE.GridHelper(400, 40, C("--line"), C("--line")); g2.material.transparent = true; g2.material.opacity = 0.4; grid.add(g2);
    grid.position.y = 0.001; scene.add(grid);
  }

  /* soldier */
  const soldier = new THREE.Group(); scene.add(soldier);
  const skin = mat("--body-skin"), kit = mat("--kit");
  const cap = (r, len, m) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), m);
  function addPart(mesh, x, y, z, info) { mesh.position.set(x, y, z); if (info) mesh.userData.info = info; soldier.add(mesh); return mesh; }
  [-0.1, 0.1].forEach((x) => { addPart(cap(0.07, 0.72, kit), x, 0.47, 0); addPart(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.26), skin), x, 0.035, 0.04); });
  addPart(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.22), kit), 0, 0.92, 0);
  const torso = cap(0.17, 0.32, skin); torso.scale.set(1.05, 1, 0.68); addPart(torso, 0, 1.22, 0);
  addPart(new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.44, 0.27), kit), 0, 1.24, 0, { name: "Plate carrier", spec: "Host for harness, radar and controller" });
  [-1, 1].forEach((s) => {
    const ua = cap(0.05, 0.26, kit); ua.position.set(s * 0.25, 1.33, 0.02); ua.rotation.z = s * 0.12; soldier.add(ua);
    const fa = cap(0.045, 0.24, skin); fa.position.set(s * 0.25, 1.03, 0.12); fa.rotation.x = -0.9; soldier.add(fa);
  });
  addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 14), skin), 0, 1.55, 0);
  addPart(new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 18), skin), 0, 1.64, 0.01);
  addPart(new THREE.Mesh(new THREE.SphereGeometry(0.135, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), kit), 0, 1.655, 0, { name: "Helmet", spec: "Pod mount option; raises neck load" });

  /* rebuilt groups */
  const hw = new THREE.Group(), fov = new THREE.Group(), rings = new THREE.Group(), trail = new THREE.Group();
  scene.add(hw, fov, rings, trail);
  let wedgeMats = [], radarMats = [], ledMat = null, sailPivot = null, sailPlate = null, showFov = true;
  const pickables = [];
  function clearGroup(g) { while (g.children.length) { const o = g.children.pop(); o.traverse((x) => { if (x.geometry) x.geometry.dispose(); }); } }
  function wedgeGeo(h, v, len) {
    const a = Math.tan(Math.min(h, 170) / 2 * D2R) * len, b = Math.tan(Math.min(v, 170) / 2 * D2R) * len;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, -a, -b, len, a, -b, len, a, b, len, -a, b, len], 3));
    g.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1, 1, 3, 2, 1, 4, 3]); g.computeVertexNormals(); return g;
  }
  function orient(o, az, tilt) { o.rotation.order = "YXZ"; o.rotation.y = az * D2R; o.rotation.x = -(tilt || 0) * D2R; }
  function pick(mesh, info) { mesh.userData.info = info; pickables.push(mesh); return mesh; }

  function rebuild() {
    if (!SYS) return;
    clearGroup(hw); clearGroup(fov); clearGroup(rings); pickables.length = 0; wedgeMats = []; radarMats = []; sailPivot = null; sailPlate = null;
    const sys = SYS, b = S.build, th = threatById(S.shot.threat);
    const camPart = LIB.byId[b.camera], lensPart = LIB.byId[b.lens];
    const r50 = sys.cam ? E.camRange50(sys.cam, th) : 0;
    const wedgeLen = Math.min(Math.max(r50, 0.6), 2.5);
    const ink = mat("--ink");
    sys.pods.forEach((p, i) => {
      const active = sys.cam && sys.cam.ok && i < sys.cam.active;
      const g = new THREE.Group(); g.position.set(...p.pos); orient(g, p.az, p.tilt);
      const bodyM = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.034, 0.032), active ? mat("--accent") : mat("--muted"));
      const lensM = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.015, 0.026, 18), ink); lensM.rotation.x = Math.PI / 2; lensM.position.z = 0.028;
      const info = { name: `Camera pod ${i + 1}${active ? "" : " (not streaming)"}`, spec: camPart ? `${camPart.name}, ${lensPart ? lensPart.hfov + "°" : ""} · ${sys.cam ? Math.round(sys.cam.fps) + " fps eff." : ""}` : "" };
      pick(bodyM, info); pick(lensM, info); g.add(bodyM, lensM); hw.add(g);
      if (active && sys.podFov) {
        const wm = basic("--sensor", { transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
        const w = new THREE.Mesh(wedgeGeo(sys.podFov.h, sys.podFov.v, wedgeLen), wm); w.position.set(...p.pos); orient(w, p.az, p.tilt); fov.add(w); wedgeMats.push(wm);
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(w.geometry), lineMat("--sensor", { transparent: true, opacity: 0.45 })); e.position.copy(w.position); e.rotation.copy(w.rotation); fov.add(e);
      }
      const pts = [new THREE.Vector3(p.pos[0] * 0.92, p.pos[1] - 0.02, p.pos[2] * 0.92), new THREE.Vector3(p.pos[0] * 0.6, (p.pos[1] + 1.3) / 2, -0.12), new THREE.Vector3(0, 1.3, -0.19)];
      hw.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.004, 6), ink));
    });
    if (sys.rad) {
      const rr = Math.min(Math.max(E.radRange(sys.rad, th) || 0, 0.4), 2.5);
      sys.radars.forEach((r, i) => {
        const m = pick(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.012), mat("--radar")), { name: `${sys.rad.part.name} ${i + 1}`, spec: `${sys.rad.part.freq} GHz · ±${sys.rad.part.fovAz}° · ${fmt(E.radRange(sys.rad, th), 2)} m on ${th.short}` });
        m.position.set(...r.pos); orient(m, r.az, 0); hw.add(m);
        const rm = basic("--radar", { transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
        const w = new THREE.Mesh(wedgeGeo(2 * sys.rad.part.fovAz, 2 * sys.rad.part.fovEl, rr), rm); w.position.set(...r.pos); orient(w, r.az, 0); fov.add(w); radarMats.push(rm);
      });
    }
    const comp = LIB.byId[b.compute];
    if (comp) { const m = pick(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.045), mat("--sensor")), { name: comp.name, spec: `${comp.power} W · ${fmt(comp.mass + (comp.enclosure || 0), 0)} g with enclosure` }); m.position.set(0, 1.32, -0.18); hw.add(m); }
    const bh = 0.04 + Math.min(b.battWh, 300) / 300 * 0.14;
    const bm = pick(new THREE.Mesh(new THREE.BoxGeometry(0.16, bh, 0.04), mat("--warn")), { name: `Battery ${b.battWh} Wh`, spec: `${fmt(sys.battKg * 1000, 0)} g · ${fmt(sys.runtimeH, 1)} h runtime` });
    bm.position.set(0, 1.24 - 0.06 - bh / 2, -0.18); hw.add(bm);
    const ctrl = LIB.byId[b.controller];
    if (ctrl && ctrl.mass > 0) {
      const t = pick(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.012), mat("--ok")), { name: ctrl.name, spec: "Status LED, haptic cue, event log" }); t.position.set(-0.12, 1.42, 0.14); hw.add(t);
    }
    ledMat = basic("--ok"); const led = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), ledMat); led.position.set(-0.12, 1.445, 0.15); hw.add(led);
    if (b.extraMass > 0) { const s = Math.cbrt(b.extraMass / 1500); const m = pick(new THREE.Mesh(new THREE.BoxGeometry(s * 2.2, s, s * 0.8), mat("--kit")), { name: "Other kit", spec: `${fmt(b.extraMass, 1)} kg placeholder` }); m.position.set(0, 1.0, -0.22); hw.add(m); }

    const R = sys.resp;
    if (R.mode !== "warn" || R.staticShield) {
      const mp = R.mount.pos;
      const baseM = pick(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.035, 20), mat("--resp")), { name: R.aim ? `Turret · ${R.aim.part.name}` : "Response mount", spec: R.aim ? `${fmt(R.aim.range, 0)}° travel · ${fmt(R.aim.speed, 0)}°/s` : "Fixed bearing" });
      baseM.position.set(...mp); hw.add(baseM);
      if (R.deployMode === "pneumatic") { const c = pick(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.05), mat("--resp")), { name: "Pneumatic set", spec: `${fmt(R.deployMs, 0)} ms to deploy` }); c.position.set(mp[0], mp[1] - 0.11, mp[2] + 0.02); hw.add(c); }
      if (R.shield) {
        sailPivot = new THREE.Group(); sailPivot.position.set(0, 1.32, 0); hw.add(sailPivot);
        sailPlate = pick(new THREE.Mesh(new THREE.BoxGeometry(R.shieldW, R.shieldH, 0.006), mat("--bad", { transparent: true, opacity: 0.85 })), { name: R.shield.name, spec: `${R.shieldW * 1000}×${R.shieldH * 1000} mm · ${fmt(R.shieldKg * 1000, 0)} g · stops ${(LEVEL_NAME[R.shield.level] || "").toLowerCase()}` });
        sailPivot.add(sailPlate); setSail(0, R.staticShield ? 1 : 0);
      }
    }
    const ring = (r, key, dashed) => {
      if (!(r > 0.05)) return;
      const pts = []; for (let i = 0; i <= 160; i++) { const a = (i / 160) * Math.PI * 2; pts.push(new THREE.Vector3(Math.sin(a) * r, 0.01, Math.cos(a) * r)); }
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(key, dashed ? { dashSize: r / 40, gapSize: r / 60 } : {}, dashed));
      if (dashed) l.computeLineDistances(); rings.add(l);
    };
    ring(r50, "--sensor", false);
    if (sys.rad) ring(E.radRange(sys.rad, th), "--radar", true);
    fov.visible = showFov;
    buildTrail();
  }
  function setSail(yawDeg, deployFrac) {
    if (!sailPivot || !sailPlate) return;
    const R = SYS.resp, f = Math.max(0, Math.min(1, deployFrac));
    sailPivot.rotation.y = yawDeg * D2R;
    sailPlate.position.set(0, 0, 0.24 + R.standoff * f);
    const s = 0.2 + 0.8 * f; sailPlate.scale.set(s, s, 1);
  }

  /* projectile and its path */
  const projMat = basic("--bad");
  const proj = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), projMat); proj.visible = false; scene.add(proj);
  const aimPoint = () => new THREE.Vector3(0.05, 1.32 + 0.05, 0);
  const dirV = (az, el) => new THREE.Vector3(Math.sin(az * D2R) * Math.cos(el * D2R), Math.sin(el * D2R), Math.cos(az * D2R) * Math.cos(el * D2R));
  function buildTrail() {
    clearGroup(trail);
    const th = threatById(S.shot.threat), d = dirV(S.shot.az, S.shot.el), aim = aimPoint();
    const far = aim.clone().add(d.clone().multiplyScalar(S.shot.r0));
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([far, aim]), lineMat("--bad", { dashSize: 0.4, gapSize: 0.3, transparent: true, opacity: 0.8 }, true));
    l.computeLineDistances(); trail.add(l);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.7, 10), mat("--bad")); post.position.set(far.x, 0.85, far.z); trail.add(post);
    const s = Math.max(th.d / 1000 * 6, 0.03); proj.scale.set(s, s, s * 3);
    placeProj(0);
  }
  function placeProj(t) {
    const th = E.threatSI(threatById(S.shot.threat));
    const r = Math.max(0, S.shot.r0 - E.distAtT(t, th.v0, th.lam));
    proj.position.copy(aimPoint().add(dirV(S.shot.az, S.shot.el).multiplyScalar(r))); proj.lookAt(aimPoint());
  }

  /* hover tooltip */
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), tip = $("tip");
  renderer.domElement.addEventListener("pointermove", (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(pickables.concat(soldier.children.filter((c) => c.userData.info)), false)[0];
    if (hit && hit.object.userData.info) {
      const inf = hit.object.userData.info; tip.innerHTML = `<b>${esc(inf.name)}</b><span>${esc(inf.spec)}</span>`; tip.hidden = false;
      tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 270) + "px"; tip.style.top = (e.clientY - r.top + 14) + "px";
    } else tip.hidden = true;
  });
  renderer.domElement.addEventListener("pointerleave", () => { tip.hidden = true; });
  function resize() { const w = vp.clientWidth, h = vp.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(vp);

  /* playback */
  let play = null;
  function setState(txt, cls) { const el = $("hudState"); el.className = "chip " + (cls || ""); el.innerHTML = `<i></i>${esc(txt)}`; }
  function playShot() {
    const o = SHOT; if (!o) return;
    const th = o.th;
    const detR = Math.max(E.camRange50(SYS.cam, th) || 0, SYS.rad ? E.radRange(SYS.rad, th) : 0, 6);
    let win = Math.max((1.4 * detR) / Math.max(o.vImp, 1), 0.012);
    if (o.tAlert != null) win = Math.max(win, (o.tImp - o.tAlert) * 1.25);
    const t0 = Math.max(0, o.tImp - win);
    play = { o, t0, t1: o.tImp, wall0: performance.now(), dur: 4500, last: t0, flash: 0, conf: false, alerted: false };
    proj.visible = true;
    wedgeMats.forEach((m) => (m.color = C("--sensor"))); if (ledMat) ledMat.color = C("--ok");
    setSail(0, SYS.resp.staticShield ? 1 : 0);
    setState("Tracking…", "warn");
    const view = Math.min(Math.max(detR, 6), 45);
    const d = dirV(S.shot.az + 70, 0).multiplyScalar(view * 0.9);
    camera.position.set(d.x, view * 0.45 + 1.5, d.z); controls.target.set(0, 1.1, 0);
  }
  function sailYaw(o) {
    const R = SYS.resp, az = o.p.az;
    if (!R.aim) return 0;
    if (o.resp && !o.resp.reach) return Math.sign(az) * R.aim.range / 2;
    return az - (o.resp ? o.resp.offDeg : 0);
  }
  function tick(now) {
    requestAnimationFrame(tick);
    controls.update();
    if (play) {
      const f = Math.min(1, (now - play.wall0) / play.dur);
      const t = play.t0 + (play.t1 - play.t0) * f, o = play.o;
      placeProj(t);
      const frames = o.cam ? o.cam.frames : [];
      if (frames.some((x) => x.hit && x.t > play.last && x.t <= t)) play.flash = 1;
      if (o.rad && o.rad.frames.some((x) => x.hit && x.t > play.last && x.t <= t)) radarMats.forEach((m) => (m.opacity = 0.35));
      const tConf = Math.min(o.cam && o.cam.tConf != null ? o.cam.tConf : Infinity, o.rad && o.rad.tConf != null ? o.rad.tConf : Infinity);
      if (!play.conf && t >= tConf) { play.conf = true; wedgeMats.forEach((m) => (m.color = C("--ok"))); }
      if (!play.alerted && o.tAlert != null && t >= o.tAlert) { play.alerted = true; if (ledMat) ledMat.color = C("--accent"); setState(`Alert · ${fmtMs((o.tImp - o.tAlert) * 1000)} to impact`, "ok"); }
      if (o.resp && o.tAlert != null && !SYS.resp.staticShield) {
        const tA = o.tAlert + o.resp.drvMs / 1000, tAim = tA + o.resp.aimMs / 1000, tDep = tAim + (Number.isFinite(o.resp.deployMs) ? o.resp.deployMs : 1e9) / 1000;
        const fa = Math.max(0, Math.min(1, (t - tA) / Math.max(tAim - tA, 1e-9)));
        const fd = Math.max(0, Math.min(1, (t - tAim) / Math.max(tDep - tAim, 1e-9)));
        setSail(sailYaw(o) * fa, t >= tAim ? fd : 0);
      }
      play.last = t;
      if (f >= 1) {
        const label = OUT[o.outcome] ? OUT[o.outcome].label : o.outcome;
        const good = ["protected", "reached", "warned"].includes(o.outcome);
        setState(label, good ? "ok" : "bad");
        play = null;
      }
    }
    const fl = play ? play.flash : 0;
    wedgeMats.forEach((m) => (m.opacity = 0.1 + 0.3 * fl));
    if (play) play.flash *= 0.8;
    radarMats.forEach((m) => { if (m.opacity > 0.08) m.opacity = Math.max(0.08, m.opacity * 0.93); });
    renderer.render(scene, camera);
  }
  function applyTheme() {
    scene.background = C("--view-bg");
    tracked.forEach(([m, k]) => (m.color = C(k)));
    buildGrid(); rebuild();
  }
  function toggleFov() { showFov = !showFov; fov.visible = showFov; return showFov; }
  let top = false;
  function toggleView() {
    top = !top;
    if (top) { camera.position.set(0.01, 14, 0.01); controls.target.set(0, 0, 0); }
    else { camera.position.set(...HOME.pos); controls.target.set(...HOME.target); }
    return top;
  }
  resize(); requestAnimationFrame(tick);
  return { rebuild, play: playShot, applyTheme, toggleFov, toggleView, buildTrail };
})();
