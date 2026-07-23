// js/game.js
// RacingGame: pseudo-3D endless racer drawn on Canvas 2D.
// Reads a live `tracker` (from createHandTracker) for steering each frame.
// NOTE: webcam-based tracker requires localhost or https to work.

// ---- tunables -------------------------------------------------------------
// Landscape 16:9 canvas (like KartRider / PC racers). Play a phone in landscape.
const CANVAS_W = 960;
const CANVAS_H = 540;

const HORIZON_Y = CANVAS_H * 0.30;      // vanishing point raised → longer road, more reaction time
const ROAD_NEAR_HALF = CANVAS_W * 0.46; // half road width at the bottom (near) — wider road
const ROAD_FAR_HALF = CANVAS_W * 0.06;  // half road width at the horizon — wider vanishing point
const BEND_MAX = CANVAS_W * 0.30;       // max horizontal road bend at the horizon

const STEER_MOVE = 360;    // how fast the car slides across the road per steering unit

const PLAYER_Y = CANVAS_H - 66;
const PLAYER_W = 156;      // wide, matches the rear-view car sprite (~2.1:1)
const PLAYER_H = 74;

const OBST_BASE_W = 148;
const OBST_BASE_H = 70;

const START_LIVES = 3;
const INVULN_TIME = 1.6;   // seconds of flashing invulnerability after a hit
const NO_HANDS_GRACE = 0.4; // seconds of no-hands before the game auto-pauses

// Difficulty presets — start speed + obstacle density.
//   startSpeed/maxSpeed/accel: forward speed curve (units/sec; HUD shows /3 km/h)
//   spawnBase: base seconds between obstacle spawns (smaller = more obstacles)
//   burst: how many obstacles spawn at once
const DIFFICULTY = {
  easy:   { key: 'easy',   label: '쉬움',   startSpeed: 150, maxSpeed: 520,  accel: 5,  spawnBase: 1.25, burst: 1 },
  medium: { key: 'medium', label: '중간',   startSpeed: 220, maxSpeed: 880,  accel: 9,  spawnBase: 0.75, burst: 1 },
  hard:   { key: 'hard',   label: '어려움', startSpeed: 340, maxSpeed: 1150, accel: 14, spawnBase: 0.42, burst: 2 },
};

// Colors — cyberpunk / synthwave neon palette (CSS variables don't reach canvas).
const C = {
  skyTop: '#07030f',
  skyMid: '#1a0b33',
  skyHorizon: '#3a1145',
  sun: '#ff2e88',
  hill: '#170a2b',
  grassLight: '#1a1140',   // dark neon ground
  grassDark: '#120a2c',
  asphalt: '#1c1c28',
  asphaltDark: '#15151f',
  rumbleLight: '#23e0ff',  // neon cyan rumble
  rumbleDark: '#ff3ea5',   // neon magenta rumble
  edge: '#8fefff',         // glowing cyan edge line
  lane: '#ff6ad5',         // neon pink centre line
  player: '#2ec7ff',
  playerDark: '#0f6fa4',
  tail: '#ff2b2b',
};

// Fallback obstacle car colours (used only if a sprite fails to load).
const CAR_COLORS = [
  { body: '#ff3ea5', dark: '#b8256f' },
  { body: '#ff9d3c', dark: '#c76a17' },
];

// ---- image assets (cyberpunk) — resolved relative to index.html -----------
function loadImage(src) {
  const img = new Image();
  img.decoding = 'async';
  img.__ok = false;
  img.onload = () => { img.__ok = true; };
  img.src = src;
  return img;
}
const IMG_BG = loadImage('assets/bg-city.jpg');
const CAR_SPRITES = {
  cyan: loadImage('assets/car-cyan.png'),
  magenta: loadImage('assets/car-magenta.png'),
  orange: loadImage('assets/car-orange.png'),
};
const OBSTACLE_SPRITES = [
  { key: 'magenta', glow: 'rgba(255, 62, 165, 0.65)' },
  { key: 'orange', glow: 'rgba(255, 150, 40, 0.65)' },
];

// project a world half-width at a given screen y (linear perspective)
function roadHalfAt(y) {
  const t = (y - HORIZON_Y) / (CANVAS_H - HORIZON_Y); // 0 at horizon, 1 at bottom
  const tc = Math.max(0, Math.min(1, t));
  return ROAD_FAR_HALF + (ROAD_NEAR_HALF - ROAD_FAR_HALF) * tc;
}

