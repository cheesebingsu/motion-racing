// js/game3d.js
// RacingGame3D: a REAL 3D night-city racer built on Three.js.
// Same public interface as the old 2D RacingGame: new RacingGame3D(canvas, tracker),
// .start(opts), .stop(). Reads tracker.steering / tracker.detected / tracker.calibrate.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---- world tunables (metres) ----------------------------------------------
const VIEW_W = 960, VIEW_H = 540;
const ROAD_HALF = 8.5;          // half road width
const LANE_SPAN = ROAD_HALF * 0.82;
const SPAWN_Z = -230;           // where obstacles/buildings appear ahead
const PLAYER_MAX_X = 1.06;
const WZ = 0.05;                // game-speed unit -> metres/sec

const START_LIVES = 3;
const INVULN_TIME = 1.6;
const NO_HANDS_GRACE = 0.4;

const DIFFICULTY = {
  easy:   { key: 'easy',   label: '쉬움',   startSpeed: 150, maxSpeed: 520,  accel: 5,  spawnBase: 1.25, burst: 1 },
  medium: { key: 'medium', label: '중간',   startSpeed: 220, maxSpeed: 880,  accel: 9,  spawnBase: 0.75, burst: 1 },
  hard:   { key: 'hard',   label: '어려움', startSpeed: 340, maxSpeed: 1150, accel: 14, spawnBase: 0.42, burst: 2 },
};

