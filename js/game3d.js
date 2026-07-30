// js/game3d.js
// RacingGame3D: a REAL 3D night-city racer built on Three.js.
// Same public interface as the old 2D RacingGame: new RacingGame3D(canvas, tracker),
// .start(opts), .stop(). Reads tracker.steering / tracker.detected / tracker.calibrate.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ---- world tunables (metres) ----------------------------------------------
const VIEW_W = 960, VIEW_H = 540;
const ROAD_HALF = 8.5;          // half road width
const LANE_SPAN = ROAD_HALF * 0.82;
const SPAWN_Z = -230;           // where obstacles/buildings appear ahead
const PLAYER_MAX_X = 1.06;
const WZ = 0.05;                // game-speed unit -> metres/sec
const BLD_SPACING = 22;         // z-gap between buildings (> max depth → no overlap / z-fighting)

const START_LIVES = 3;
const INVULN_TIME = 1.6;
const NO_HANDS_GRACE = 0.4;
const SIZE = 0.9;               // player + obstacles scaled to 90% (exactly 10% smaller)

// Lane grid used by the guaranteed-gap spawner.
const LANES = 5;
const laneX = (i) => -LANE_SPAN + (i * 2 * LANE_SPAN) / (LANES - 1);

// startSpeed/maxSpeed/accel: speed curve. rowGap: metres between obstacle rows.
// density: how many lanes a row blocks (the guaranteed-free path lane is never one).
const DIFFICULTY = {
  easy:   { key: 'easy',   label: '쉬움',   startSpeed: 150, maxSpeed: 520,  accel: 5,  rowGap: 60, density: 1, shift: 0.45 },
  medium: { key: 'medium', label: '중간',   startSpeed: 220, maxSpeed: 880,  accel: 9,  rowGap: 56, density: 2, shift: 0.6 },
  hard:   { key: 'hard',   label: '어려움', startSpeed: 340, maxSpeed: 1150, accel: 14, rowGap: 44, density: 3, shift: 0.85 },
};

const CAR_TINTS = [0xff4455, 0x44aaff, 0xffcc44, 0x66ff88, 0xffffff, 0xaa66ff];
const TRAFFIC_TINTS = CAR_TINTS.map((c) => new THREE.Color(c)); // multiply onto traffic cars
const BARREL_COLORS = [0xffc02a, 0x2a6cff, 0xd83a2a, 0x3aa84a];
const WIN_WARM = ['#ffcf95', '#ffab5e', '#fff0cc', '#ffd27a'];
const WIN_COOL = ['#66e0ff', '#ff6ad5', '#b088ff', '#88ffcc', '#5ea8ff'];

// Procedural window-facade texture sized to a building. night=neon lit windows;
// day=concrete/glass with dark daytime windows (lit by the scene, not emissive).
const DAY_WALLS = ['#9aa0a8', '#b7b2a6', '#8f9aa6', '#a8a29a'];
function makeWindowsTex(cols, rows, neon, day) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  if (day) {
    g.fillStyle = DAY_WALLS[Math.floor(Math.random() * DAY_WALLS.length)];
    g.fillRect(0, 0, 256, 512);
  } else {
    g.fillStyle = '#0b0d16'; g.fillRect(0, 0, 256, 512);
  }
  const cw = 256 / cols, rh = 512 / rows;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      if (day) {
        // dark tinted-glass windows, occasional bright reflection
        const refl = Math.random() < 0.12;
        g.fillStyle = refl ? '#cfe0ee' : '#3b4652';
        g.globalAlpha = refl ? 0.8 : (0.7 + Math.random() * 0.25);
      } else {
        const lit = Math.random() < 0.42;
        if (lit) { g.fillStyle = neon[Math.floor(Math.random() * neon.length)]; g.globalAlpha = 0.55 + Math.random() * 0.45; }
        else { g.fillStyle = '#151a2b'; g.globalAlpha = 1; }
      }
      g.fillRect(col * cw + cw * 0.18, r * rh + rh * 0.18, cw * 0.64, rh * 0.6);
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- selectable vehicles (each a real 3D GLB) with performance profiles ----
export const VEHICLES = [
  { id: 'sports',  name: '스포츠카',  glb: 'assets/car-player.glb',  scale: 4.6, speed: 1.0,  accel: 1.0,  handling: 1.0 },
  { id: 'super',   name: '슈퍼카',    glb: 'assets/car-super.glb',   scale: 4.5, speed: 1.18, accel: 1.2,  handling: 1.25 },
  { id: 'suv',     name: 'SUV',       glb: 'assets/car-suv3d.glb',   scale: 5.4, speed: 0.86, accel: 0.85, handling: 0.78 },
  { id: 'classic', name: '클래식',    glb: 'assets/car-classic.glb', scale: 4.9, speed: 0.98, accel: 0.92, handling: 0.9 },
];