// perspective scale (0 at horizon -> 1 at bottom), used to size sprites
function depthScale(y) {
  const t = (y - HORIZON_Y) / (CANVAS_H - HORIZON_Y);
  return Math.max(0, Math.min(1, t));
}

// horizontal center of the road at screen y, given the current bend (curve)
function roadCenterX(y, curve) {
  const s = depthScale(y);
  const bend = curve * (1 - s) * (1 - s) * BEND_MAX;
  return CANVAS_W / 2 + bend;
}

export class RacingGame {
  constructor(canvas, tracker) {
    this.canvas = canvas;
    this.tracker = tracker || { steering: 0, detected: false, tiltDeg: 0 };
    this.ctx = canvas.getContext('2d');

    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    // HUD elements (looked up once; text updated only on change).
    this.hudScore = document.getElementById('hud-score');
    this.hudLives = document.getElementById('hud-lives');
    this.hudSpeed = document.getElementById('hud-speed');
    this.gameoverScreen = document.getElementById('gameover-screen');
    this.finalScore = document.getElementById('final-score');

    this._loop = this._loop.bind(this);
    this._resetState();
  }

  _resetState() {
    this.running = false;
    this.rafId = 0;
    this.lastTime = 0;

    this.speed = (this.diff || DIFFICULTY.medium).startSpeed; // forward speed
    this.distance = 0;             // score, in meters
    this.lives = START_LIVES;

    this.playerX = 0;              // -1..1 across the road (0 = center)
    this.roadOffset = 0;          // accumulated scroll for stripes
    this.curve = 0;                // current road bend (autonomous, not steering)
    this.roadPhase = 0;            // phase driving the autonomous winding curve

    this.obstacles = [];           // { lane:-1..1, y, hit, color }
    this.spawnTimer = 0;

    this.scenery = [];             // roadside trees / lamp posts { side, lane, y, type }
    this.scenTimer = 0;

    this.invuln = 0;               // remaining invulnerability seconds
    this.gameOver = false;
    this.practice = false;         // practice mode: no obstacles / no collisions
    this.countdown = 0;
    this.paused = false;           // auto-paused because hands left the camera
    this.noHandsTimer = 0;         // how long hands have been missing

    // cache last HUD strings to avoid per-frame DOM writes
    this._lastScoreStr = '';
    this._lastLivesStr = '';
    this._lastSpeedStr = '';
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
    if (dt > 0.05) dt = 0.05; // clamp after tab-switch / hiccups

    this._update(dt);
    this._render();

    if (this.running) this.rafId = requestAnimationFrame(this._loop);
  }

  _update(dt) {
    // Pre-race countdown: let the player get their hands on the wheel.
    if (this.countdown > 0) {
      this.countdown -= dt;
      // When the countdown ends, lock the current hand pose as "straight".
      // Absorbs camera rotation (phone in landscape) and the user's resting angle.
      if (this.countdown <= 0 && typeof this.tracker.calibrate === 'function') {
        this.tracker.calibrate();
      }
      // The car stays put during the get-ready countdown (and thus while paused):
      // turning the wheel must NOT move the car. The road holds its current bend.
      this._updateHud();
      return;
    }

    // Auto-pause when the wheel (both hands) leaves the camera; resume with a
    // fresh 3-second countdown once the hands come back into view.
    if (this.tracker.detected) {
      this.noHandsTimer = 0;
      if (this.paused) {
        this.paused = false;
        this.countdown = 3;   // "이어서 시작" also gets a 3-2-1 prep
        this._updateHud();
        return;
      }
    } else {
      this.noHandsTimer += dt;
      if (!this.paused && this.noHandsTimer > NO_HANDS_GRACE) {
        this.paused = true;
      }
    }
    if (this.paused) {
      this._updateHud();
      return;   // freeze all progression while paused
    }

    const steering = clamp(this.tracker.steering || 0, -1, 1);

    // auto-accelerate (per-difficulty curve)
    this.speed = Math.min(this.diff.maxSpeed, this.speed + this.diff.accel * dt);

    // distance / score: ~ speed scaled to meters
    this.distance += this.speed * dt * 0.05;

    // steer the car; sensitivity tapers a touch at high speed
    this.playerX += steering * STEER_MOVE * dt / ROAD_NEAR_HALF;
    this.playerX = clamp(this.playerX, -0.92, 0.92);

    // The road winds on its OWN — independent of steering (steering only moves the
    // car). Two combined sines give a gentle, non-repetitive, moderate bend that
    // conveys forward travel. Eased so transitions stay smooth.
    this.roadPhase += (0.12 + this.speed * 0.0007) * dt;   // gentle, mildly speed-scaled
    const targetCurve =
      0.34 * Math.sin(this.roadPhase) + 0.12 * Math.sin(this.roadPhase * 0.53 + 2.0);
    this.curve += (targetCurve - this.curve) * Math.min(1, dt * 2.5);

    // scroll stripes based on speed
    this.roadOffset = (this.roadOffset + this.speed * dt) % 80;

    // invulnerability countdown
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);

