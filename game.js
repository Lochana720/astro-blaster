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
})();
