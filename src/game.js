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
  /* Filmic tone mapping rolls off highlights instead of clipping them to
     white, which is most of what separates "lit" from "photographed". */
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.physicallyCorrectLights = false;

  const coarse = window.matchMedia('(pointer: coarse)').matches;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9cc9ea);
  // fog tinted to the sky it fades into, pushed back so the horizon survives
  scene.fog = new THREE.Fog(0xbcd9ef, 130, 400);

  const camera = new THREE.PerspectiveCamera(74, 1, 0.1, 900);

  /* Late-afternoon sun: low, warm, long shadows. */
  const sun = new THREE.DirectionalLight(0xffe9c4, 1.25);
  sun.position.set(-70, 78, 52);
  sun.castShadow = true;
  sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 1, far: 340 });
  sun.shadow.bias = -0.0009;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);

  /* Sky bounce from above, warm ground bounce from below. */
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x5b7a44, 0.62));
  const fill = new THREE.DirectionalLight(0xa8c8ff, 0.28);
  fill.position.set(60, 40, -70);
  scene.add(fill);

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
    'builds', 'compass-tape', 'xp-level', 'xp-fill', 'xp-note', 'career-wins',
    'career', 'help', 'tab-career', 'tab-help', 'skins', 'result',
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

    /* the player's own body, seen over the shoulder, in the chosen outfit */
    if (player.figure) scene.remove(player.figure);
    const skin = Lobby.current;
    player.figure = Figure.make(THREE, skin.body, skin.trim);
    player.figure.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(player.figure);

    const angle = rng() * Math.PI * 2;
    player.x = Math.cos(angle) * Arena.ARENA * 0.38;
    player.z = Math.sin(angle) * Arena.ARENA * 0.38;
    /* Drop in from height: you glide down and pick your landing spot, and the
       storm clock does not start until your feet are on the ground. */
    player.feetY = 78;
    player.vy = 0;
    player.dropping = true;
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
    planNextCircle();

    buildLootMeshes();
    placement = BOTS + 1;
    elapsed = 0;
    renderHotbar();
  }

  const RARITY = {
    Common: 0x9ca3af, Rare: 0x3b82f6, Epic: 0xa855f7, Legendary: 0xf59e0b,
  };

  function buildLootMeshes() {
    const shapes = {
      weapon: () => new THREE.BoxGeometry(0.7, 0.24, 0.24),
      ammo: () => new THREE.BoxGeometry(0.4, 0.3, 0.3),
      potion: () => new THREE.CylinderGeometry(0.16, 0.2, 0.5, 8),
      medkit: () => new THREE.BoxGeometry(0.44, 0.32, 0.3),
    };
    const colours = { weapon: 0x60a5fa, ammo: 0xfbbf24, potion: 0x38bdf8, medkit: 0xf87171 };

    Arena.loot.forEach((item) => {
      /* A weapon's rarity is decided where it lies, so its glow on the ground
         tells you whether it is worth the walk. */
      if (item.kind === 'weapon' && !item.gun) {
        item.gun = GUNS[Math.floor(Math.random() * GUNS.length)];
      }
      const tint = item.kind === 'weapon' ? RARITY[item.gun.rarity] : colours[item.kind];
      const mesh = new THREE.Mesh(shapes[item.kind](), new THREE.MeshStandardMaterial({
        color: tint, emissive: tint, emissiveIntensity: 0.6, roughness: 0.4,
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

    const gliding = player.dropping;
    const speed = gliding ? 17 : (input.sprint ? SPRINT : WALK);
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    const vx = (-sin * input.y + cos * input.x) * speed;
    const vz = (-cos * input.y - sin * input.x) * speed;

    const stepX = vx * dt;
    const stepZ = vz * dt;
    if (gliding || !Arena.blocked(player.x + stepX, player.z, player.feetY, 1.8, RADIUS)) player.x += stepX;
    if (gliding || !Arena.blocked(player.x, player.z + stepZ, player.feetY, 1.8, RADIUS)) player.z += stepZ;
    player.x = clamp(player.x, -Arena.ARENA / 2 - 20, Arena.ARENA / 2 + 20);
    player.z = clamp(player.z, -Arena.ARENA / 2 - 20, Arena.ARENA / 2 + 20);

    /* gravity, and stepping up onto whatever is underfoot */
    const support = Arena.supportY(player.x, player.z, player.feetY, RADIUS);

    if (gliding) {
      // a glider fall: steady, steerable, and it ends the moment you touch down
      player.feetY -= 15 * dt;
      if (player.feetY <= support) {
        player.feetY = support;
        player.dropping = false;
        player.vy = 0;
        player.grounded = true;
        Audio3D.blip('pickup');
        feed('Landed — find a weapon', '#e8ecf8');
      }
    } else {
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
        const gun = item.gun;
        const empty = player.guns.indexOf(null);
        const slot = empty >= 0 ? empty : Math.max(0, player.slot - 1);
        player.guns[slot] = gun;
        player.ammo[slot] = gun.mag;
        player.slot = slot + 1;
        feed(`${gun.rarity} ${gun.name}`, `#${RARITY[gun.rarity].toString(16).padStart(6, '0')}`);
        renderHotbar();
      } else if (item.kind === 'ammo') {
        player.ammo = player.ammo.map((a, i) => (player.guns[i] ? player.guns[i].mag : a));
        feed('Ammo topped up', '#fbbf24');
      } else if (item.kind === 'medkit') {
        player.health = Math.min(100, player.health + 50);
        feed('+50 health', '#f87171');
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

  /* Decide where the next circle will be, so it can be shown in advance. */
  function planNextCircle() {
    const phase = PHASES[Math.min(storm.phase, PHASES.length - 1)];
    storm.nextRadius = phase.radius;
    storm.nextX = storm.x + (Math.random() - 0.5) * storm.radius * 0.35;
    storm.nextZ = storm.z + (Math.random() - 0.5) * storm.radius * 0.35;
  }

  function updateStorm(dt) {
    /* The clock is frozen until you land, so the drop is never a punishment. */
    if (player.dropping) {
      el['storm-label'].textContent = 'Dropping';
      el['storm-timer'].textContent = `${Math.ceil(player.feetY)}m`;
      return false;
    }

    const phase = PHASES[Math.min(storm.phase, PHASES.length - 1)];
    storm.timer -= dt;

    if (!storm.shrinking) {
      if (storm.timer <= 0) {
        storm.shrinking = true;
        storm.timer = phase.shrink;
        storm.target = storm.nextRadius;
        storm.x = storm.nextX;
        storm.z = storm.nextZ;
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
        planNextCircle();
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
    renderCareer();
    showTab('career');
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
    /* the build row lights up only while building, and marks the live piece */
    el.builds.style.opacity = player.slot === 3 ? '1' : '0.45';
    el.builds.querySelectorAll('.bpiece').forEach((piece, i) => {
      piece.classList.toggle('on', player.slot === 3 && Build.selected === i);
    });
  }

  /* Career level from lifetime matches and eliminations. */
  function renderCareer() {
    const runs = Stats.top();
    const elims = runs.reduce((sum, r) => sum + r.kills, 0);
    const points = Stats.data.matches * 12 + Stats.data.wins * 40 + elims * 4;
    const level = Math.max(1, Math.floor(points / 100) + 1);
    const into = points % 100;
    el['xp-level'].textContent = level;
    el['xp-fill'].style.width = `${into}%`;
    el['xp-note'].textContent = `${Stats.data.wins} win${Stats.data.wins === 1 ? '' : 's'} · ${Stats.data.matches} matches`;
    el['career-wins'].textContent = Stats.data.wins;
  }

  /* A rolling compass tape, so the map has a heading like a real HUD. */
  const HEADINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function renderCompass() {
    // yaw 0 faces -Z, which is north
    let deg = (-player.yaw * 180 / Math.PI) % 360;
    if (deg < 0) deg += 360;
    const index = Math.round(deg / 45) % 8;
    el['compass-tape'].textContent = HEADINGS[index];
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

    /* where the storm is headed, so you can rotate before it moves */
    if (!storm.shrinking && storm.nextRadius) {
      mapCtx.strokeStyle = 'rgba(255,255,255,0.75)';
      mapCtx.lineWidth = 1.5;
      mapCtx.setLineDash([4, 4]);
      mapCtx.beginPath();
      mapCtx.arc(toMap(storm.nextX), toMap(storm.nextZ), storm.nextRadius * scale, 0, Math.PI * 2);
      mapCtx.stroke();
      mapCtx.setLineDash([]);
    }

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
    Lobby.resize(window.innerWidth, window.innerHeight);
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
      renderCompass();

      if (feedTimer > 0) {
        feedTimer -= dt;
        if (feedTimer <= 0) el.feed.classList.add('hidden');
      }
    } else {
      /* Between matches the lobby stage is what gets drawn. */
      Lobby.update(dt);
    }

    if (mode === 'playing' || mode === 'paused') renderer.render(scene, camera);
    else renderer.render(Lobby.scene, Lobby.camera);
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
    if (event.code === 'KeyF' && player.slot === 3) { Build.cycle(1); renderHotbar(); }
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
    renderHotbar();
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

  el.builds.querySelectorAll('.bpiece').forEach((piece) => {
    piece.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (mode !== 'playing') return;
      player.slot = 3;
      Build.select(Number(piece.dataset.piece));
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

  /* ---------- Lobby ---------- */

  Lobby.init(THREE);

  function buildSkinPicker() {
    el.skins.textContent = '';
    Lobby.SKINS.forEach((skin, index) => {
      const swatch = document.createElement('button');
      swatch.className = `skin${index === Lobby.skin ? ' on' : ''}`;
      swatch.type = 'button';
      swatch.title = skin.name;
      swatch.style.background = `#${skin.body.toString(16).padStart(6, '0')}`;
      swatch.addEventListener('click', () => {
        Lobby.setSkin(index);
        try { localStorage.setItem('bot-royale-skin', String(index)); } catch { /* blocked */ }
        buildSkinPicker();
      });
      el.skins.appendChild(swatch);
    });
  }

  function showTab(name) {
    el.career.classList.toggle('hidden', name !== 'career');
    el.help.classList.toggle('hidden', name !== 'help');
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.classList.toggle('on', (tab.textContent || '').toLowerCase() === name
        || (name === 'lobby' && tab.classList.contains('on') && !el['tab-career'].contains(tab)));
    });
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.classList.toggle('on', (tab.textContent || '').trim().toLowerCase() === name);
    });
  }

  el['tab-career'].addEventListener('click', () => showTab(el.career.classList.contains('hidden') ? 'career' : 'lobby'));
  el['tab-help'].addEventListener('click', () => showTab(el.help.classList.contains('hidden') ? 'controls' : 'lobby'));
  document.querySelector('.tab').addEventListener('click', () => showTab('lobby'));

  window.addEventListener('resize', resize);
  resize();
  Stats.load();
  try {
    const saved = Number(localStorage.getItem('bot-royale-skin'));
    if (Number.isInteger(saved)) Lobby.setSkin(saved);
  } catch { /* storage blocked, default outfit */ }
  buildSkinPicker();
  renderBoard();
  renderCareer();
  frame();
})();