    // Roadside cyberpunk structures (both modes) — rush past for a sense of speed
    // and bridge the flat road up to the distant city skyline.
    const smove = this.speed * dt;
    for (const o of this.scenery) o.y += smove * (0.55 + depthScale(o.y) * 1.25);
    this.scenery = this.scenery.filter((o) => o.y < CANVAS_H + 220);
    this.scenTimer -= dt;
    if (this.scenTimer <= 0) {
      this.scenTimer = 0.13;   // dense roadside city wall
      this._spawnStructure(Math.random() < 0.5 ? -1 : 1);
    }

    // Obstacles + collisions are skipped entirely in practice mode.
    if (!this.practice) {
      // spawn obstacles; faster speed => more frequent; difficulty sets the base
      this.spawnTimer -= dt;
      const spawnInterval = Math.max(
        0.26,
        this.diff.spawnBase * (this.diff.startSpeed / this.speed) + 0.14
      );
      if (this.spawnTimer <= 0) {
        this.spawnTimer = spawnInterval;
        for (let b = 0; b < this.diff.burst; b++) this._spawnObstacle();
      }

      // advance obstacles toward the player (down the screen).
      // Slower far away (near the vanishing point) so they emerge gradually and
      // the player can react; accelerates only as they get close.
      const move = this.speed * dt;
      for (const o of this.obstacles) {
        o.y += move * (0.4 + depthScale(o.y) * 1.15);
      }
      this.obstacles = this.obstacles.filter((o) => o.y < CANVAS_H + 120);

      this._checkCollisions();
    }