// ---- selectable maps (real world cities, per-city time of day) --------------
export const MAPS = [
  {
    id: 'newyork', name: '뉴욕', time: '낮', mode: 'day',
    buildings: ['assets/ny-bld-1.png', 'assets/ny-bld-2.png', 'assets/ny-bld-3.png', 'assets/ny-bld-4.png', 'assets/ny-bld-5.png'],
    bg: 0x9fc2ea, fog: 0xbcd4ea, fogNear: 95, fogFar: 380,
    hemiSky: 0xcfe2f5, hemiGround: 0x70747c, hemiInt: 1.25,
    sun: 0xfff2df, sunInt: 1.7, sunPos: [-30, 55, -15],
    glow: null, headlights: false, rain: false, exposure: 1.15, landmark: null,
    road: { base: '#3d4046', edge: 'rgba(245,245,245,0.85)', center: 'rgba(245,222,120,0.9)', divider: 'rgba(235,235,240,0.4)' },
  },
  {
    id: 'paris', name: '파리', time: '노을', mode: 'day',
    buildings: ['assets/paris-bld-1.png', 'assets/paris-bld-2.png', 'assets/paris-bld-3.png', 'assets/paris-bld-4.png', 'assets/paris-bld-5.png'],
    bg: 0xe9a86a, fog: 0xf0c48a, fogNear: 90, fogFar: 360,
    hemiSky: 0xf6d0a0, hemiGround: 0x5a5048, hemiInt: 1.1,
    sun: 0xffd39a, sunInt: 1.55, sunPos: [-45, 22, -20],
    glow: null, headlights: false, rain: false, exposure: 1.2,
    landmark: { img: 'assets/lm-paris.png', aspect: 0.771, height: 165, x: -18 },
    road: { base: '#41403c', edge: 'rgba(245,245,240,0.8)', center: 'rgba(245,215,120,0.9)', divider: 'rgba(235,232,225,0.4)' },
  },
  {
    id: 'tokyo', name: '도쿄', time: '야간', mode: 'neon',
    buildings: ['assets/tokyo-bld-1.png', 'assets/tokyo-bld-2.png', 'assets/tokyo-bld-3.png', 'assets/tokyo-bld-4.png', 'assets/tokyo-bld-5.png'],
    bg: 0x0a0a14, fog: 0x14121c, fogNear: 65, fogFar: 290,
    hemiSky: 0x3a3550, hemiGround: 0x0a0a12, hemiInt: 0.85,
    sun: 0x8890c0, sunInt: 0.7, sunPos: [-8, 14, -6],
    glow: { color: 0xff7a3d, pos: [0, 10, -160], intensity: 55, dist: 280 },
    headlights: true, rain: true, exposure: 1.8,
    landmark: { img: 'assets/lm-tokyo.png', aspect: 0.574, height: 180, x: -18 },
    road: { base: '#17181e', edge: 'rgba(230,230,240,0.7)', center: 'rgba(240,222,150,0.85)', divider: 'rgba(220,220,230,0.3)' },
  },
  {
    id: 'seoul', name: '서울', time: '저녁', mode: 'neon',
    buildings: ['assets/seoul-bld-1.png', 'assets/seoul-bld-2.png', 'assets/seoul-bld-3.png', 'assets/seoul-bld-4.png', 'assets/seoul-bld-5.png'],
    bg: 0x2a3a63, fog: 0x33406a, fogNear: 80, fogFar: 330,
    hemiSky: 0x6a7ab0, hemiGround: 0x181b26, hemiInt: 1.15,
    sun: 0xb0bce0, sunInt: 1.0, sunPos: [-20, 26, -14],
    glow: { color: 0xffb070, pos: [0, 10, -180], intensity: 35, dist: 280 },
    headlights: true, rain: false, exposure: 1.6,
    landmark: { img: 'assets/lm-seoul.png', aspect: 0.269, height: 200, x: -18 },
    road: { base: '#1c2030', edge: 'rgba(230,232,240,0.7)', center: 'rgba(240,222,150,0.85)', divider: 'rgba(220,222,235,0.32)' },
  },
  {
    id: 'neon', name: '네온 시티', time: '밤', mode: 'neon',
    buildings: ['assets/bld-glass.png', 'assets/bld-apt.png', 'assets/bld-billboard.png', 'assets/bld-industrial.png'],
    bg: 0x070912, fog: 0x121627, fogNear: 70, fogFar: 300,
    hemiSky: 0x445577, hemiGround: 0x0a0c12, hemiInt: 0.9,
    sun: 0xaabbff, sunInt: 0.8, sunPos: [-8, 12, -6],
    glow: { color: 0xff9a4d, pos: [0, 8, -180], intensity: 60, dist: 260 },
    headlights: true, rain: true, exposure: 1.85, landmark: null,
    road: { base: '#1a1c22', edge: 'rgba(230,230,240,0.7)', center: 'rgba(240,222,150,0.85)', divider: 'rgba(220,220,230,0.3)' },
  },
];

const loader = new GLTFLoader();
function loadGLB(url) {
  return new Promise((res) => loader.load(url, (g) => res(g.scene), undefined, () => res(null)));
}
function loadTex(url) {
  const t = new THREE.TextureLoader().load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Soft radial "contact shadow" blob placed under a car (grounds it on the road).
let _blobTex = null;
function blobShadowTex() {
  if (_blobTex) return _blobTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 3, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.6)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  _blobTex = new THREE.CanvasTexture(c);
  return _blobTex;
}

