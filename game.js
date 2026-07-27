/*
 * Astro Blaster — a retro space shooter
 * Vanilla JavaScript + HTML5 Canvas. No libraries, no build step.
 */
'use strict';

(() => {
  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  const W = 480;
  const H = 720;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  canvas.width = W;
  canvas.height = H;

  const $ = (sel) => document.querySelector(sel);
  const screens = {
    start: $('#screen-start'),
    pause: $('#screen-pause'),
    over: $('#screen-over'),
  };
  const el = {
    bestStart: $('#best-start'),
    finalScore: $('#final-score'),
    finalLevel: $('#final-level'),
    finalBest: $('#final-best'),
    newBest: $('#new-best'),
    mute: $('#btn-mute'),
    pause: $('#btn-pause'),
  };

  const FONT = '"Press Start 2P", monospace';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hit = (a, b) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const r = a.r + b.r;
    return dx * dx + dy * dy < r * r;
  };

  const storage = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* storage unavailable — ignore */
      }
    },
  };

  const BEST_KEY = 'astro-blaster-best';
  const MUTE_KEY = 'astro-blaster-muted';
  let best = Number(storage.get(BEST_KEY, 0)) || 0;
  el.bestStart.textContent = best;

  // ---------------------------------------------------------------------------
  // Audio (generated with Web Audio — no sound files needed)
  // ---------------------------------------------------------------------------
  let audioCtx = null;
  let muted = storage.get(MUTE_KEY, '0') === '1';

  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function beep(freq, dur, type = 'square', vol = 0.05, slide = 0) {
    if (muted || !ensureAudio()) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  function noise(dur, vol) {
    if (muted || !ensureAudio()) return;
    const len = Math.floor(audioCtx.sampleRate * dur);
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = audioCtx.createBufferSource();
    const gain = audioCtx.createGain();
    src.buffer = buf;
    gain.gain.value = vol;
    src.connect(gain).connect(audioCtx.destination);
    src.start();
  }

  const sfx = {
    shoot: () => beep(880, 0.06, 'square', 0.02, -500),
    hit: () => beep(320, 0.03, 'square', 0.012),
    boom: () => noise(0.25, 0.08),
    bigBoom: () => { noise(1, 0.18); beep(80, 0.8, 'sawtooth', 0.06, -40); },
    hurt: () => beep(220, 0.4, 'sawtooth', 0.07, -160),
    power: () => { beep(600, 0.08, 'triangle', 0.06); setTimeout(() => beep(900, 0.12, 'triangle', 0.06), 80); },
    shieldBreak: () => beep(520, 0.22, 'triangle', 0.06, -300),
    level: () => { beep(440, 0.1, 'triangle', 0.05); setTimeout(() => beep(660, 0.15, 'triangle', 0.05), 110); },
    boss: () => beep(110, 0.9, 'sawtooth', 0.06, 60),
  };

  function updateMuteButton() {
    el.mute.classList.toggle('off', muted);
    el.mute.setAttribute('aria-pressed', String(muted));
  }

  function toggleMute() {
    muted = !muted;
    storage.set(MUTE_KEY, muted ? '1' : '0');
    updateMuteButton();
  }
  updateMuteButton();

  // ---------------------------------------------------------------------------
  // Background
  // ---------------------------------------------------------------------------
  const stars = Array.from({ length: 100 }, () => {
    const s = rand(0.5, 2.2);
    return { x: rand(0, W), y: rand(0, H), s, v: s * 45 };
  });

  const bgGradient = ctx.createLinearGradient(0, 0, 0, H);
  bgGradient.addColorStop(0, '#070a1f');
  bgGradient.addColorStop(1, '#05060f');

  const nebula = ctx.createRadialGradient(W * 0.25, H * 0.3, 10, W * 0.25, H * 0.3, W);
  nebula.addColorStop(0, 'rgba(199,125,255,0.10)');
  nebula.addColorStop(1, 'rgba(199,125,255,0)');

  // ---------------------------------------------------------------------------
  // Game data
  // ---------------------------------------------------------------------------
  const ENEMY_TYPES = {
    scout: { r: 13, hp: 1, speed: 120, color: '#4ef0c8', score: 100, fire: 0 },
    fighter: { r: 16, hp: 2, speed: 85, color: '#ffb347', score: 200, fire: 0.6 },
    tank: { r: 24, hp: 6, speed: 50, color: '#ff5e7a', score: 500, fire: 0.4 },
  };

  const POWERUPS = {
    triple: { color: '#4ecbff', label: '3', name: 'TRIPLE SHOT', time: 10 },
    rapid: { color: '#ffe066', label: 'R', name: 'RAPID FIRE', time: 8 },
    shield: { color: '#7fffb2', label: 'S', name: 'SHIELD', time: 8 },
    life: { color: '#ff5e7a', label: '+', name: '1 UP', time: 0 },
  };

  const MAX_LIVES = 5;

  let state = 'menu'; // menu | playing | paused | over
  let player = null;
  let bullets = [];
  let enemies = [];
  let particles = [];
  let powerups = [];
  let floaters = [];
  let score = 0;
  let level = 0;
  let spawnLeft = 0;
  let spawnTimer = 0;
  let bannerText = '';
  let bannerTimer = 0;
  let shake = 0;
  let boss = null;

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  const keys = { left: false, right: false, up: false, down: false, fire: false };
  const keyMap = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    Space: 'fire',
  };
  const pointer = { active: false, x: 0, y: 0 };

  window.addEventListener('keydown', (e) => {
    const k = keyMap[e.code];
    if (k) {
      keys[k] = true;
      e.preventDefault();
    }
    if ((e.code === 'Enter' || e.code === 'Space') && (state === 'menu' || state === 'over') && !e.repeat) {
      startGame();
    }
    if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
    if (e.code === 'KeyM') toggleMute();
  });

  window.addEventListener('keyup', (e) => {
    const k = keyMap[e.code];
    if (k) keys[k] = false;
  });

  window.addEventListener('blur', () => {
    Object.keys(keys).forEach((k) => (keys[k] = false));
    pointer.active = false;
    if (state === 'playing') togglePause();
  });

  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'playing') return;
    pointer.active = true;
    Object.assign(pointer, toCanvas(e));
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pointer.active) Object.assign(pointer, toCanvas(e));
  });
  const endPointer = () => (pointer.active = false);
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  document.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'start') startGame();
      if (action === 'resume') togglePause();
      if (action === 'menu') showMenu();
    });
  });
  el.mute.addEventListener('click', toggleMute);
  el.pause.addEventListener('click', togglePause);

  // ---------------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------------
  function showScreen(name) {
    Object.entries(screens).forEach(([key, node]) => node.classList.toggle('visible', key === name));
  }

  function resetGame() {
    player = {
      x: W / 2, y: H - 90, r: 16, speed: 380, cd: 0,
      lives: 3, shield: 0, triple: 0, rapid: 0, invuln: 2,
    };
    bullets = [];
    enemies = [];
    particles = [];
    powerups = [];
    floaters = [];
    score = 0;
    level = 0;
    shake = 0;
    boss = null;
    nextLevel();
  }

  function startGame() {
    ensureAudio();
    resetGame();
    state = 'playing';
    showScreen(null);
  }

  function showMenu() {
    state = 'menu';
    el.bestStart.textContent = best;
    showScreen('start');
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      pointer.active = false;
      showScreen('pause');
    } else if (state === 'paused') {
      state = 'playing';
      showScreen(null);
    }
  }

  function gameOver() {
    state = 'over';
    const isNewBest = score > best;
    if (isNewBest) {
      best = score;
      storage.set(BEST_KEY, best);
    }
    el.finalScore.textContent = score;
    el.finalLevel.textContent = level;
    el.finalBest.textContent = best;
    el.newBest.classList.toggle('show', isNewBest);
    setTimeout(() => {
      if (state === 'over') showScreen('over');
    }, 900);
  }

  function nextLevel() {
    level++;
    boss = null;
    spawnTimer = 1.5;
    if (level % 5 === 0) {
      spawnLeft = 0;
      boss = makeBoss();
      enemies.push(boss);
      showBanner(`BOSS LEVEL ${level}`);
      sfx.boss();
    } else {
      spawnLeft = 8 + level * 4;
      showBanner(`LEVEL ${level}`);
      if (level > 1) sfx.level();
    }
  }

  function showBanner(text) {
    bannerText = text;
    bannerTimer = 2;
  }

  // ---------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------
  function spawnEnemy() {
    const roll = Math.random();
    let type = 'scout';
    if (level >= 2 && roll < 0.35) type = 'fighter';
    if (level >= 3 && roll < 0.12) type = 'tank';

    const t = ENEMY_TYPES[type];
    const mul = 1 + (level - 1) * 0.06;
    const hp = t.hp + Math.floor((level - 1) / 4);
    const x = rand(t.r + 10, W - t.r - 10);

    enemies.push({
      type, x, baseX: x, y: -t.r * 2, r: t.r,
      hp, maxHp: hp, speed: t.speed * mul, color: t.color, score: t.score,
      fire: t.fire * mul, fireCd: rand(0.8, 2.5), phase: rand(0, Math.PI * 2),
      t: 0, flash: 0, dead: false,
    });
  }

  function makeBoss() {
    const hp = 60 + level * 12;
    return {
      type: 'boss', x: W / 2, y: -90, r: 46, hp, maxHp: hp,
      color: '#c77dff', score: 5000 + level * 500,
      fireCd: 1.5, pattern: 0, t: 0, flash: 0, entering: true, dead: false,
    };
  }

  function dropPowerup(x, y) {
    const types = Object.keys(POWERUPS);
    let type = types[Math.floor(Math.random() * types.length)];
    if (type === 'life' && (player.lives >= MAX_LIVES || Math.random() < 0.5)) type = 'shield';
    powerups.push({ x, y, r: 12, type, t: 0, dead: false });
  }

  // ---------------------------------------------------------------------------
  // Combat
  // ---------------------------------------------------------------------------
  function playerShoot() {
    const angles = player.triple > 0 ? [-0.18, 0, 0.18] : [0];
    for (const a of angles) {
      bullets.push({
        x: player.x + Math.sin(a) * 6, y: player.y - 20,
        vx: Math.sin(a) * 640, vy: -Math.cos(a) * 640,
        r: 4, enemy: false, dead: false,
      });
    }
    player.cd = player.rapid > 0 ? 0.09 : 0.18;
    sfx.shoot();
  }

  // Angle is measured from "straight down": vx = sin(a), vy = cos(a)
  function enemyBullet(x, y, angle, speed) {
    bullets.push({
      x, y, vx: Math.sin(angle) * speed, vy: Math.cos(angle) * speed,
      r: 5, enemy: true, dead: false,
    });
  }

  function aimAt(e) {
    return Math.atan2(player.x - e.x, player.y - e.y);
  }

  function enemyShoot(e) {
    if (e.type === 'tank') {
      for (const a of [-0.3, 0, 0.3]) enemyBullet(e.x, e.y + e.r, a, 210);
    } else {
      enemyBullet(e.x, e.y + e.r, aimAt(e), 240);
    }
  }

  function bossFire(e) {
    e.pattern++;
    if (e.pattern % 3 === 0) {
      const n = 14;
      for (let i = 0; i < n; i++) enemyBullet(e.x, e.y, (i / n) * Math.PI * 2 + e.t, 170);
    } else {
      const a = aimAt(e);
      for (const d of [-0.25, 0, 0.25]) enemyBullet(e.x, e.y + e.r * 0.6, a + d, 260);
    }
  }

  function damageEnemy(e, dmg) {
    if (e.dead) return;
    e.hp -= dmg;
    e.flash = 0.08;
    if (e.hp > 0) {
      sfx.hit();
      return;
    }
    e.dead = true;
    score += e.score;
    addFloater(`+${e.score}`, e.x, e.y, e.color);

    if (e.type === 'boss') {
      explode(e.x, e.y, e.color, 140, 360);
      explode(e.x, e.y, '#ffffff', 60, 220);
      shake = 22;
      sfx.bigBoom();
      for (let i = 0; i < 3; i++) dropPowerup(e.x + (i - 1) * 40, e.y);
    } else {
      explode(e.x, e.y, e.color, Math.round(e.r * 1.6));
      sfx.boom();
      if (Math.random() < 0.12) dropPowerup(e.x, e.y);
    }
  }

  function hurtPlayer() {
    if (player.invuln > 0 || player.lives <= 0) return;

    if (player.shield > 0) {
      player.shield = 0;
      player.invuln = 0.6;
      explode(player.x, player.y, POWERUPS.shield.color, 24);
      sfx.shieldBreak();
      return;
    }

    player.lives--;
    shake = 14;
    explode(player.x, player.y, '#ffffff', 45, 260);
    explode(player.x, player.y, '#4ecbff', 30);
    sfx.hurt();

    if (player.lives <= 0) {
      gameOver();
      return;
    }
    player.invuln = 2;
    player.triple = 0;
    player.rapid = 0;
  }

  function applyPowerup(p) {
    const info = POWERUPS[p.type];
    if (p.type === 'life') player.lives = Math.min(MAX_LIVES, player.lives + 1);
    else player[p.type] = info.time;
    addFloater(info.name, p.x, p.y, info.color);
    sfx.power();
  }

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------
  function explode(x, y, color, count, power = 180) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(power * 0.2, power);
      const life = rand(0.35, 0.9);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: rand(1.5, 3.5) });
    }
  }

  function addFloater(text, x, y, color) {
    floaters.push({ text, x, y, color, life: 1 });
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function updateEnemy(e, dt) {
    e.t += dt;
    if (e.flash > 0) e.flash -= dt;

    if (e.type === 'boss') {
      if (e.y < 130) {
        e.y += 70 * dt;
      } else {
        e.entering = false;
        e.x = W / 2 + Math.sin(e.t * 0.7) * (W / 2 - 70);
      }
      if (!e.entering) {
        e.fireCd -= dt;
        if (e.fireCd <= 0) {
          bossFire(e);
          e.fireCd = Math.max(0.5, 1.4 - level * 0.03);
        }
      }
      return;
    }

    e.y += e.speed * dt;
    if (e.type === 'scout') e.x = e.baseX + Math.sin(e.t * 3 + e.phase) * 35;
    else if (e.type === 'fighter') e.x = e.baseX + Math.sin(e.t * 1.5 + e.phase) * 80;
    e.x = clamp(e.x, e.r, W - e.r);

    if (e.fire > 0 && e.y > 0 && e.y < H * 0.7) {
      e.fireCd -= dt;
      if (e.fireCd <= 0) {
        enemyShoot(e);
        e.fireCd = rand(1.2, 2.6) / e.fire;
      }
    }

    if (e.y > H + e.r) e.dead = true;
  }

  function updatePlayer(dt) {
    if (pointer.active) {
      // Follow the finger, slightly above it so the ship stays visible
      const k = Math.min(1, dt * 12);
      player.x += (pointer.x - player.x) * k;
      player.y += (pointer.y - 70 - player.y) * k;
    } else {
      let dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      let dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
      if (dx && dy) {
        dx *= Math.SQRT1_2;
        dy *= Math.SQRT1_2;
      }
      player.x += dx * player.speed * dt;
      player.y += dy * player.speed * dt;
    }
    player.x = clamp(player.x, player.r, W - player.r);
    player.y = clamp(player.y, H * 0.45, H - 30);

    player.cd -= dt;
    player.invuln = Math.max(0, player.invuln - dt);
    player.shield = Math.max(0, player.shield - dt);
    player.triple = Math.max(0, player.triple - dt);
    player.rapid = Math.max(0, player.rapid - dt);

    if ((keys.fire || pointer.active) && player.cd <= 0) playerShoot();
  }

  function update(dt) {
    const starSpeed = state === 'playing' ? 1 : 0.35;
    for (const s of stars) {
      s.y += s.v * dt * starSpeed;
      if (s.y > H) {
        s.y = 0;
        s.x = rand(0, W);
      }
    }

    // Effects keep animating on the game-over screen
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.life -= dt;
    }
    for (const f of floaters) {
      f.y -= 40 * dt;
      f.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
    floaters = floaters.filter((f) => f.life > 0);
    if (shake > 0) shake = Math.max(0, shake - 40 * dt);

    if (state !== 'playing') return;

    updatePlayer(dt);

    // Spawning
    if (spawnLeft > 0) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnEnemy();
        spawnLeft--;
        spawnTimer = Math.max(0.25, 1.1 - level * 0.06) * rand(0.6, 1.3);
      }
    }

    for (const e of enemies) updateEnemy(e, dt);

    for (const b of bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < -20 || b.y > H + 20 || b.x < -20 || b.x > W + 20) b.dead = true;
    }

    for (const p of powerups) {
      p.t += dt;
      p.y += 100 * dt;
      if (p.y > H + 20) p.dead = true;
    }

    // Collisions
    for (const b of bullets) {
      if (b.dead) continue;
      if (b.enemy) {
        if (hit(b, player)) {
          b.dead = true;
          hurtPlayer();
        }
      } else {
        for (const e of enemies) {
          if (!e.dead && hit(b, e)) {
            b.dead = true;
            damageEnemy(e, 1);
            break;
          }
        }
      }
    }

    for (const e of enemies) {
      if (!e.dead && hit(e, player)) {
        if (e.type !== 'boss') damageEnemy(e, 99);
        hurtPlayer();
      }
    }

    for (const p of powerups) {
      if (!p.dead && hit(p, player)) {
        p.dead = true;
        applyPowerup(p);
      }
    }

    bullets = bullets.filter((b) => !b.dead);
    enemies = enemies.filter((e) => !e.dead);
    powerups = powerups.filter((p) => !p.dead);

    if (bannerTimer > 0) bannerTimer -= dt;

    if (state === 'playing' && spawnLeft === 0 && enemies.length === 0) nextLevel();
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------
  function drawShipShape(scale = 1) {
    ctx.beginPath();
    ctx.moveTo(0, -20 * scale);
    ctx.lineTo(16 * scale, 16 * scale);
    ctx.lineTo(6 * scale, 10 * scale);
    ctx.lineTo(-6 * scale, 10 * scale);
    ctx.lineTo(-16 * scale, 16 * scale);
    ctx.closePath();
  }

  function drawPlayer() {
    if (!player || player.lives <= 0) return;
    const { x, y } = player;

    if (player.shield > 0) {
      const flicker = player.shield < 2 && Math.floor(player.shield * 8) % 2 === 0;
      if (!flicker) {
        ctx.save();
        ctx.strokeStyle = POWERUPS.shield.color;
        ctx.lineWidth = 2;
        ctx.shadowColor = POWERUPS.shield.color;
        ctx.shadowBlur = 16;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(x, y, 28, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (player.invuln > 0 && Math.floor(player.invuln * 15) % 2 === 0) return;

    ctx.save();
    ctx.translate(x, y);

    const flame = 10 + Math.random() * 10;
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.moveTo(-6, 12);
    ctx.lineTo(0, 12 + flame);
    ctx.lineTo(6, 12);
    ctx.fill();

    ctx.shadowColor = '#4ecbff';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#e8f6ff';
    drawShipShape();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#4ecbff';
    ctx.beginPath();
    ctx.ellipse(0, -2, 4, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawEnemy(e) {
    const r = e.r;
    const col = e.flash > 0 ? '#ffffff' : e.color;

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = col;
    ctx.shadowColor = e.color;
    ctx.shadowBlur = e.type === 'boss' ? 26 : 14;
    ctx.beginPath();

    if (e.type === 'scout') {
      ctx.moveTo(0, r);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, -r * 0.7);
      ctx.lineTo(-r, 0);
    } else if (e.type === 'fighter') {
      ctx.moveTo(0, r);
      ctx.lineTo(r, -r * 0.6);
      ctx.lineTo(r * 0.35, -r * 0.2);
      ctx.lineTo(0, -r * 0.8);
      ctx.lineTo(-r * 0.35, -r * 0.2);
      ctx.lineTo(-r, -r * 0.6);
    } else if (e.type === 'tank') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + e.t * 0.6;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
    } else {
      ctx.moveTo(0, r);
      ctx.lineTo(r * 0.55, r * 0.45);
      ctx.lineTo(r, r * 0.1);
      ctx.lineTo(r * 0.85, -r * 0.6);
      ctx.lineTo(r * 0.3, -r * 0.35);
      ctx.lineTo(0, -r * 0.8);
      ctx.lineTo(-r * 0.3, -r * 0.35);
      ctx.lineTo(-r * 0.85, -r * 0.6);
      ctx.lineTo(-r, r * 0.1);
      ctx.lineTo(-r * 0.55, r * 0.45);
    }
    ctx.closePath();
    ctx.fill();

    // Core / eye
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#05060f';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(0, r * 0.05, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Small health bar for damaged tougher enemies
    if (e.type !== 'boss' && e.maxHp > 1 && e.hp < e.maxHp) {
      const w = r * 1.8;
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(e.x - w / 2, e.y - r - 10, w, 3);
      ctx.fillStyle = e.color;
      ctx.fillRect(e.x - w / 2, e.y - r - 10, w * (e.hp / e.maxHp), 3);
    }
  }

  function drawBullets() {
    for (const b of bullets) {
      if (b.enemy) {
        ctx.fillStyle = '#ff6b8b';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffd6de';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#7fe9ff';
        ctx.fillRect(b.x - 2, b.y - 9, 4, 18);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(b.x - 1, b.y - 7, 2, 12);
      }
    }
  }

  function drawPowerups() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `10px ${FONT}`;
    for (const p of powerups) {
      const info = POWERUPS[p.type];
      const pulse = 1 + Math.sin(p.t * 6) * 0.08;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(pulse, pulse);
      ctx.strokeStyle = info.color;
      ctx.fillStyle = 'rgba(5,6,15,0.7)';
      ctx.lineWidth = 2;
      ctx.shadowColor = info.color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(0, 0, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = info.color;
      ctx.fillText(info.label, 1, 1);
      ctx.restore();
    }
  }

  function drawEffects() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `10px ${FONT}`;
    for (const f of floaters) {
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawHUD() {
    ctx.textBaseline = 'top';
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = '#e8f6ff';
    ctx.textAlign = 'left';
    ctx.fillText(`${score}`, 14, 14);
    ctx.font = `8px ${FONT}`;
    ctx.fillStyle = '#9aa4c7';
    ctx.fillText('SCORE', 14, 34);

    ctx.textAlign = 'center';
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = '#e8f6ff';
    ctx.fillText(`LV ${level}`, W / 2, 16);

    ctx.textAlign = 'right';
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = '#ffe066';
    ctx.fillText(`${Math.max(best, score)}`, W - 14, 14);
    ctx.font = `8px ${FONT}`;
    ctx.fillStyle = '#9aa4c7';
    ctx.fillText('BEST', W - 14, 34);

    // Lives
    for (let i = 0; i < player.lives; i++) {
      ctx.save();
      ctx.translate(22 + i * 24, H - 24);
      ctx.fillStyle = '#e8f6ff';
      drawShipShape(0.5);
      ctx.fill();
      ctx.restore();
    }

    // Active power-up timers
    let row = 0;
    for (const key of ['triple', 'rapid', 'shield']) {
      const time = player[key];
      if (time <= 0) continue;
      const info = POWERUPS[key];
      const y = H - 52 - row * 16;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(14, y, 90, 5);
      ctx.fillStyle = info.color;
      ctx.fillRect(14, y, 90 * (time / info.time), 5);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `7px ${FONT}`;
      ctx.fillText(info.name, 110, y + 3);
      row++;
    }

    // Boss health
    if (boss && !boss.dead) {
      const w = W - 28;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(14, 56, w, 8);
      ctx.fillStyle = boss.color;
      ctx.fillRect(14, 56, w * Math.max(0, boss.hp / boss.maxHp), 8);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = `7px ${FONT}`;
      ctx.fillStyle = '#e8f6ff';
      ctx.fillText('MOTHERSHIP', W / 2, 70);
    }
  }

  function drawBanner() {
    if (bannerTimer <= 0) return;
    const alpha = Math.min(1, bannerTimer * 1.5);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `22px ${FONT}`;
    const isBoss = bannerText.startsWith('BOSS');
    ctx.fillStyle = isBoss ? '#ff5e7a' : '#4ecbff';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 20;
    ctx.fillText(bannerText, W / 2, H * 0.4);
    ctx.restore();
  }

  function draw() {
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = nebula;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#ffffff';
    for (const s of stars) {
      ctx.globalAlpha = 0.25 + s.s * 0.3;
      ctx.fillRect(s.x, s.y, s.s, s.s * (1 + s.s));
    }
    ctx.globalAlpha = 1;

    if (state === 'menu') return;

    ctx.save();
    if (shake > 0) ctx.translate(rand(-shake, shake) * 0.5, rand(-shake, shake) * 0.5);
    drawPowerups();
    for (const e of enemies) drawEnemy(e);
    drawBullets();
    drawPlayer();
    drawEffects();
    ctx.restore();

    if (state === 'playing' || state === 'paused') {
      drawHUD();
      drawBanner();
    }
  }
})();