    this._updateHud();
  }

  _spawnObstacle() {
    // pick a lane offset -0.7..0.7 and a random neon car sprite
    const lane = (Math.random() * 1.4) - 0.7;
    const spr = OBSTACLE_SPRITES[Math.floor(Math.random() * OBSTACLE_SPRITES.length)];
    this.obstacles.push({ lane, y: HORIZON_Y + 2, hit: false, sprite: spr.key, glow: spr.glow });
  }

  _spawnStructure(side) {
    const NEON = ['#23e0ff', '#ff3ea5', '#b06bff', '#ff6ad5', '#3affd0'];
    const neon = NEON[Math.floor(Math.random() * NEON.length)];
    const r = Math.random();
    let type, width, height;
    if (r < 0.55) { type = 0; width = 54 + Math.random() * 40; height = 260 + Math.random() * 220; }      // tall tower
    else if (r < 0.85) { type = 0; width = 96 + Math.random() * 54; height = 150 + Math.random() * 90; }  // wide block
    else { type = 1; width = 12; height = 170 + Math.random() * 150; }                                    // holo pillar/sign
    this.scenery.push({
      side,
      lane: side * (1.1 + Math.random() * 0.7),   // hug the road edge → city canyon
      y: HORIZON_Y + 2,
      type, width, height, neon,
      seed: Math.floor(Math.random() * 1000)
    });
  }

  _checkCollisions() {
    if (this.invuln > 0) return;

    const p = this._playerRect();
    for (const o of this.obstacles) {
      if (o.hit) continue;
      const r = this._obstacleRect(o);
      if (r.y + r.h < p.y) continue; // still far up-screen
      if (aabb(p, r)) {
        o.hit = true;
        this.lives -= 1;
        this.invuln = INVULN_TIME;
        if (this.lives <= 0) {
          this.lives = 0;
          this._endGame();
        }
        break;
      }
    }
  }

  _playerRect() {
    const half = roadHalfAt(PLAYER_Y);
    const cx = roadCenterX(PLAYER_Y, this.curve) + this.playerX * half;
    return { x: cx - PLAYER_W / 2, y: PLAYER_Y - PLAYER_H / 2, w: PLAYER_W, h: PLAYER_H, cx, cy: PLAYER_Y };
  }

  _obstacleRect(o) {
    const s = depthScale(o.y);
    const w = OBST_BASE_W * (0.16 + s * 0.9);
    const h = OBST_BASE_H * (0.16 + s * 0.9);
    const half = roadHalfAt(o.y);
    const cx = roadCenterX(o.y, this.curve) + o.lane * half;
    return { x: cx - w / 2, y: o.y - h / 2, w, h, cx, cy: o.y, s };
  }

  _endGame() {
    this.stop();
    this.gameOver = true;
    const dist = Math.floor(this.distance);
    if (this.finalScore) this.finalScore.textContent = '최종 거리: ' + dist + ' m';
    if (this.gameoverScreen) this.gameoverScreen.hidden = false;
  }

  // ---- HUD --------------------------------------------------------------
  _updateHud() {
    const scoreStr = '거리: ' + Math.floor(this.distance) + ' m';
    if (scoreStr !== this._lastScoreStr && this.hudScore) {
      this.hudScore.textContent = scoreStr;
      this._lastScoreStr = scoreStr;
    }
    const livesStr = this.practice
      ? '🟢 연습'
      : this.lives > 0 ? '❤'.repeat(this.lives) : '💀';
    if (livesStr !== this._lastLivesStr && this.hudLives) {
      this.hudLives.textContent = livesStr;
      this._lastLivesStr = livesStr;
    }
    const speedStr = '속도: ' + Math.floor(this.speed / 3) + ' km/h';
    if (speedStr !== this._lastSpeedStr && this.hudSpeed) {
      this.hudSpeed.textContent = speedStr;
      this._lastSpeedStr = speedStr;
    }
  }

  // ---- rendering --------------------------------------------------------
  _render() {
    const ctx = this.ctx;
    this._drawSky(ctx);
    this._drawRoad(ctx);
    this._drawHorizonGlow(ctx);
    this._drawScenery(ctx);
    this._drawObstacles(ctx);
    this._drawPlayer(ctx);
    this._drawVignette(ctx);
    if (this.countdown > 0) this._drawCountdown(ctx);
    else if (this.paused) this._drawPause(ctx);
  }

  _drawPause(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(3, 5, 15, 0.55)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd23c';
    ctx.font = 'bold ' + Math.round(CANVAS_H * 0.1) + 'px "Segoe UI", sans-serif';
    ctx.fillText('⏸ 일시정지', CANVAS_W / 2, CANVAS_H * 0.42);
    ctx.fillStyle = '#eaf0ff';
    ctx.font = 'bold ' + Math.round(CANVAS_H * 0.045) + 'px "Segoe UI", sans-serif';
    ctx.fillText('양손을 화면에 보여주면 이어서 시작해요', CANVAS_W / 2, CANVAS_H * 0.56);
    ctx.restore();
  }

  _drawSky(ctx) {
    if (IMG_BG.__ok) {
      // Cyberpunk city photo backdrop: place so its glowing core sits at the horizon.
      const aspect = IMG_BG.width / IMG_BG.height;
      const bw = CANVAS_W;
      const bh = bw / aspect;
      const oy = HORIZON_Y - bh * 0.60;            // vanishing-point glow ≈ horizon
      const px = -this.curve * 34;                 // subtle parallax with the road bend
      ctx.drawImage(IMG_BG, px - 6, oy, bw + 12, bh);
      // soft purple haze fading the city base toward the horizon (blend, not a hard cut)
      const hz = ctx.createLinearGradient(0, HORIZON_Y - 72, 0, HORIZON_Y);
      hz.addColorStop(0, 'rgba(20, 11, 44, 0)');
      hz.addColorStop(1, 'rgba(20, 11, 44, 0.5)');
      ctx.fillStyle = hz;
      ctx.fillRect(0, HORIZON_Y - 72, CANVAS_W, 72);
    } else {
      // Procedural fallback: neon dusk gradient + glow.
      const g = ctx.createLinearGradient(0, 0, 0, HORIZON_Y);
      g.addColorStop(0, C.skyTop);
      g.addColorStop(0.55, C.skyMid);
      g.addColorStop(1, C.skyHorizon);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, CANVAS_W, HORIZON_Y);
      const sunX = CANVAS_W / 2 - this.curve * 70;
      const rg = ctx.createRadialGradient(sunX, HORIZON_Y - 6, 4, sunX, HORIZON_Y - 6, 150);
      rg.addColorStop(0, C.sun);
      rg.addColorStop(0.3, 'rgba(255,46,136,0.4)');
      rg.addColorStop(1, 'rgba(255,46,136,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, CANVAS_W, HORIZON_Y);
    }

    // dark neon ground base below the horizon
    ctx.fillStyle = C.grassDark;
    ctx.fillRect(0, HORIZON_Y, CANVAS_W, CANVAS_H - HORIZON_Y);
  }

  // Additive neon haze where the road meets the city — blends the photographic
  // backdrop into the procedural road so they read as one scene.
  _drawHorizonGlow(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gy0 = HORIZON_Y - 18, gy1 = HORIZON_Y + 74;
    const g = ctx.createLinearGradient(0, gy0, 0, gy1);
    g.addColorStop(0, 'rgba(120, 60, 200, 0.32)');
    g.addColorStop(0.25, 'rgba(255, 62, 165, 0.2)');
    g.addColorStop(1, 'rgba(35, 224, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, gy0, CANVAS_W, gy1 - gy0);
    // brighter bloom right at the vanishing point
    const vx = roadCenterX(HORIZON_Y + 4, this.curve);
    const rg = ctx.createRadialGradient(vx, HORIZON_Y, 2, vx, HORIZON_Y, 130);
    rg.addColorStop(0, 'rgba(255, 130, 225, 0.32)');
    rg.addColorStop(1, 'rgba(255, 130, 225, 0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, HORIZON_Y - 64, CANVAS_W, 128);
    ctx.restore();
  }

  _drawRoad(ctx) {
    // Draw road as horizontal scanline bands so we can color grass/rumble/road
    // and apply a per-row curve offset for the pseudo-3D bend.
    const rows = CANVAS_H - HORIZON_Y;
    for (let i = 0; i <= rows; i += 2) {
      const y = HORIZON_Y + i;
      const s = depthScale(y);
      const half = roadHalfAt(y);
      // curve pushes the road center sideways more strongly toward the horizon
      const cx = roadCenterX(y, this.curve);

      // alternating band color based on scrolling offset & depth
      const band = Math.floor((i + this.roadOffset) / (6 + s * 26)) % 2 === 0;

      // grass
      ctx.fillStyle = band ? C.grassLight : C.grassDark;
      ctx.fillRect(0, y, CANVAS_W, 2);

      // rumble strip (outer edge)
      const rumbleHalf = half + 10 + s * 8;
      ctx.fillStyle = band ? C.rumbleLight : C.rumbleDark;
      ctx.fillRect(cx - rumbleHalf, y, rumbleHalf * 2, 2);

      // asphalt
      ctx.fillStyle = band ? C.asphalt : C.asphaltDark;
      ctx.fillRect(cx - half, y, half * 2, 2);

      // solid white edge lines just inside the asphalt
      if (s > 0.05) {
        const ew = Math.max(1.2, 4 * s);
        ctx.fillStyle = C.edge;
        ctx.fillRect(cx - half + ew * 0.5, y, ew, 2);
        ctx.fillRect(cx + half - ew * 1.5, y, ew, 2);
      }

      // dashed yellow centre line
      if (band && s > 0.06) {
        const laneW = Math.max(1.5, 5 * s);
        ctx.fillStyle = C.lane;
        ctx.fillRect(cx - laneW / 2, y, laneW, 2);
      }
    }
  }

  // ---- roadside scenery -------------------------------------------------
  _drawScenery(ctx) {
    const sorted = [...this.scenery].sort((a, b) => a.y - b.y);
    for (const o of sorted) {
      const s = depthScale(o.y);
      if (s <= 0.02) continue;
      const half = roadHalfAt(o.y);
      const baseX = roadCenterX(o.y, this.curve) + o.lane * half;
      if (o.type === 1) this._drawHolo(ctx, baseX, o.y, s, o);
      else this._drawBuilding(ctx, baseX, o.y, s, o);
    }
  }

  _drawBuilding(ctx, baseX, baseY, s, o) {
    const bw = o.width * s;
    const bh = o.height * s;
    const x = baseX - bw / 2;
    const top = baseY - bh;

    // dark silhouette body with a faint vertical gradient
    const g = ctx.createLinearGradient(0, top, 0, baseY);
    g.addColorStop(0, '#170f30');
    g.addColorStop(1, '#0a0718');
    ctx.fillStyle = g;
    ctx.fillRect(x, top, bw, bh);

    // neon edge outline
    ctx.strokeStyle = o.neon;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = Math.max(1, 1.5 * s);
    ctx.strokeRect(x + 0.5, top + 0.5, bw - 1, bh - 1);
    ctx.globalAlpha = 1;

    // lit windows — a seeded grid, only when close enough to read
    if (s > 0.28) {
      const cols = Math.min(7, Math.max(2, Math.floor(bw / 9)));
      const rows = Math.min(13, Math.max(3, Math.floor(bh / 12)));
      const cw = bw / cols, rh = bh / rows;
      ctx.fillStyle = o.neon;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (((r * 7 + c * 3 + o.seed) % 5) < 2) {
            ctx.globalAlpha = 0.35 + 0.45 * (((r + c + o.seed) % 3) / 2);
            ctx.fillRect(x + c * cw + cw * 0.28, top + r * rh + rh * 0.28, cw * 0.44, rh * 0.44);
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    // glowing rooftop crown strip
    ctx.save();
    ctx.shadowColor = o.neon;
    ctx.shadowBlur = 8 * s;
    ctx.fillStyle = o.neon;
    ctx.fillRect(x, top, bw, Math.max(1, 2.2 * s));
    ctx.restore();
  }

  _drawHolo(ctx, baseX, baseY, s, o) {
    const h = o.height * s;
    const w = Math.max(1.5, o.width * s);
    // pole
    ctx.fillStyle = '#221c38';
    ctx.fillRect(baseX - w * 0.5, baseY - h, w, h);
    // glowing holographic sign panel near the top
    ctx.save();
    ctx.shadowColor = o.neon;
    ctx.shadowBlur = 12 * s;
    ctx.fillStyle = o.neon;
    ctx.globalAlpha = 0.8;
    const arm = -Math.sign(baseX - CANVAS_W / 2) || 1;
    const pw = w * 5, ph = h * 0.32;
    ctx.fillRect(baseX + (arm < 0 ? -pw : 0) + arm * w, baseY - h, pw, ph);
    ctx.restore();
  }

  _drawVignette(ctx) {
    const g = ctx.createRadialGradient(
      CANVAS_W / 2, CANVAS_H * 0.55, CANVAS_H * 0.32,
      CANVAS_W / 2, CANVAS_H * 0.55, CANVAS_H * 0.85
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.34)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  _drawObstacles(ctx) {
    // draw far-to-near so nearer ones overlap correctly
    const sorted = [...this.obstacles].sort((a, b) => a.y - b.y);
    for (const o of sorted) {
      const r = this._obstacleRect(o);
      const img = CAR_SPRITES[o.sprite];
      if (img && img.__ok) this._drawCarSprite(ctx, img, r.cx, r.cy, r.w, o.glow);
      else { const col = CAR_COLORS[0]; this._drawCar(ctx, r.cx, r.cy, r.w, r.h, col.body, col.dark); }
    }
  }

  _drawPlayer(ctx) {
    // flash during invulnerability
    if (this.invuln > 0 && Math.floor(this.invuln * 12) % 2 === 0) return;
    const p = this._playerRect();
    const img = CAR_SPRITES.cyan;
    if (img && img.__ok) this._drawCarSprite(ctx, img, p.cx, p.cy, p.w, 'rgba(35,224,255,0.6)');
    else this._drawCar(ctx, p.cx, p.cy, p.w, p.h, C.player, C.playerDark);
  }

  // Draw a car sprite (transparent PNG) centred at (cx,cy) at the given width,
  // with a neon ground-glow underneath. Falls back to _drawCar when not loaded.
  _drawCarSprite(ctx, img, cx, cy, targetW, glow) {
    const aspect = img.width / img.height;
    const w = targetW;
    const h = w / aspect;
    if (glow) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.shadowColor = glow;
      ctx.shadowBlur = Math.max(6, w * 0.16);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(cx, cy + h * 0.14, w * 0.34, h * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.drawImage(img, cx - w / 2, cy - h * 0.6, w, h);
  }

  _drawCountdown(ctx) {
    const n = Math.ceil(this.countdown);
    ctx.save();
    ctx.fillStyle = 'rgba(3, 5, 15, 0.45)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(35, 224, 255, 0.85)';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#23e0ff';
    ctx.font = 'bold ' + Math.round(CANVAS_H * 0.24) + 'px "Segoe UI", sans-serif';
    ctx.fillText(String(n), CANVAS_W / 2, CANVAS_H * 0.42);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#eaf0ff';
    ctx.font = 'bold ' + Math.round(CANVAS_H * 0.045) + 'px "Segoe UI", sans-serif';
    ctx.fillText('양손으로 핸들을 잡으세요 · 이 자세가 직진이에요', CANVAS_W / 2, CANVAS_H * 0.62);
    ctx.restore();
  }

  _drawCar(ctx, cx, cy, w, h, body, dark) {
    const x = cx - w / 2;
    const y = cy - h / 2;
    const r = Math.min(12, w * 0.2);

    // ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx, y + h - 3, w * 0.6, h * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();

    // wheels (drawn behind the body so they peek out at the sides)
    ctx.fillStyle = '#0a0a0c';
    const ww = w * 0.19, wh = h * 0.26;
    roundRect(ctx, x - ww * 0.32, y + h * 0.15, ww, wh, 3); ctx.fill();
    roundRect(ctx, x + w - ww * 0.68, y + h * 0.15, ww, wh, 3); ctx.fill();
    roundRect(ctx, x - ww * 0.32, y + h * 0.60, ww, wh, 3); ctx.fill();
    roundRect(ctx, x + w - ww * 0.68, y + h * 0.60, ww, wh, 3); ctx.fill();

    // body with a vertical gradient for volume
    const bg = ctx.createLinearGradient(x, y, x, y + h);
    bg.addColorStop(0, lighten(body, 0.35));
    bg.addColorStop(0.5, body);
    bg.addColorStop(1, dark);
    ctx.fillStyle = bg;
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();

    // glossy top highlight
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    roundRect(ctx, x + w * 0.09, y + h * 0.05, w * 0.82, h * 0.13, r * 0.6);
    ctx.fill();

    // rear window (glass gradient)
    const gg = ctx.createLinearGradient(x, y + h * 0.24, x, y + h * 0.48);
    gg.addColorStop(0, 'rgba(150,190,225,0.8)');
    gg.addColorStop(1, 'rgba(35,55,85,0.9)');
    ctx.fillStyle = gg;
    roundRect(ctx, x + w * 0.2, y + h * 0.24, w * 0.6, h * 0.22, Math.max(3, r * 0.4));
    ctx.fill();

    // trunk seam
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x + w * 0.12, y + h * 0.7, w * 0.76, Math.max(1, h * 0.025));

    // glowing tail-lights
    ctx.save();
    ctx.shadowColor = 'rgba(255,40,40,0.9)';
    ctx.shadowBlur = Math.max(4, w * 0.14);
    ctx.fillStyle = C.tail;
    roundRect(ctx, x + w * 0.11, y + h * 0.75, w * 0.22, h * 0.1, 2); ctx.fill();
    roundRect(ctx, x + w * 0.67, y + h * 0.75, w * 0.22, h * 0.1, 2); ctx.fill();
    ctx.restore();
  }
}

// ---- helpers --------------------------------------------------------------
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Mix a #rrggbb colour toward white by `amt` (0..1) → 'rgb(r,g,b)'.
function lighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c) => Math.round(c + (255 - c) * amt);
  return 'rgb(' + mix(r) + ',' + mix(g) + ',' + mix(b) + ')';
}

function aabb(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