// Build a tangent-space normal map from a grayscale height canvas (Sobel).
function normalFromHeight(heightCanvas, strength) {
  const w = heightCanvas.width, h = heightCanvas.height;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const d = img.data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x - 1, y) - H(x + 1, y)) * strength;
      const dy = (H(x, y - 1) - H(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      d[i] = (dx / len * 0.5 + 0.5) * 255;
      d[i + 1] = (dy / len * 0.5 + 0.5) * 255;
      d[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class RacingGame3D {
  constructor(canvas, tracker) {
    this.canvas = canvas;
    this.tracker = tracker || { steering: 0, detected: false, tiltDeg: 0 };

    this.hudScore = document.getElementById('hud-score');
    this.hudLives = document.getElementById('hud-lives');
    this.hudSpeed = document.getElementById('hud-speed');
    this.gameoverScreen = document.getElementById('gameover-screen');
    this.finalScore = document.getElementById('final-score');
    this.cdEl = document.getElementById('countdown3d');
    this.pauseEl = document.getElementById('pause3d');

    // ---- renderer / scene / camera ----
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(VIEW_W, VIEW_H, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.85;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;

    // Neutral studio environment → realistic reflections on car paint & glass.
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = this.envMap;
    pmrem.dispose();

    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
    const camera = new THREE.PerspectiveCamera(58, VIEW_W / VIEW_H, 0.6, 600);
    camera.position.set(0, 3.3, 8.5);
    camera.lookAt(0, 0.9, -18);
    this.camera = camera;

    this._buildRainSystem();
    this.mapObjs = [];        // per-map lights/road (rebuilt by _applyMap)
    this.buildings = [];
    this.obstacles = [];
    this.currentMapId = null;
    this.currentVehicleId = null;
    this.trafficModels = [];  // other vehicles used as traffic (never the player's pick)
    this.trafficVehicleId = null;
    this.bldTex = [];
    this.buildingDay = false;
    this.landmark = null;
    this.view = '3rd';        // '3rd' chase cam | '1st' cockpit

    // player car placeholder group (GLB added by _loadVehicle)
    this.carGroup = new THREE.Group();
    scene.add(this.carGroup);
    // headlights (toggled per map)
    const hlL = new THREE.SpotLight(0xeaf0ff, 40, 90, 0.5, 0.4, 1.5);
    hlL.position.set(-0.7, 0.7, -1.6); hlL.target.position.set(-1.2, 0.2, -30);
    const hlR = hlL.clone(); hlR.position.x = 0.7; hlR.target.position.x = 1.2;
    this.headL = hlL; this.headR = hlR;
    this.carGroup.add(hlL, hlL.target, hlR, hlR.target);

    this._loop = this._loop.bind(this);
    this.diff = DIFFICULTY.medium;
    this.handlingMult = 1;
    this._resetState();
  }

  // Rebuild the whole environment (lights, sky, fog, road) for a city map.
  _applyMap(map) {
    if (this.currentMapId === map.id) return;
    this.currentMapId = map.id;
    for (const o of this.mapObjs) {
      this.scene.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) { const mm = Array.isArray(o.material) ? o.material : [o.material]; for (const m of mm) { if (m.map) m.map.dispose(); if (m.normalMap) m.normalMap.dispose(); m.dispose(); } }
    }
    this.mapObjs = [];

    this.scene.background = new THREE.Color(map.bg);
    this.scene.fog = new THREE.Fog(map.fog, map.fogNear, map.fogFar);
    this.renderer.toneMappingExposure = map.exposure;

    const hemi = new THREE.HemisphereLight(map.hemiSky, map.hemiGround, map.hemiInt);
    this.scene.add(hemi); this.mapObjs.push(hemi);
    const sun = new THREE.DirectionalLight(map.sun, map.sunInt);
    sun.position.set(map.sunPos[0], map.sunPos[1], map.sunPos[2]);
    this.scene.add(sun); this.mapObjs.push(sun);
    if (map.glow) {
      const glow = new THREE.PointLight(map.glow.color, map.glow.intensity, map.glow.dist, 2);
      glow.position.set(map.glow.pos[0], map.glow.pos[1], map.glow.pos[2]);
      this.scene.add(glow); this.mapObjs.push(glow);
    }

    this.buildingDay = map.mode === 'day';
    this._buildRoad(map.road);
    this.headL.visible = this.headR.visible = !!map.headlights;
    if (this.rain) this.rain.visible = !!map.rain;

    // load this city's building photo textures
    this.bldTex = map.buildings.map((u) => { const t = loadTex(u); t.anisotropy = this.maxAniso; return t; });

    // skyline landmark billboard (Eiffel / Tokyo Tower / N Seoul Tower ...).
    // Anchored far down the avenue; unlit + fog-free so it reads as a crisp icon.
    // (was disposed with mapObjs above; recreate for the new city)
    this.landmark = null;
    if (map.landmark) {
      const lm = map.landmark;
      const lt = loadTex(lm.img); lt.anisotropy = this.maxAniso;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(lm.height * lm.aspect, lm.height),
        new THREE.MeshBasicMaterial({ map: lt, transparent: true, depthWrite: false, fog: false })
      );
      plane.position.set(lm.x, lm.height / 2, -300);
      plane.renderOrder = -1;
      this.scene.add(plane); this.mapObjs.push(plane);
      this.landmark = plane;
    }

    // clear any existing buildings so the new city repopulates
    for (const b of this.buildings) this.scene.remove(b.node);
    this.buildings = [];
  }

  // Load the selected vehicle GLB into the car group (replaces the previous one).
  _loadVehicle(v) {
    if (this.currentVehicleId === v.id) return;
    this.currentVehicleId = v.id;
    if (this.carModel) { this.carGroup.remove(this.carModel); this.carModel = null; }
    loadGLB(v.glb).then((car) => {
      if (!car || this.currentVehicleId !== v.id) return;
      const box = new THREE.Box3().setFromObject(car);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      car.position.sub(center);
      car.scale.setScalar((v.scale * SIZE) / Math.max(size.x, size.z));
      const box2 = new THREE.Box3().setFromObject(car);
      car.position.y -= box2.min.y;
      car.rotation.y = -Math.PI / 2; // rear faces the chase camera
      car.visible = this.view !== '1st'; // hide own body in cockpit view
      // stronger environment reflections on paint/glass → looks like a real car
      car.traverse((o) => {
        if (o.isMesh && o.material) {
          const mm = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mm) { if ('envMapIntensity' in m) { m.envMapIntensity = 1.35; m.needsUpdate = true; } }
        }
      });
      this.carModel = car;
      this.carGroup.add(car);

      // contact shadow sized to the car's footprint
      const fp = new THREE.Box3().setFromObject(car).getSize(new THREE.Vector3());
      if (this.carShadow) { this.carGroup.remove(this.carShadow); this.carShadow.geometry.dispose(); }
      const sh = new THREE.Mesh(
        new THREE.PlaneGeometry(fp.x * 1.45, fp.z * 1.7),
        new THREE.MeshBasicMaterial({ map: blobShadowTex(), transparent: true, depthWrite: false, opacity: 0.65 })
      );
      sh.rotation.x = -Math.PI / 2;
      sh.position.set(0, 0.02, 0);
      sh.visible = car.visible;
      this.carShadow = sh;
      this.carGroup.add(sh);
    });
  }

  // Position the camera for the active view and show/hide the player's own car.
  _applyView() {
    if (this.carModel) this.carModel.visible = this.view !== '1st';
    if (this.view === '1st') {
      this.camera.position.set(0, 1.5, 1.6);
      this.camera.lookAt(0, 1.15, -40);
    } else {
      this.camera.position.set(0, 3.3, 8.5);
      this.camera.lookAt(0, 0.9, -18);
    }
  }

  // Build the traffic-car pool: every vehicle EXCEPT the player's pick, each
  // normalised + prepared so it can be cloned cheaply per obstacle. Rear faces
  // us (traffic drives the same way). Recolored per-spawn for extra variety.
  _loadTrafficModels(excludeId) {
    if (this.trafficVehicleId === excludeId && this.trafficModels.length) return;
    this.trafficVehicleId = excludeId;
    this.trafficModels = [];
    for (const v of VEHICLES) {
      if (v.id === excludeId) continue;
      loadGLB(v.glb).then((car) => {
        if (!car || this.trafficVehicleId !== excludeId) return;
        const box = new THREE.Box3().setFromObject(car);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        car.position.sub(center);
        car.scale.setScalar((v.scale * SIZE) / Math.max(size.x, size.z));
        const box2 = new THREE.Box3().setFromObject(car);
        car.position.y -= box2.min.y;
        car.rotation.y = -Math.PI / 2; // rear faces us (same-direction traffic)
        this.trafficModels.push(car);
      });
    }
  }

  _buildRoad(rc) {
    // Realistic asphalt: high-res albedo (aggregate grains + tonal blotches +
    // cracks) + a matching height canvas → normal map, so light/headlights catch
    // the surface relief. Lane markings painted on the albedo (weathered).
    const W = 512, HH = 1024;
    const col = document.createElement('canvas'); col.width = W; col.height = HH;
    const cg = col.getContext('2d');
    const hgt = document.createElement('canvas'); hgt.width = W; hgt.height = HH;
    const hg = hgt.getContext('2d');

    cg.fillStyle = rc.base; cg.fillRect(0, 0, W, HH);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, W, HH);

    // large soft tonal blotches (patchy wear) — albedo only
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * W, y = Math.random() * HH, r = 40 + Math.random() * 130;
      const a = Math.random() * 0.05;
      cg.fillStyle = (Math.random() < 0.5 ? 'rgba(255,255,255,' : 'rgba(0,0,0,') + a + ')';
      cg.beginPath(); cg.arc(x, y, r, 0, 7); cg.fill();
    }
    // aggregate grains (albedo speck + matching height bump)
    for (let i = 0; i < 11000; i++) {
      const x = Math.random() * W, y = Math.random() * HH, s = 0.6 + Math.random() * 1.9;
      const dark = Math.random() < 0.5;
      const lum = dark ? 55 + Math.random() * 40 : 150 + Math.random() * 75;
      cg.fillStyle = 'rgba(' + lum + ',' + lum + ',' + lum + ',' + (0.10 + Math.random() * 0.18) + ')';
      cg.fillRect(x, y, s, s);
      const hv = dark ? 95 + Math.random() * 25 : 150 + Math.random() * 85;
      hg.fillStyle = 'rgba(' + hv + ',' + hv + ',' + hv + ',0.55)';
      hg.fillRect(x, y, s, s);
    }
    // subtle cracks (albedo dark line + height dip)
    for (let i = 0; i < 16; i++) {
      let x = Math.random() * W, y = Math.random() * HH;
      const lw = 0.8 + Math.random();
      cg.strokeStyle = 'rgba(0,0,0,0.28)'; cg.lineWidth = lw;
      hg.strokeStyle = 'rgba(45,45,45,0.6)'; hg.lineWidth = lw;
      cg.beginPath(); hg.beginPath(); cg.moveTo(x, y); hg.moveTo(x, y);
      const seg = 6 + Math.floor(Math.random() * 6);
      for (let s = 0; s < seg; s++) { x += (Math.random() - 0.5) * 44; y += Math.random() * 60; cg.lineTo(x, y); hg.lineTo(x, y); }
      cg.stroke(); hg.stroke();
    }
    // lane markings (albedo only), weathered — positions scaled ×2 from the old 256px layout
    const mark = (x, w, color, dashLen, gap) => {
      cg.fillStyle = color;
      if (!dashLen) { cg.fillRect(x, 0, w, HH); return; }
      for (let y = 0; y < HH; y += dashLen + gap) cg.fillRect(x, y, w, dashLen);
    };
    mark(20, 12, rc.edge, 0, 0); mark(480, 12, rc.edge, 0, 0);   // edge lines
    mark(250, 12, rc.center, 100, 80);                            // centre dashes
    mark(132, 8, rc.divider, 92, 88); mark(372, 8, rc.divider, 92, 88); // lane dividers
    // wear specks over the markings
    for (let i = 0; i < 1600; i++) {
      cg.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.25) + ')';
      cg.fillRect(Math.random() * W, Math.random() * HH, 1.4, 1.4);
    }

    const tex = new THREE.CanvasTexture(col);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 26);
    tex.anisotropy = this.maxAniso;
    this.roadTex = tex;

    const nrm = normalFromHeight(hgt, 2.2);
    nrm.repeat.set(1, 26);
    nrm.anisotropy = this.maxAniso;
    this.roadNrm = nrm;

    const wet = !this.buildingDay; // night city maps read as damp/wet asphalt
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_HALF * 2, 520),
      new THREE.MeshStandardMaterial({
        map: tex,
        normalMap: nrm,
        normalScale: new THREE.Vector2(0.7, 0.7),
        roughness: wet ? 0.55 : 0.9,
        metalness: wet ? 0.35 : 0.0,
        envMapIntensity: wet ? 0.85 : 0.35,
      })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -230);
    this.scene.add(road); this.mapObjs.push(road); this.road = road;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 520),
      new THREE.MeshStandardMaterial({ color: this.buildingDay ? 0x2b2d33 : 0x08090e, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, -230);
    this.scene.add(ground); this.mapObjs.push(ground);
  }

  _buildRainSystem() {
    const N = 500;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 60;
      pos[i * 3 + 1] = Math.random() * 40;
      pos[i * 3 + 2] = -Math.random() * 120;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x8fa2c8, size: 0.06, transparent: true, opacity: 0.5 });
    this.rain = new THREE.Points(geo, mat);
    this.scene.add(this.rain);
  }

  _resetState() {
    this.running = false;
    this.rafId = 0;
    this.lastTime = 0;
    this.menuPaused = false;

    this.speed = this.diff.startSpeed;
    this.distance = 0;
    this.lives = START_LIVES;

    this.playerX = 0;
    this.playerVX = 0;
    this.carYaw = 0;
    this.carRoll = 0;

    this.bldDist = 0;
    this.pathLane = Math.floor(LANES / 2); // guaranteed-free lane (starts centre)
    this.distSinceRow = this.diff.rowGap * 0.5; // first row after a short run-up

    this.invuln = 0;
    this.gameOver = false;
    this.practice = false;
    this.countdown = 0;
    this.paused = false;
    this.noHandsTimer = 0;
    this.shake = 0;

    // recycle any live obstacles/buildings
    for (const o of this.obstacles) this.scene.remove(o.node);
    this.obstacles = [];
    for (const b of this.buildings) this.scene.remove(b.node);
    this.buildings = [];

    this._lastScoreStr = this._lastLivesStr = this._lastSpeedStr = '';
  }

  start(opts) {
    if (this.running) return;
    opts = opts || {};

    // resolve map + vehicle (default to the first of each)
    const map = MAPS.find((m) => m.id === opts.map) || MAPS[0];
    const veh = VEHICLES.find((v) => v.id === opts.vehicle) || VEHICLES[0];
    this.view = opts.view === '1st' ? '1st' : '3rd';
    this._applyMap(map);
    this._loadVehicle(veh);
    this._loadTrafficModels(veh.id);
    this._applyView();

    // difficulty modified by the vehicle's performance profile
    const base = DIFFICULTY[opts.difficulty] || DIFFICULTY.medium;
    this.diff = {
      ...base,
      startSpeed: base.startSpeed * (0.9 + 0.1 * veh.speed),
      maxSpeed: base.maxSpeed * veh.speed,
      accel: base.accel * veh.accel,
    };
    this.handlingMult = veh.handling;

    this._resetState();
    this.practice = !!opts.practice;
    this.difficultyId = opts.difficulty || 'medium';
    this.countdown = 3;
    if (this.gameoverScreen) this.gameoverScreen.hidden = true;
    this.running = true;
    this.lastTime = performance.now();
    this._updateHud();
    this.rafId = requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  _loop(now) {
    if (!this.running) return;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.05) dt = 0.05;
    this._update(dt);
    this._render();
    if (this.running) this.rafId = requestAnimationFrame(this._loop);
  }

  // Manual pause (menu button). Freezes the game without ending it.
  pauseForMenu() { if (this.running && !this.gameOver) this.menuPaused = true; }
  // Resume from the pause menu with a short ready-countdown + recalibrate.
  resumeFromMenu() {
    if (!this.menuPaused) return;
    this.menuPaused = false;
    this.countdown = 3;
    if (this.pauseEl) this.pauseEl.hidden = true;
  }

  // ---- spawns -----------------------------------------------------------
  _prepopulate() {
    // uniform, non-overlapping spacing on each side (kills z-fighting flicker)
    for (let z = -12; z > SPAWN_Z; z -= BLD_SPACING) {
      this._spawnBuilding(-1, z);
      this._spawnBuilding(1, z - BLD_SPACING * 0.5); // stagger the far side
    }
    this.bldDist = 0;
  }

  _spawnBuilding(side, zPos) {
    const h = 20 + Math.random() * 40;
    const w = 7 + Math.random() * 7;
    const d = 5 + Math.random() * 4; // shallow-ish so the sides read as facade, not a fat box
    const geo = new THREE.BoxGeometry(w, h, d);

    // window facade on EVERY vertical face (no black sides). Day = daylight-lit
    // concrete/glass; night = emissive neon windows.
    const day = this.buildingDay;
    const neon = Math.random() < 0.5 ? WIN_WARM : WIN_COOL;
    const cols = Math.max(3, Math.round(w / 2.0));
    const rows = Math.max(6, Math.round(h / 2.3));
    const wt = makeWindowsTex(cols, rows, neon, day);
    wt.anisotropy = this.maxAniso;
    const winMat = day
      ? new THREE.MeshStandardMaterial({ map: wt, roughness: 0.7, metalness: 0.15 })
      : new THREE.MeshStandardMaterial({ map: wt, emissive: 0xffffff, emissiveMap: wt, emissiveIntensity: 1.05, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: day ? 0x4a4d55 : 0x0a0c14, roughness: 0.95 });

    // BoxGeometry face order: +x,-x,+y,-y,+z,-z
    const inner = side < 0 ? 0 : 1; // road-facing face
    const mats = [winMat, winMat, roofMat, roofMat, winMat, winMat];
    // Most buildings get a realistic city photo — put it on EVERY visible face
    // (road-facing + both ends) so the sides match the front instead of showing
    // the toy window grid. Only the outer face (away from the road, never seen)
    // keeps the cheap procedural texture.
    if (this.bldTex && this.bldTex.length && Math.random() < 0.8) {
      const tex = this.bldTex[Math.floor(Math.random() * this.bldTex.length)];
      tex.anisotropy = this.maxAniso;
      const photoMat = day
        ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0.1 })
        : new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.55, roughness: 0.8 });
      mats[inner] = photoMat; // road-facing
      mats[4] = photoMat;     // +z end
      mats[5] = photoMat;     // -z end
    }

    const node = new THREE.Mesh(geo, mats);
    // keep the whole building OUTSIDE the road (inner edge just past the curb)
    const x = side * (ROAD_HALF + w / 2 + 1.2);
    node.position.set(x, h / 2, zPos != null ? zPos : SPAWN_Z - Math.random() * 20);
    this.scene.add(node);
    this.buildings.push({ node });
  }

  // Spawn a ROW of obstacles that always leaves one guaranteed-free path lane.
  // The path lane shifts by at most 1 between rows, so a weavable path always exists.
  _spawnRow() {
    const d = this.diff;
    if (Math.random() < d.shift) {
      this.pathLane = clamp(this.pathLane + (Math.random() < 0.5 ? -1 : 1), 0, LANES - 1);
    }
    const others = [];
    for (let i = 0; i < LANES; i++) if (i !== this.pathLane) others.push(i);
    for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
    const blockN = Math.min(d.density, others.length);
    for (let k = 0; k < blockN; k++) this._spawnObstacleAt(laneX(others[k]));
  }

  _spawnObstacleAt(x) {
    const r = Math.random();
    let node, half;
    if (r < 0.55 && this.trafficModels.length) {
      // Traffic = one of the OTHER vehicles (never the player's pick), tinted a
      // random colour so no two look identical.
      const base = this.trafficModels[Math.floor(Math.random() * this.trafficModels.length)];
      node = base.clone(true);
      const tint = TRAFFIC_TINTS[Math.floor(Math.random() * TRAFFIC_TINTS.length)];
      node.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); if (o.material.color) o.material.color.multiply(tint); } });
      half = 1.2 * SIZE;
    } else if (r < 0.72) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.5 * SIZE, 1.1 * SIZE, 20), new THREE.MeshStandardMaterial({ color: 0xff6a1a, emissive: 0xff5510, emissiveIntensity: 0.3, roughness: 0.6 }));
      m.position.y = 0.55 * SIZE; node = new THREE.Group(); node.add(m);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * SIZE, 0.5 * SIZE, 0.22 * SIZE, 20), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      band.position.y = 0.55 * SIZE; node.add(band);
      half = 0.6 * SIZE;
    } else if (r < 0.86) {
      // oil drum / barrel
      const col = BARREL_COLORS[Math.floor(Math.random() * BARREL_COLORS.length)];
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.55 * SIZE, 0.55 * SIZE, 1.4 * SIZE, 22), new THREE.MeshStandardMaterial({ color: col, metalness: 0.4, roughness: 0.5 }));
      drum.position.y = 0.7 * SIZE; node = new THREE.Group(); node.add(drum);
      for (const yy of [0.45, 0.95]) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.57 * SIZE, 0.57 * SIZE, 0.1 * SIZE, 22), new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }));
        ring.position.y = yy * SIZE; node.add(ring);
      }
      half = 0.62 * SIZE;
    } else {
      const m = new THREE.Mesh(new THREE.BoxGeometry(3.0 * SIZE, 1.1 * SIZE, 0.5 * SIZE), new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xaa4400, emissiveIntensity: 0.25, roughness: 0.7 }));
      m.position.y = 0.75 * SIZE; node = new THREE.Group(); node.add(m);
      const legL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.4 * SIZE, 0.15), new THREE.MeshStandardMaterial({ color: 0x222222 })); legL.position.set(-1.35 * SIZE, 0.7 * SIZE, 0); node.add(legL);
      const legR = legL.clone(); legR.position.x = 1.35 * SIZE; node.add(legR);
      half = 1.55 * SIZE;
    }
    node.position.x = x; node.position.z = SPAWN_Z;
    this.scene.add(node);
    this.obstacles.push({ node, x, z: SPAWN_Z, half, hit: false });
  }

  // ---- update -----------------------------------------------------------
  _update(dt) {
    if (this.menuPaused) return; // manual pause (menu open) — freeze everything, keep rendering
    if (this.countdown > 0) {
      this.countdown -= dt;
      if (this.countdown <= 0 && typeof this.tracker.calibrate === 'function') this.tracker.calibrate();
      this._showCountdown();
      this._updateHud();
      return;
    }
    if (this.cdEl && !this.cdEl.hidden) this.cdEl.hidden = true;

    if (this.tracker.detected) {
      this.noHandsTimer = 0;
      if (this.paused) { this.paused = false; this.countdown = 3; if (this.pauseEl) this.pauseEl.hidden = true; this._updateHud(); return; }
    } else {
      this.noHandsTimer += dt;
      if (!this.paused && this.noHandsTimer > NO_HANDS_GRACE) { this.paused = true; if (this.pauseEl) this.pauseEl.hidden = false; }
    }
    if (this.paused) { this._updateHud(); return; }

    const steering = clamp(this.tracker.steering || 0, -1, 1);
    this.speed = Math.min(this.diff.maxSpeed, this.speed + this.diff.accel * dt);
    this.distance += this.speed * dt * 0.05;

    // lateral movement with momentum (scaled by the vehicle's handling)
    const targetVX = steering * 4.4 * this.handlingMult;
    this.playerVX += (targetVX - this.playerVX) * Math.min(1, dt * 5.5);
    this.playerX += this.playerVX * dt / ROAD_HALF;
    if (this.playerX > PLAYER_MAX_X) { this.playerX = PLAYER_MAX_X; this.playerVX *= -0.2; }
    if (this.playerX < -PLAYER_MAX_X) { this.playerX = -PLAYER_MAX_X; this.playerVX *= -0.2; }

    // REAL 3D turn: gentle yaw toward travel direction + a very slight, stable lean
    const yawTarget = -this.playerVX * 0.045;
    this.carYaw += (yawTarget - this.carYaw) * Math.min(1, dt * 6);
    const rollTarget = this.playerVX * 0.012;
    this.carRoll += (rollTarget - this.carRoll) * Math.min(1, dt * 5);

    const worldMove = this.speed * WZ * dt;
    this.roadTex.offset.y -= worldMove / 20;
    if (this.roadNrm) this.roadNrm.offset.y = this.roadTex.offset.y;

    // buildings scroll toward camera; fill on first frame, then top up at fixed
    // spacing so they never overlap (no z-fighting flicker)
    if (this.buildings.length === 0) this._prepopulate();
    this.bldDist += worldMove;
    if (this.bldDist >= BLD_SPACING) {
      this.bldDist -= BLD_SPACING;
      this._spawnBuilding(-1, SPAWN_Z);
      this._spawnBuilding(1, SPAWN_Z - BLD_SPACING * 0.5);
    }
    for (const b of this.buildings) b.node.position.z += worldMove;
    for (let i = this.buildings.length - 1; i >= 0; i--) {
      const bn = this.buildings[i].node;
      if (bn.position.z > 25) {
        this.scene.remove(bn);
        bn.geometry.dispose();
        const mm = Array.isArray(bn.material) ? bn.material : [bn.material];
        for (const m of mm) {
          // dispose per-building window textures, but NOT the shared photo textures
          if (m.map && (!this.bldTex || !this.bldTex.includes(m.map))) m.map.dispose();
          m.dispose();
        }
        this.buildings.splice(i, 1);
      }
    }

    // obstacles — spawned in ROWS spaced by distance, each with a guaranteed gap
    if (!this.practice) {
      this.distSinceRow += worldMove;
      if (this.distSinceRow >= this.diff.rowGap) { this.distSinceRow = 0; this._spawnRow(); }
      for (const o of this.obstacles) { o.z += worldMove; o.node.position.z = o.z; }
      for (let i = this.obstacles.length - 1; i >= 0; i--) {
        if (this.obstacles[i].z > 15) { this.scene.remove(this.obstacles[i].node); this.obstacles.splice(i, 1); }
      }
      if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
      this._checkCollisions();
    }

    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.4);

    // apply car transform
    const carX = this.playerX * LANE_SPAN;
    this.carGroup.position.x = carX;
    this.carGroup.position.y = 0;           // planted — no vertical bob (stable)
    this.carGroup.rotation.y = this.carYaw; // steering yaw (base orientation set on the model)
    this.carGroup.rotation.z = this.carRoll;

    // camera: cockpit (1st person) or chase (3rd person). camX is reused by rain below.
    let camX;
    if (this.view === '1st') {
      // sit at the driver's seat, follow the car fully, look down the road
      camX = carX + (this.shake ? (Math.random() - 0.5) * this.shake * 0.8 : 0);
      this.camera.position.x += (camX - this.camera.position.x) * Math.min(1, dt * 9);
      this.camera.position.y = 1.5 + (this.shake ? (Math.random() - 0.5) * this.shake * 0.5 : 0);
      this.camera.position.z = 1.6;
      this.camera.lookAt(carX + this.playerVX * 0.6, 1.15, -40);
      this.camera.rotation.z += -this.carRoll * 0.5; // subtle cockpit lean (after lookAt)
    } else {
      camX = carX * 0.55 + (this.shake ? (Math.random() - 0.5) * this.shake * 1.5 : 0);
      this.camera.position.x += (camX - this.camera.position.x) * Math.min(1, dt * 4);
      this.camera.position.y = 3.3 + (this.shake ? (Math.random() - 0.5) * this.shake : 0);
      this.camera.position.z = 8.5;
      this.camera.lookAt(carX * 0.6, 0.9, -18);
    }

    // rain fall
    const rp = this.rain.geometry.attributes.position.array;
    for (let i = 0; i < rp.length; i += 3) {
      rp[i + 1] -= (30 + this.speed * 0.02) * dt;
      rp[i + 2] += worldMove;
      if (rp[i + 1] < 0 || rp[i + 2] > 10) { rp[i + 1] = 35 + Math.random() * 10; rp[i + 2] = -Math.random() * 120; rp[i] = camX + (Math.random() - 0.5) * 60; }
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    this.rain.position.z = 0;

    this._updateHud();
  }

  _checkCollisions() {
    if (this.invuln > 0) return;
    const carX = this.playerX * LANE_SPAN;
    for (const o of this.obstacles) {
      if (o.hit) continue;
      if (Math.abs(o.z) < 2.4 && Math.abs(o.x - carX) < (o.half + 0.95 * SIZE)) {
        o.hit = true;
        this.lives -= 1;
        this.invuln = INVULN_TIME;
        this.shake = 0.6;
        if (this.lives <= 0) { this.lives = 0; this._endGame(); }
        break;
      }
    }
  }

  _endGame() {
    this.stop();
    this.gameOver = true;
    if (this.finalScore) this.finalScore.textContent = '최종 거리: ' + Math.floor(this.distance) + ' m';
    if (this.gameoverScreen) this.gameoverScreen.hidden = false;
    if (typeof this.onGameOver === 'function') {
      this.onGameOver({ distance: Math.floor(this.distance), difficulty: this.difficultyId, practice: !!this.practice });
    }
  }

  _showCountdown() {
    if (!this.cdEl) return;
    this.cdEl.hidden = false;
    this.cdEl.textContent = String(Math.ceil(this.countdown));
  }

  _updateHud() {
    const s = '거리: ' + Math.floor(this.distance) + ' m';
    if (s !== this._lastScoreStr && this.hudScore) { this.hudScore.textContent = s; this._lastScoreStr = s; }
    const l = this.practice ? '🟢 연습' : this.lives > 0 ? '❤'.repeat(this.lives) : '💀';
    if (l !== this._lastLivesStr && this.hudLives) { this.hudLives.textContent = l; this._lastLivesStr = l; }
    const sp = '속도: ' + Math.floor(this.speed / 3) + ' km/h';
    if (sp !== this._lastSpeedStr && this.hudSpeed) { this.hudSpeed.textContent = sp; this._lastSpeedStr = sp; }
  }

  _render() {
    // flash the car during invulnerability — but never show it in cockpit view
    if (this.carModel) {
      const blinkOff = this.invuln > 0 && Math.floor(this.invuln * 12) % 2 === 0;
      this.carModel.visible = this.view !== '1st' && !blinkOff;
    }
    if (this.carShadow) this.carShadow.visible = this.view !== '1st';
    this.renderer.render(this.scene, this.camera);
  }
}
