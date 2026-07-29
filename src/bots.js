/* Blocky characters, and the bots that drive them.

   A bot runs a small state machine: hunt the nearest thing it can see, wander
   if it cannot see anything, and always retreat toward the circle when it is
   caught outside. Shots are resolved by a clear-line check plus an accuracy
   roll, so cover genuinely protects you. When hurt they slam down a wall,
   which is the one Fortnite habit that matters most in a fight. */

const Figure = {
  /* One character: torso, head, two arms, two legs, all boxes. Returns the
     group plus the limbs, so a walk cycle is a couple of rotations. */
  make(THREE, colour, accent) {
    const group = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.7 });
    const trim = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.8 });

    const part = (w, h, d, material, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      return mesh;
    };

    const torso = part(0.78, 0.95, 0.46, skin, 0, 1.28, 0);
    group.add(torso);
    group.add(part(0.52, 0.5, 0.5, trim, 0, 2.0, 0));            // head
    group.add(part(0.2, 0.12, 0.12, dark, 0, 2.0, -0.28));        // visor

    const armL = new THREE.Group();
    armL.position.set(-0.5, 1.66, 0);
    armL.add(part(0.2, 0.8, 0.2, trim, 0, -0.4, 0));
    group.add(armL);

    const armR = new THREE.Group();
    armR.position.set(0.5, 1.66, 0);
    armR.add(part(0.2, 0.8, 0.2, trim, 0, -0.4, 0));
    group.add(armR);

    const legL = new THREE.Group();
    legL.position.set(-0.22, 0.82, 0);
    legL.add(part(0.26, 0.85, 0.26, dark, 0, -0.42, 0));
    group.add(legL);

    const legR = new THREE.Group();
    legR.position.set(0.22, 0.82, 0);
    legR.add(part(0.26, 0.85, 0.26, dark, 0, -0.42, 0));
    group.add(legR);

    /* the gun they are holding, so you can see what is pointed at you */
    const gun = part(0.16, 0.16, 0.9, dark, 0.5, 1.5, -0.5);
    group.add(gun);

    group.userData = { armL, armR, legL, legR, gun, phase: Math.random() * 6 };
    return group;
  },

  /* Walk cycle plus an arm raise when aiming. */
  animate(figure, dt, speed, aiming) {
    const rig = figure.userData;
    const pace = Math.min(1, speed / 7);
    rig.phase += dt * (2 + pace * 9);

    const swing = Math.sin(rig.phase) * 0.7 * pace;
    rig.legL.rotation.x = swing;
    rig.legR.rotation.x = -swing;
    rig.armL.rotation.x = aiming ? -1.35 : -swing * 0.7;
    rig.armR.rotation.x = aiming ? -1.35 : swing * 0.7;
    rig.gun.position.y = aiming ? 1.62 : 1.5;
    rig.gun.rotation.x = aiming ? 0 : 0.35;
  },
};

