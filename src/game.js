/* Bot Royale — third-person battle royale against bots, with building.

   Aiming is a ray from the camera through the crosshair, which is what makes a
   third-person shooter feel honest: what the crosshair covers is what gets hit,
   even though the camera sits behind your shoulder. */

(() => {
  const THREE = window.THREE;

  const GUNS = [
    { id: 'ar', name: 'Assault Rifle', mag: 30, damage: 17, pellets: 1, spread: 0.012,
      delay: 0.11, reload: 2.1, auto: true, range: 90, head: 1.8, rarity: 'Rare', colour: 0x3b82f6 },
    { id: 'shotgun', name: 'Pump Shotgun', mag: 5, damage: 11, pellets: 9, spread: 0.075,
      delay: 0.85, reload: 2.6, auto: false, range: 26, head: 1.4, rarity: 'Epic', colour: 0xa855f7 },
    { id: 'smg', name: 'SMG', mag: 35, damage: 11, pellets: 1, spread: 0.022,
      delay: 0.07, reload: 1.9, auto: true, range: 55, head: 1.5, rarity: 'Common', colour: 0x9ca3af },
    { id: 'sniper', name: 'Bolt Sniper', mag: 1, damage: 95, pellets: 1, spread: 0,
      delay: 1.5, reload: 2.4, auto: false, range: 200, head: 2.2, rarity: 'Legendary', colour: 0xf59e0b },
  ];

  const BOTS = 9;
  const EYE = 1.55;
  const RADIUS = 0.45;
  const WALK = 6.4;
  const SPRINT = 9.2;
  const JUMP = 9.4;
  const GRAVITY = 26;
  const MAX_PITCH = 1.2;

  /* Storm phases: wait, then shrink. Damage climbs as the match closes out. */
  const PHASES = [
    { wait: 26, shrink: 20, radius: 78, damage: 1 },
    { wait: 18, shrink: 18, radius: 54, damage: 2 },
    { wait: 14, shrink: 16, radius: 34, damage: 4 },
    { wait: 12, shrink: 14, radius: 18, damage: 7 },
    { wait: 10, shrink: 14, radius: 6, damage: 10 },
  ];

  /* ---------- Renderer ---------- */

  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;

  const coarse = window.matchMedia('(pointer: coarse)').matches;
  renderer.shadowMap.enabled = !coarse;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fc4e8);
  scene.fog = new THREE.Fog(0xa9d4ef, 90, 240);

  const camera = new THREE.PerspectiveCamera(74, 1, 0.1, 600);
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.05);
  sun.position.set(60, 90, 40);
  if (!coarse) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 1, far: 320 });
    sun.shadow.bias = -0.0012;
  }
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x4a6b3a, 0.75));

  /* storm dome */
  const stormMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 120, 48, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x7c5cff, transparent: true, opacity: 0.16, side: THREE.BackSide, depthWrite: false,
    }),
  );
  stormMesh.position.y = 60;
  scene.add(stormMesh);

  /* ---------- State ---------- */

  const player = {
    x: 0, z: 0, feetY: 0, vy: 0,
    yaw: 0, pitch: -0.12,
    health: 100, shield: 0,
    wood: 120,
    alive: true,
    grounded: true,
    slot: 0,                 // 0 pickaxe, 1..2 guns, 3 build
    guns: [null, null],
    ammo: [0, 0],
    reloading: 0,
    cooldown: 0,
    kills: 0,
    figure: null,
  };

  const storm = { x: 0, z: 0, radius: 130, target: 130, damage: 1, phase: 0, timer: PHASES[0].wait, shrinking: false };

  let mode = 'menu';
  let firing = false;
  let elapsed = 0;
  let lootMeshes = [];
  let lastEntry = null;
  let placement = BOTS + 1;
  let feedTimer = 0;
  const clock = new THREE.Clock();
  const rng = Math.random;

  /* ---------- Elements ---------- */

  const el = {};
  ['overlay', 'panel-title', 'panel-text', 'play', 'hud', 'health-fill', 'shield-fill',
    'health-text', 'shield-text', 'ammo', 'gun-name', 'wood', 'alive', 'kills', 'storm-timer',
    'storm-label', 'minimap', 'hotbar', 'reticle', 'hitmarker', 'hurt', 'feed', 'touch',
    'fire-btn', 'jump-btn', 'build-btn', 'reload-btn', 'player-name', 'board-list',
    'board-empty', 'board-clear', 'board-tally', 'stick', 'stick-knob', 'look-area',
  ].forEach((id) => { el[id] = document.getElementById(id); });
  const mapCtx = el.minimap.getContext('2d');

  /* ---------- Helpers ---------- */

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function feed(text, colour) {
    el.feed.textContent = text;
    el.feed.style.color = colour || '#e8ecf8';
    el.feed.classList.remove('hidden');
    feedTimer = 3;
  }

  /* ---------- Match setup ---------- */

  function newMatch() {
    Arena.dispose(scene);
    Bots.clear(scene);
    lootMeshes.forEach((m) => scene.remove(m));
    lootMeshes = [];

    Arena.build(THREE, scene, rng);
    Build.init(THREE, scene);
    Build.reset();

    /* the player's own body, seen over the shoulder */
    if (!player.figure) {
      player.figure = Figure.make(THREE, 0xef4444, 0xf8fafc);
      scene.add(player.figure);
    }
    player.figure.visible = true;

    const angle = rng() * Math.PI * 2;
    player.x = Math.cos(angle) * Arena.ARENA * 0.38;
    player.z = Math.sin(angle) * Arena.ARENA * 0.38;
    player.feetY = 0;
    player.vy = 0;
    player.yaw = Math.atan2(-player.x, -player.z);
    player.pitch = -0.12;
    player.health = 100;
    player.shield = 0;
    player.wood = 120;
    player.alive = true;
    player.slot = 0;
    player.guns = [null, null];
    player.ammo = [0, 0];
    player.kills = 0;
    player.reloading = 0;
    player.cooldown = 0;

    Bots.spawn(THREE, scene, BOTS, rng, GUNS);

    storm.x = (rng() - 0.5) * 30;
    storm.z = (rng() - 0.5) * 30;
    storm.radius = 130;
    storm.target = 130;
    storm.phase = 0;
    storm.timer = PHASES[0].wait;
    storm.shrinking = false;
    storm.damage = PHASES[0].damage;

    buildLootMeshes();
    placement = BOTS + 1;
    elapsed = 0;
    renderHotbar();
  }

  function buildLootMeshes() {
    const shapes = {
      weapon: () => new THREE.BoxGeometry(0.7, 0.24, 0.24),
      ammo: () => new THREE.BoxGeometry(0.4, 0.3, 0.3),
      potion: () => new THREE.CylinderGeometry(0.16, 0.2, 0.5, 8),
    };
    const colours = { weapon: 0x60a5fa, ammo: 0xfbbf24, potion: 0x34d399 };

    Arena.loot.forEach((item) => {
      const mesh = new THREE.Mesh(shapes[item.kind](), new THREE.MeshStandardMaterial({
        color: colours[item.kind], emissive: colours[item.kind], emissiveIntensity: 0.5, roughness: 0.4,
      }));
      const y = Arena.supportY(item.x, item.z, 40, 0.3);
      mesh.position.set(item.x, y + 0.6, item.z);
      mesh.castShadow = true;
      scene.add(mesh);
      lootMeshes.push(mesh);
      item.mesh = mesh;
    });
  }

  /* ---------- Player ---------- */

  function movePlayer(dt, input) {
    player.yaw -= input.look.x;
    player.pitch = clamp(player.pitch - input.look.y, -MAX_PITCH, MAX_PITCH);

    const speed = input.sprint ? SPRINT : WALK;
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    const vx = (-sin * input.y + cos * input.x) * speed;
    const vz = (-cos * input.y - sin * input.x) * speed;

    const stepX = vx * dt;
    const stepZ = vz * dt;
    if (!Arena.blocked(player.x + stepX, player.z, player.feetY, 1.8, RADIUS)) player.x += stepX;
    if (!Arena.blocked(player.x, player.z + stepZ, player.feetY, 1.8, RADIUS)) player.z += stepZ;
    player.x = clamp(player.x, -Arena.ARENA / 2 - 20, Arena.ARENA / 2 + 20);
    player.z = clamp(player.z, -Arena.ARENA / 2 - 20, Arena.ARENA / 2 + 20);

    /* gravity, and stepping up onto whatever is underfoot */
    const support = Arena.supportY(player.x, player.z, player.feetY, RADIUS);
    if (input.jump && player.grounded) {
      player.vy = JUMP;
      player.grounded = false;
    }
    player.vy -= GRAVITY * dt;
    player.feetY += player.vy * dt;
    if (player.feetY <= support) {
      player.feetY = support;
      player.vy = 0;
      player.grounded = true;
    } else {
      player.grounded = false;
    }

    /* the avatar stands where you are, facing where you look */
    player.figure.position.set(player.x, player.feetY, player.z);
    player.figure.rotation.y = player.yaw;
    Figure.animate(player.figure, dt, Math.hypot(vx, vz), player.slot === 1 || player.slot === 2);

    placeCamera();
  }

  /* Spring arm: sit behind and above, but pull in if a wall is in the way. */
  function placeCamera() {
    const distance = 5.4;
    const height = 2.5;
    const dirX = Math.sin(player.yaw) * Math.cos(player.pitch);
    const dirZ = Math.cos(player.yaw) * Math.cos(player.pitch);
    const dirY = -Math.sin(player.pitch);

    const focusY = player.feetY + EYE;
    let want = distance;
    for (let t = 0.5; t <= distance; t += 0.4) {
      const px = player.x + dirX * t;
      const py = focusY + height * (t / distance) + dirY * t;
      const pz = player.z + dirZ * t;
      if (Arena.boxes.some((b) => !b.dead
        && Math.abs(b.x - px) < b.hx + 0.3
        && Math.abs(b.y - py) < b.hy + 0.3
        && Math.abs(b.z - pz) < b.hz + 0.3)) {
        want = Math.max(1.6, t - 0.5);
        break;
      }
    }

    camera.position.set(
      player.x + dirX * want + Math.cos(player.yaw) * 0.7,
      focusY + height * (want / distance) + dirY * want,
      player.z + dirZ * want - Math.sin(player.yaw) * 0.7,
    );
    camera.lookAt(
      player.x - dirX * 6,
      focusY + 0.5 - Math.sin(player.pitch) * 6 * -1 - dirY * 0,
      player.z - dirZ * 6,
    );
    // aim straight down the look vector so the crosshair means something
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  }

  /* ---------- Shooting ---------- */

  const rayOrigin = new THREE.Vector3();
  const rayDir = new THREE.Vector3();

  function aimRay(spread) {
    camera.getWorldPosition(rayOrigin);
    camera.getWorldDirection(rayDir);
    if (spread) {
      rayDir.x += (Math.random() - 0.5) * 2 * spread;
      rayDir.y += (Math.random() - 0.5) * 2 * spread;
      rayDir.z += (Math.random() - 0.5) * 2 * spread;
      rayDir.normalize();
    }
    return { origin: rayOrigin, direction: rayDir };
  }

  /* Closest bot the ray passes through, tested as a capsule-ish box. */
  function botAlongRay(ray, range) {
    let best = null;
    let bestT = range;
    Bots.list.forEach((bot) => {
      if (!bot.alive) return;
      const box = { x: bot.x, y: bot.feetY + 1.1, z: bot.z, hx: 0.5, hy: 1.1, hz: 0.5 };
      const t = Arena.rayBox(ray.origin, ray.direction, box);
      if (t === null || t >= bestT) return;
      const headTop = bot.feetY + 2.25;
      const hitY = ray.origin.y + ray.direction.y * t;
      bestT = t;
      best = { bot, distance: t, headshot: hitY > headTop - 0.45 };
    });
    return best;
  }

  function shoot() {
    if (mode !== 'playing' || !player.alive) return;

    /* pickaxe: chop the world for wood */
    if (player.slot === 0) {
      if (player.cooldown > 0) return;
      player.cooldown = 0.42;
      Audio3D.blip('swing');
      const ray = aimRay(0);
      const hit = Arena.hitScan(ray.origin, ray.direction, 6);
      if (hit) {
        const wood = Arena.damageBox(hit.box, 40);
        if (wood) {
          player.wood += wood;
          feed(`+${wood} wood`, '#fbbf24');
        }
        if (hit.box.onDeath) hit.box.onDeath();
        flashHit(false);
      }
      const target = botAlongRay(ray, 4);
      if (target) hurtBot(target.bot, 30, false);
      return;
    }

    /* building */
    if (player.slot === 3) {
      const spent = Build.place(player, player.wood);
      if (spent) {
        player.wood -= spent;
        Audio3D.blip('build');
      }
      return;
    }

    const index = player.slot - 1;
    const gun = player.guns[index];
    if (!gun) return;
    if (player.cooldown > 0 || player.reloading > 0) return;
    if (player.ammo[index] <= 0) {
      startReload();
      Audio3D.blip('dry');
      return;
    }

    player.ammo[index] -= 1;
    player.cooldown = gun.delay;
    Audio3D.blip(gun.id === 'shotgun' ? 'boom' : 'shot');

    const tally = new Map();
    let head = false;
    for (let p = 0; p < gun.pellets; p++) {
      const ray = aimRay(gun.spread);
      const target = botAlongRay(ray, gun.range);
      const world = Arena.hitScan(ray.origin, ray.direction, gun.range);
      // whatever is nearer stops the shot
      if (target && (!world || target.distance < world.distance)) {
        const damage = gun.damage * (target.headshot ? gun.head : 1);
        tally.set(target.bot, (tally.get(target.bot) || 0) + damage);
        if (target.headshot) head = true;
      } else if (world) {
        Arena.damageBox(world.box, gun.damage);
        if (world.box.dead && world.box.onDeath) world.box.onDeath();
      }
    }

    if (tally.size) {
      flashHit(head);
      tally.forEach((damage, bot) => hurtBot(bot, damage, head));
    }
  }

  function hurtBot(bot, damage, headshot) {
    const before = bot.alive;
    Bots.hurt(bot, damage, null, onBotDown);
    Audio3D.blip(headshot ? 'headshot' : 'hit');
    if (before && !bot.alive) {
      player.kills += 1;
      feed(`You eliminated ${bot.name}`, '#4ade80');
    }
  }

  function onBotDown(bot, from) {
    const left = Bots.alive().length + (player.alive ? 1 : 0);
    if (from) feed(`${from.name} eliminated ${bot.name}`, '#cbd5e1');
    if (left === 1 && player.alive) finish(true);
  }

  function startReload() {
    const index = player.slot - 1;
    const gun = player.guns[index];
    if (!gun || player.reloading > 0 || player.ammo[index] === gun.mag) return;
    player.reloading = gun.reload;
    Audio3D.blip('reload');
  }

  function flashHit(headshot) {
    el.hitmarker.classList.toggle('head', headshot);
    el.hitmarker.classList.remove('hidden');
    clearTimeout(flashHit.timer);
    flashHit.timer = setTimeout(() => el.hitmarker.classList.add('hidden'), 130);
  }

  /* ---------- Loot ---------- */

  function pickups() {
    Arena.loot.forEach((item) => {
      if (item.taken || !item.mesh) return;
      item.mesh.rotation.y += 0.03;
      if (Math.hypot(item.x - player.x, item.z - player.z) > 1.6) return;
      if (Math.abs(item.mesh.position.y - player.feetY) > 3) return;

      if (item.kind === 'weapon') {
        const gun = GUNS[Math.floor(Math.random() * GUNS.length)];
        const empty = player.guns.indexOf(null);
        const slot = empty >= 0 ? empty : Math.max(0, player.slot - 1);
        player.guns[slot] = gun;
        player.ammo[slot] = gun.mag;
        player.slot = slot + 1;
        feed(`Picked up ${gun.name} · ${gun.rarity}`, '#93c5fd');
        renderHotbar();
      } else if (item.kind === 'ammo') {
        player.ammo = player.ammo.map((a, i) => (player.guns[i] ? player.guns[i].mag : a));
        feed('Ammo topped up', '#fbbf24');
      } else {
        player.shield = Math.min(100, player.shield + 50);
        feed('+50 shield', '#38bdf8');
      }

      item.taken = true;
      scene.remove(item.mesh);
      Audio3D.blip('pickup');
    });
  }

  /* ---------- Storm ---------- */

  function updateStorm(dt) {
    const phase = PHASES[Math.min(storm.phase, PHASES.length - 1)];
    storm.timer -= dt;

    if (!storm.shrinking) {
      if (storm.timer <= 0) {
        storm.shrinking = true;
        storm.timer = phase.shrink;
        storm.target = phase.radius;
        // the next circle drifts, so camping the middle is not automatic
        storm.x += (Math.random() - 0.5) * storm.radius * 0.35;
        storm.z += (Math.random() - 0.5) * storm.radius * 0.35;
        feed('The storm is closing', '#c4b5fd');
      }
    } else {
      storm.radius += (storm.target - storm.radius) * Math.min(1, dt / Math.max(0.5, storm.timer));
      if (storm.timer <= 0) {
        storm.shrinking = false;
        storm.radius = storm.target;
        storm.phase = Math.min(storm.phase + 1, PHASES.length - 1);
        storm.timer = PHASES[storm.phase].wait;
        storm.damage = PHASES[storm.phase].damage;
      }
    }

    stormMesh.position.set(storm.x, 60, storm.z);
    stormMesh.scale.set(storm.radius, 1, storm.radius);

    const gap = Math.hypot(player.x - storm.x, player.z - storm.z);
    const outside = gap > storm.radius;
    el.hurt.classList.toggle('storm', outside);
    if (outside && player.alive) {
      player.health -= storm.damage * dt;
      if (player.health <= 0) {
        player.health = 0;
        finish(false, 'the storm');
      }
    }
    return outside;
  }

  /* ---------- Damage to the player ---------- */

  function hurtPlayer(amount, from) {
    if (!player.alive || mode !== 'playing') return;
    let left = amount;
    if (player.shield > 0) {
      const absorbed = Math.min(player.shield, left);
      player.shield -= absorbed;
      left -= absorbed;
    }
    player.health -= left;
    el.hurt.classList.add('flash');
    setTimeout(() => el.hurt.classList.remove('flash'), 180);
    if (player.health <= 0) {
      player.health = 0;
      finish(false, from ? from.name : null);
    }
  }

  /* ---------- Flow ---------- */

  function finish(won, killedBy) {
    if (mode !== 'playing') return;
    mode = 'over';
    player.alive = false;
    placement = won ? 1 : Bots.alive().length + 1;

    lastEntry = Stats.record(placement, player.kills, elapsed, won);
    if (document.exitPointerLock) document.exitPointerLock();
    Build.hidePreview();

    el['panel-title'].textContent = won ? '🏆 Victory Royale!' : `#${placement} of ${BOTS + 1}`;
    el['panel-text'].innerHTML = won
      ? `Last one standing with <b>${player.kills}</b> elimination${player.kills === 1 ? '' : 's'} in ${fmt(elapsed)}.`
      : `Eliminated${killedBy ? ` by <b>${killedBy}</b>` : ''} with <b>${player.kills}</b> elimination${player.kills === 1 ? '' : 's'}.`;
    el.play.textContent = 'Drop again';
    el.overlay.classList.remove('hidden');
    el.overlay.classList.toggle('win', won);
    el.hud.classList.add('hidden');
    el.touch.classList.add('hidden');
    Audio3D.blip(won ? 'win' : 'lose');
    renderBoard();
  }

  function start() {
    Audio3D.init();
    Audio3D.resume();
    newMatch();
    mode = 'playing';
    el.overlay.classList.add('hidden');
    el.overlay.classList.remove('win');
    el.hud.classList.remove('hidden');
    el.touch.classList.toggle('hidden', !coarse);
    el.feed.classList.add('hidden');
    firing = false;
    if (!coarse) Controls.requestLock();
    clock.getDelta();
    feed('Drop in. Loot, build, survive.', '#e8ecf8');
  }

  function pause() {
    if (mode !== 'playing') return;
    mode = 'paused';
    el['panel-title'].textContent = 'Paused';
    el['panel-text'].textContent = 'The storm waits for no one.';
    el.play.textContent = 'Resume';
    el.overlay.classList.remove('hidden');
  }

  function resume() {
    mode = 'playing';
    el.overlay.classList.add('hidden');
    if (!coarse) Controls.requestLock();
    clock.getDelta();
  }

  /* ---------- HUD ---------- */

  function renderHotbar() {
    const names = ['Pickaxe', player.guns[0] ? player.guns[0].name : '—',
      player.guns[1] ? player.guns[1].name : '—', 'Build'];
    el.hotbar.querySelectorAll('.slot').forEach((slot, i) => {
      slot.classList.toggle('on', i === player.slot);
      slot.querySelector('.slot__name').textContent = names[i];
    });
  }

  function renderHud() {
    el['health-fill'].style.width = `${player.health}%`;
    el['shield-fill'].style.width = `${player.shield}%`;
    el['health-text'].textContent = Math.ceil(player.health);
    el['shield-text'].textContent = Math.ceil(player.shield);
    el.wood.textContent = player.wood;
    el.alive.textContent = Bots.alive().length + (player.alive ? 1 : 0);
    el.kills.textContent = player.kills;
    el['storm-timer'].textContent = fmt(Math.max(0, storm.timer));
    el['storm-label'].textContent = storm.shrinking ? 'Closing' : 'Next circle';

    if (player.slot === 3) {
      el['gun-name'].textContent = `${Build.piece} · ${Build.cost()} wood`;
      el.ammo.textContent = '—';
    } else if (player.slot === 0) {
      el['gun-name'].textContent = 'Pickaxe';
      el.ammo.textContent = '∞';
    } else {
      const gun = player.guns[player.slot - 1];
      el['gun-name'].textContent = gun ? gun.name : 'Empty';
      el.ammo.textContent = !gun ? '—'
        : player.reloading > 0 ? 'RELOADING' : `${player.ammo[player.slot - 1]} / ${gun.mag}`;
    }
  }

  function renderMinimap() {
    const size = el.minimap.width;
    const scale = size / (Arena.ARENA + 40);
    const toMap = (v) => size / 2 + v * scale;

    mapCtx.clearRect(0, 0, size, size);
    mapCtx.fillStyle = '#20361f';
    mapCtx.fillRect(0, 0, size, size);

    mapCtx.strokeStyle = 'rgba(124,92,255,0.9)';
    mapCtx.lineWidth = 2;
    mapCtx.beginPath();
    mapCtx.arc(toMap(storm.x), toMap(storm.z), storm.radius * scale, 0, Math.PI * 2);
    mapCtx.stroke();

    mapCtx.fillStyle = 'rgba(185,161,124,0.8)';
    Arena.boxes.forEach((b) => {
      if (b.dead || b.kind !== 'roof') return;
      mapCtx.fillRect(toMap(b.x - b.hx), toMap(b.z - b.hz), b.hx * 2 * scale, b.hz * 2 * scale);
    });

    mapCtx.fillStyle = '#f87171';
    Bots.list.forEach((bot) => {
      if (!bot.alive) return;
      if (Math.hypot(bot.x - player.x, bot.z - player.z) > 55) return;
      mapCtx.beginPath();
      mapCtx.arc(toMap(bot.x), toMap(bot.z), 2.5, 0, Math.PI * 2);
      mapCtx.fill();
    });

    mapCtx.save();
    mapCtx.translate(toMap(player.x), toMap(player.z));
    mapCtx.rotate(-player.yaw);
    mapCtx.fillStyle = '#fbbf24';
    mapCtx.beginPath();
    mapCtx.moveTo(0, -5);
    mapCtx.lineTo(3.5, 4);
    mapCtx.lineTo(-3.5, 4);
    mapCtx.closePath();
    mapCtx.fill();
    mapCtx.restore();
  }

  function renderBoard() {
    const runs = Stats.top();
    el['board-list'].textContent = '';
    el['board-empty'].classList.toggle('hidden', runs.length > 0);
    el['board-tally'].textContent = Stats.data.matches
      ? `${Stats.data.matches} matches · ${Stats.data.wins} wins · best #${Stats.data.best}`
      : '';

    runs.forEach((run, i) => {
      const row = document.createElement('li');
      row.className = 'row';
      if (run === lastEntry) row.classList.add('row--new');
      row.innerHTML = `<span class="row__rank">${i + 1}</span>
        <span class="row__who"></span>
        <span class="row__kills">${run.kills} elim</span>
        <span class="row__place">${run.won ? '🏆' : `#${run.placement}`}</span>`;
      row.querySelector('.row__who').textContent = run.name || 'Player';
      el['board-list'].appendChild(row);
    });
    el['player-name'].value = Stats.name;
  }

  /* ---------- Loop ---------- */

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());

    if (mode === 'playing') {
      elapsed += dt;
      const input = Controls.sample();
      movePlayer(dt, input);

      player.cooldown = Math.max(0, player.cooldown - dt);
      if (player.reloading > 0) {
        player.reloading -= dt;
        if (player.reloading <= 0) {
          player.reloading = 0;
          const index = player.slot - 1;
          if (player.guns[index]) player.ammo[index] = player.guns[index].mag;
        }
      }

      const gun = player.slot >= 1 && player.slot <= 2 ? player.guns[player.slot - 1] : null;
      if (firing && gun && gun.auto) shoot();

      if (player.slot === 3) Build.preview(player, player.wood);
      else Build.hidePreview();

      Bots.update(dt, {
        player, storm,
        onShotAtPlayer: hurtPlayer,
        onBotDown,
        onBotFire: () => {},
      });

      pickups();
      updateStorm(dt);
      renderHud();
      renderMinimap();

      if (feedTimer > 0) {
        feedTimer -= dt;
        if (feedTimer <= 0) el.feed.classList.add('hidden');
      }
    }

    renderer.render(scene, camera);
  }

  /* ---------- Input ---------- */

  Controls.init(canvas, el);
  Controls.onLockChange = (locked) => {
    if (!locked && mode === 'playing' && !coarse) pause();
  };

  el.play.addEventListener('click', () => (mode === 'paused' ? resume() : start()));

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Escape' && mode === 'playing') pause();
    if (mode !== 'playing') return;
    const slot = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(event.code);
    if (slot >= 0) { player.slot = slot; renderHotbar(); }
    if (event.code === 'KeyR') startReload();
    if (event.code === 'KeyQ') { player.slot = 3; renderHotbar(); }
    if (event.code === 'KeyF' && player.slot === 3) Build.cycle(1);
  });

  canvas.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || mode !== 'playing' || !Controls.locked) return;
    firing = true;
    shoot();
  });
  window.addEventListener('mouseup', () => { firing = false; });
  canvas.addEventListener('wheel', (event) => {
    if (mode !== 'playing' || player.slot !== 3) return;
    Build.cycle(event.deltaY > 0 ? 1 : -1);
  }, { passive: true });

  el['fire-btn'].addEventListener('pointerdown', (e) => { e.preventDefault(); firing = true; shoot(); });
  el['fire-btn'].addEventListener('pointerup', () => { firing = false; });
  el['fire-btn'].addEventListener('pointercancel', () => { firing = false; });
  el['jump-btn'].addEventListener('pointerdown', (e) => { e.preventDefault(); Controls.tapJump(); });
  el['reload-btn'].addEventListener('pointerdown', (e) => { e.preventDefault(); startReload(); });
  el['build-btn'].addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (player.slot === 3) Build.cycle(1);
    else { player.slot = 3; renderHotbar(); }
  });

  el.hotbar.querySelectorAll('.slot').forEach((slot, i) => {
    slot.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (mode !== 'playing') return;
      player.slot = i;
      renderHotbar();
    });
  });

  el['player-name'].addEventListener('change', () => {
    Stats.rename(lastEntry, el['player-name'].value);
    renderBoard();
  });
  el['player-name'].addEventListener('keydown', (e) => e.stopPropagation());

  el['board-clear'].addEventListener('click', () => {
    if (el['board-clear'].dataset.armed) {
      Stats.clear();
      lastEntry = null;
      delete el['board-clear'].dataset.armed;
      el['board-clear'].textContent = 'Clear';
      renderBoard();
      return;
    }
    el['board-clear'].dataset.armed = '1';
    el['board-clear'].textContent = 'Sure?';
    setTimeout(() => {
      delete el['board-clear'].dataset.armed;
      el['board-clear'].textContent = 'Clear';
    }, 2500);
  });

  window.addEventListener('resize', resize);
  resize();
  Stats.load();
  renderBoard();
  frame();
})();