const CAR_TINTS = [0xff4455, 0x44aaff, 0xffcc44, 0x66ff88, 0xffffff, 0xaa66ff];

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
    scene.background = new THREE.Color(0x070912);
    scene.fog = new THREE.Fog(0x121627, 70, 300);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(58, VIEW_W / VIEW_H, 0.1, 500);
    camera.position.set(0, 3.3, 8.5);
    camera.lookAt(0, 0.9, -18);
    this.camera = camera;

    // ---- lights ----
    scene.add(new THREE.HemisphereLight(0x445577, 0x0a0c12, 0.9));
    const moon = new THREE.DirectionalLight(0xaabbff, 0.8);
    moon.position.set(-8, 12, -6);
    scene.add(moon);
    // distant city glow at the horizon
    const glow = new THREE.PointLight(0xff9a4d, 60, 260, 2);
    glow.position.set(0, 8, -180);
    scene.add(glow);

    this._buildRoad();
    this._buildRainSystem();

    // pools
    this.buildings = [];
    this.obstacles = [];

    // player car placeholder group (mesh added when GLB loads)
    this.carGroup = new THREE.Group();
    this.carGroup.position.set(0, 0, 0);
    scene.add(this.carGroup);
    // headlights
    const hlL = new THREE.SpotLight(0xeaf0ff, 40, 90, 0.5, 0.4, 1.5);
    hlL.position.set(-0.7, 0.7, -1.6); hlL.target.position.set(-1.2, 0.2, -30);
    const hlR = hlL.clone(); hlR.position.x = 0.7; hlR.target.position.x = 1.2;
    this.carGroup.add(hlL, hlL.target, hlR, hlR.target);

    this._assetsReady = false;
    this._loadAssets();

    this._loop = this._loop.bind(this);
    this.diff = DIFFICULTY.medium;
    this._resetState();
  }

  async _loadAssets() {
    const [car, ...blds] = await Promise.all([
      loadGLB('assets/car-player.glb'),
      loadTex('assets/bld-glass.png'),
      loadTex('assets/bld-apt.png'),
      loadTex('assets/bld-billboard.png'),
      loadTex('assets/bld-industrial.png'),
    ]);
    this.bldTex = blds;
    if (car) {
      // normalise: centre on origin, scale to ~2m wide, face -Z (away from camera)
      const box = new THREE.Box3().setFromObject(car);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      car.position.sub(center);
      const scale = 4.6 / Math.max(size.x, size.z);
      car.scale.setScalar(scale);
      // drop so wheels sit on the ground
      const box2 = new THREE.Box3().setFromObject(car);
      car.position.y -= box2.min.y;
      car.rotation.y = -Math.PI / 2; // orient so the REAR faces the chase camera
      this.carModel = car;
      this.carGroup.add(car);
    }
    this._assetsReady = true;
  }

  _buildRoad() {
    // asphalt + lane markings via a canvas texture, tiled down the road
    const c = document.createElement('canvas'); c.width = 256; c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#1a1c22'; g.fillRect(0, 0, 256, 512);
    // subtle asphalt speckle
    for (let i = 0; i < 500; i++) { g.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.03) + ')'; g.fillRect(Math.random() * 256, Math.random() * 512, 2, 2); }
    // edge lines
    g.fillStyle = 'rgba(230,230,240,0.7)'; g.fillRect(10, 0, 6, 512); g.fillRect(240, 0, 6, 512);
    // dashed centre
    g.fillStyle = 'rgba(240,222,150,0.85)';
    for (let y = 0; y < 512; y += 90) g.fillRect(125, y, 6, 50);
    // lane dividers (dashed white)
    g.fillStyle = 'rgba(220,220,230,0.35)';
    for (let y = 30; y < 512; y += 90) { g.fillRect(66, y, 4, 46); g.fillRect(186, y, 4, 46); }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 26);
    tex.anisotropy = 8;
    this.roadTex = tex;

    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_HALF * 2, 520),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.1, color: 0x8890a0 })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -230);
    this.scene.add(road);
    this.road = road;

    // dark ground either side
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 520),
      new THREE.MeshStandardMaterial({ color: 0x08090e, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, -230);
    this.scene.add(ground);
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

    this.speed = this.diff.startSpeed;
    this.distance = 0;
    this.lives = START_LIVES;

    this.playerX = 0;
    this.playerVX = 0;
    this.carYaw = 0;
    this.carRoll = 0;

    this.spawnTimer = 0;
    this.bldTimer = 0;

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
    this.diff = DIFFICULTY[opts && opts.difficulty] || DIFFICULTY.medium;
    this._resetState();
    this.practice = !!(opts && opts.practice);
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

  // ---- spawns -----------------------------------------------------------
  _prepopulate() {
    for (let z = -14; z > SPAWN_Z; z -= 11 + Math.random() * 9) {
      this._spawnBuilding(-1, z);
      this._spawnBuilding(1, z - 5 - Math.random() * 6);
    }
  }

  _spawnBuilding(side, zPos) {
    if (!this.bldTex) return;
    const tex = this.bldTex[Math.floor(Math.random() * this.bldTex.length)];
    const h = 18 + Math.random() * 34;
    const w = 8 + Math.random() * 8;
    const d = 8 + Math.random() * 10;
    const geo = new THREE.BoxGeometry(w, h, d);
    const faceMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.7, roughness: 0.8 });
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x14182a, emissive: 0x0a0c18, emissiveIntensity: 0.4, roughness: 0.9 });
    // face the street: +x side buildings show -x face, etc. BoxGeometry face order: +x,-x,+y,-y,+z,-z
    const inner = side < 0 ? 0 : 1; // left buildings (x<0) show +x face(0); right show -x face(1)
    const mats = [sideMat, sideMat, sideMat, sideMat, sideMat, sideMat];
    mats[inner] = faceMat;
    const node = new THREE.Mesh(geo, mats);
    const x = side * (ROAD_HALF + 1.5 + Math.random() * 5);
    node.position.set(x, h / 2, zPos != null ? zPos : SPAWN_Z - Math.random() * 20);
    this.scene.add(node);
    this.buildings.push({ node });
  }

  _spawnObstacle() {
    const lane = (Math.random() * 1.5 - 0.75) * LANE_SPAN;
    const r = Math.random();
    let node, half, isCar = false;
    if (r < 0.5 && this.carModel) {
      node = this.carModel.clone(true);
      node.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); if (o.material.color) o.material.color.multiplyScalar(0.8); } });
      // tint via a coloured overlay isn't trivial on textured mesh; leave as-is (varied by scale)
      node.rotation.y = -Math.PI / 2; // rear faces us (traffic driving the same way)
      half = 1.2; isCar = true;
    } else if (r < 0.72) {
      // cone
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.1, 20), new THREE.MeshStandardMaterial({ color: 0xff6a1a, emissive: 0xff5510, emissiveIntensity: 0.3, roughness: 0.6 }));
      m.position.y = 0.55; node = new THREE.Group(); node.add(m);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.22, 20), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      band.position.y = 0.55; node.add(band);
      half = 0.6;
    } else {
      // barrier: striped box
      const m = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 0.5), new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xaa4400, emissiveIntensity: 0.25, roughness: 0.7 }));
      m.position.y = 0.75; node = new THREE.Group(); node.add(m);
      const legL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.4, 0.15), new THREE.MeshStandardMaterial({ color: 0x222 })); legL.position.set(-1.4, 0.7, 0); node.add(legL);
      const legR = legL.clone(); legR.position.x = 1.4; node.add(legR);
      half = 1.7;
    }
    node.position.x = lane; node.position.z = SPAWN_Z;
    if (isCar) { /* car already positioned via group child */ }
    this.scene.add(node);
    this.obstacles.push({ node, x: lane, z: SPAWN_Z, half, hit: false });
  }

  // ---- update -----------------------------------------------------------
  _update(dt) {
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

    // lateral movement with momentum
    const targetVX = steering * 3.2;
    this.playerVX += (targetVX - this.playerVX) * Math.min(1, dt * 5);
    this.playerX += this.playerVX * dt / ROAD_HALF;
    if (this.playerX > PLAYER_MAX_X) { this.playerX = PLAYER_MAX_X; this.playerVX *= -0.2; }
    if (this.playerX < -PLAYER_MAX_X) { this.playerX = -PLAYER_MAX_X; this.playerVX *= -0.2; }

    // REAL 3D turn: yaw toward travel direction + banking roll
    const yawTarget = -this.playerVX * 0.12;
    this.carYaw += (yawTarget - this.carYaw) * Math.min(1, dt * 6);
    const rollTarget = this.playerVX * 0.05;
    this.carRoll += (rollTarget - this.carRoll) * Math.min(1, dt * 6);

    const worldMove = this.speed * WZ * dt;
    this.roadTex.offset.y -= worldMove / 20;

    // buildings scroll toward camera (fill the whole street on the first frame)
    if (this.bldTex && this.buildings.length === 0) this._prepopulate();
    this.bldTimer -= dt;
    if (this.bldTimer <= 0) { this.bldTimer = 0.16; this._spawnBuilding(Math.random() < 0.5 ? -1 : 1); }
    for (const b of this.buildings) b.node.position.z += worldMove;
    for (let i = this.buildings.length - 1; i >= 0; i--) {
      if (this.buildings[i].node.position.z > 25) { this.scene.remove(this.buildings[i].node); this.buildings.splice(i, 1); }
    }

    // obstacles
    if (!this.practice) {
      this.spawnTimer -= dt;
      const interval = Math.max(0.26, this.diff.spawnBase * (this.diff.startSpeed / this.speed) + 0.14);
      if (this.spawnTimer <= 0) { this.spawnTimer = interval; for (let b = 0; b < this.diff.burst; b++) this._spawnObstacle(); }
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
    this.carGroup.position.y = Math.sin(performance.now() * 0.008) * 0.03; // subtle bob
    this.carGroup.rotation.y = this.carYaw; // steering yaw (base orientation set on the model)
    this.carGroup.rotation.z = this.carRoll;

    // chase camera follows laterally + shake
    const camX = carX * 0.55 + (this.shake ? (Math.random() - 0.5) * this.shake * 1.5 : 0);
    this.camera.position.x += (camX - this.camera.position.x) * Math.min(1, dt * 4);
    this.camera.position.y = 3.3 + (this.shake ? (Math.random() - 0.5) * this.shake : 0);
    this.camera.lookAt(carX * 0.6, 0.9, -18);

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
      if (Math.abs(o.z) < 2.6 && Math.abs(o.x - carX) < (o.half + 0.95)) {
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
    // flash the car during invulnerability
    if (this.carModel) this.carModel.visible = !(this.invuln > 0 && Math.floor(this.invuln * 12) % 2 === 0);
    this.renderer.render(this.scene, this.camera);
  }
}