const Bots = {
  list: [],
  NAMES: ['Rook', 'Vega', 'Nova', 'Kilo', 'Juno', 'Onyx', 'Sable', 'Vox', 'Wren',
    'Zeta', 'Ash', 'Cinder', 'Dart', 'Echo', 'Flint'],
  COLOURS: [0x3b82f6, 0x22c55e, 0xeab308, 0xa855f7, 0xf97316, 0x14b8a6, 0xec4899,
    0x84cc16, 0x0ea5e9, 0xf43f5e],

  spawn(THREE, scene, count, rng, guns) {
    this.list = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rng() * 0.4;
      const radius = Arena.ARENA * 0.36 + rng() * Arena.ARENA * 0.1;
      const figure = Figure.make(THREE, this.COLOURS[i % this.COLOURS.length], 0x1f2937);
      scene.add(figure);

      const bot = {
        name: this.NAMES[i % this.NAMES.length],
        figure,
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        feetY: 0,
        vy: 0,
        yaw: rng() * Math.PI * 2,
        health: 90,
        shield: rng() > 0.75 ? 40 : 0,
        alive: true,
        gun: guns[Math.floor(rng() * guns.length)],
        cooldown: 0,
        burst: 0,
        state: 'wander',
        target: null,
        waypoint: null,
        wood: 160,
        buildCooldown: 0,
        /* Deliberately mediocre: low accuracy, slow to react, and they need a
           moment between shots. Beatable in a straight fight. */
        skill: 0.3 + rng() * 0.26,
        reaction: 0.35 + rng() * 0.4,
        seen: 0,
        kills: 0,
      };
      bot.figure.position.set(bot.x, 0, bot.z);
      this.list.push(bot);
    }
    return this.list;
  },

  alive() {
    return this.list.filter((b) => b.alive);
  },

  /* ---------- Per-frame ---------- */

  update(dt, world) {
    const { player, storm, onShotAtPlayer, onBotDown } = world;

    this.list.forEach((bot) => {
      if (!bot.alive) return;

      bot.cooldown -= dt;
      bot.buildCooldown -= dt;

      /* --- storm first: nothing else matters if you are dying in it --- */
      const fromCentre = Math.hypot(bot.x - storm.x, bot.z - storm.z);
      const outside = fromCentre > storm.radius - 4;
      if (outside) {
        bot.health -= storm.damage * dt;
        if (bot.health <= 0) return this.down(bot, null, onBotDown);
        bot.state = 'rotate';
        bot.waypoint = {
          x: storm.x + ((bot.x - storm.x) / fromCentre) * storm.radius * 0.55,
          z: storm.z + ((bot.z - storm.z) / fromCentre) * storm.radius * 0.55,
        };
      }

      /* --- pick a target --- */
      if (!outside) {
        const candidates = [];
        if (player.alive) {
          candidates.push({
            ref: player, x: player.x, z: player.z, y: player.feetY + 1.4, isPlayer: true,
          });
        }
        this.list.forEach((other) => {
          if (other !== bot && other.alive) {
            candidates.push({ ref: other, x: other.x, z: other.z, y: other.feetY + 1.4 });
          }
        });

        let best = null;
        let bestGap = 44;      // they notice you later than you notice them
        candidates.forEach((c) => {
          const gap = Math.hypot(c.x - bot.x, c.z - bot.z);
          if (gap > bestGap) return;
          if (!Arena.clearShot(bot.x, bot.feetY + 1.5, bot.z, c.x, c.y, c.z)) return;
          bestGap = gap;
          best = c;
        });

        if (!best) bot.seen = 0;        // lost sight, so the aim resets
        bot.target = best;
        bot.state = best ? 'fight' : (bot.state === 'rotate' ? 'rotate' : 'wander');
      }

      /* --- move --- */
      let moveX = 0;
      let moveZ = 0;
      const speed = bot.state === 'fight' ? 5.2 : 6;

      if (bot.state === 'fight' && bot.target) {
        const gap = Math.hypot(bot.target.x - bot.x, bot.target.z - bot.z);
        const toX = (bot.target.x - bot.x) / (gap || 1);
        const toZ = (bot.target.z - bot.z) / (gap || 1);
        bot.yaw = Math.atan2(-toX, -toZ);

        // close to a fighting range, then strafe around
        const want = gap > 26 ? 1 : gap < 12 ? -1 : 0;
        moveX = toX * want - toZ * 0.7;
        moveZ = toZ * want + toX * 0.7;

        this.shoot(bot, dt, world, gap, onShotAtPlayer, onBotDown);
      } else {
        if (!bot.waypoint || Math.hypot(bot.waypoint.x - bot.x, bot.waypoint.z - bot.z) < 3) {
          const reach = storm.radius * 0.8;
          const angle = Math.random() * Math.PI * 2;
          bot.waypoint = {
            x: storm.x + Math.cos(angle) * Math.random() * reach,
            z: storm.z + Math.sin(angle) * Math.random() * reach,
          };
        }
        const gap = Math.hypot(bot.waypoint.x - bot.x, bot.waypoint.z - bot.z) || 1;
        moveX = (bot.waypoint.x - bot.x) / gap;
        moveZ = (bot.waypoint.z - bot.z) / gap;
        bot.yaw = Math.atan2(-moveX, -moveZ);
      }

      const length = Math.hypot(moveX, moveZ) || 1;
      const stepX = (moveX / length) * speed * dt;
      const stepZ = (moveZ / length) * speed * dt;

      if (!Arena.blocked(bot.x + stepX, bot.z, bot.feetY, 1.8, 0.45)) bot.x += stepX;
      if (!Arena.blocked(bot.x, bot.z + stepZ, bot.feetY, 1.8, 0.45)) bot.z += stepZ;

      /* gravity onto whatever is under them */
      const support = Arena.supportY(bot.x, bot.z, bot.feetY, 0.45);
      if (bot.feetY > support + 0.05) {
        bot.vy -= 26 * dt;
        bot.feetY = Math.max(support, bot.feetY + bot.vy * dt);
        if (bot.feetY <= support) bot.vy = 0;
      } else {
        bot.feetY = support;
        bot.vy = 0;
      }

      bot.figure.position.set(bot.x, bot.feetY, bot.z);
      bot.figure.rotation.y = bot.yaw;
      Figure.animate(bot.figure, dt, Math.hypot(stepX, stepZ) / Math.max(dt, 0.001), bot.state === 'fight');
    });
  },

  shoot(bot, dt, world, gap, onShotAtPlayer, onBotDown) {
    /* They have to have held you in view for a beat before the first shot,
       so stepping round a corner is not instantly punished. */
    bot.seen += dt;
    if (bot.seen < bot.reaction) return;
    if (bot.cooldown > 0) return;

    const gun = bot.gun;
    bot.cooldown = gun.delay * 1.6 + (1 - bot.skill) * 0.5;
    if (gap > gun.range) return;

    /* Accuracy falls off steeply with distance. */
    const chance = bot.skill * (1 - Math.min(0.82, gap / (gun.range * 1.1)));
    world.onBotFire(bot);
    if (Math.random() > chance) return;

    const damage = gun.damage * 0.72 * (gun.pellets > 1 ? gun.pellets * 0.38 : 1);
    if (bot.target.isPlayer) {
      onShotAtPlayer(damage, bot);
    } else {
      const other = bot.target.ref;
      this.hurt(other, damage, bot, onBotDown);
    }
  },

  hurt(bot, amount, from, onBotDown) {
    if (!bot.alive) return;
    let left = amount;
    if (bot.shield > 0) {
      const absorbed = Math.min(bot.shield, left);
      bot.shield -= absorbed;
      left -= absorbed;
    }
    bot.health -= left;

    /* Panic wall: the reflex that defines the game. */
    if (bot.buildCooldown <= 0 && bot.wood >= Build.WALL_COST && Math.random() < 0.3) {
      bot.buildCooldown = 2.4;
      const saved = Build.selected;
      Build.select(0);
      const spent = Build.place({ x: bot.x, z: bot.z, yaw: bot.yaw, feetY: bot.feetY }, bot.wood);
      bot.wood -= spent;
      Build.select(saved);
      Build.hidePreview();
    }

    if (bot.health <= 0) this.down(bot, from, onBotDown);
  },

  down(bot, from, onBotDown) {
    bot.alive = false;
    bot.figure.visible = false;
    if (from && from !== bot) from.kills = (from.kills || 0) + 1;
    Arena.loot.push({ x: bot.x, z: bot.z, kind: 'weapon' });
    Arena.loot.push({ x: bot.x + 1, z: bot.z, kind: 'potion' });
    if (onBotDown) onBotDown(bot, from);
  },

  clear(scene) {
    this.list.forEach((bot) => scene.remove(bot.figure));
    this.list = [];
  },
};
