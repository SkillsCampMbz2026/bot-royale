/* The map: ground, buildings, trees, rocks and floor loot.

   Everything the player or a bot can bump into is registered as an axis-aligned
   box in one list. Collision is then a single sweep over that list, and the
   same boxes double as cover for line-of-sight checks and as targets for the
   pickaxe. Textures are painted into canvases at runtime — no image files. */

const ARENA = 190;          // playable square, centred on the origin
const GRID = 4;             // build grid, also the size of a wall panel

const Arena = {
  ARENA,
  GRID,
  boxes: [],                // { x, y, z, hx, hy, hz, kind, health, mesh }
  loot: [],
  group: null,

  texture(size, paint) {
    const surface = document.createElement('canvas');
    surface.width = size;
    surface.height = size;
    paint(surface.getContext('2d'), size);
    return surface;
  },

  grassTexture() {
    return this.texture(256, (g, s) => {
      g.fillStyle = '#3f6b3a';
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 5000; i++) {
        const v = Math.random();
        g.fillStyle = v > 0.66 ? 'rgba(255,255,255,0.05)'
          : v > 0.33 ? 'rgba(0,0,0,0.09)' : 'rgba(120,180,90,0.16)';
        g.fillRect(Math.random() * s, Math.random() * s, 2, 3);
      }
    });
  },

  wallTexture() {
    return this.texture(128, (g, s) => {
      g.fillStyle = '#b9a17c';
      g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(0,0,0,0.18)';
      g.lineWidth = 2;
      for (let i = 1; i < 4; i++) {
        g.beginPath();
        g.moveTo(0, (s / 4) * i);
        g.lineTo(s, (s / 4) * i);
        g.stroke();
      }
      for (let i = 0; i < 1200; i++) {
        g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
        g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
      }
    });
  },

  woodTexture() {
    return this.texture(128, (g, s) => {
      g.fillStyle = '#a9773f';
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 26; i++) {
        g.strokeStyle = `rgba(${90 + Math.random() * 60 | 0},${55 + Math.random() * 40 | 0},20,0.45)`;
        g.lineWidth = 1 + Math.random() * 3;
        g.beginPath();
        g.moveTo(0, Math.random() * s);
        g.bezierCurveTo(s * 0.3, Math.random() * s, s * 0.6, Math.random() * s, s, Math.random() * s);
        g.stroke();
      }
    });
  },

  /* ---------- Registration ---------- */

  addBox(x, y, z, hx, hy, hz, kind, health, mesh) {
    const box = { x, y, z, hx, hy, hz, kind, health, mesh };
    this.boxes.push(box);
    return box;
  },

  /* ---------- Build ---------- */

  build(THREE, scene, rng) {
    this.boxes = [];
    this.loot = [];
    const group = new THREE.Group();
    this.group = group;

    const grass = new THREE.CanvasTexture(this.grassTexture());
    grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
    grass.repeat.set(ARENA / 6, ARENA / 6);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA + 60, ARENA + 60),
      new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    group.add(ground);

    const wallMat = new THREE.MeshStandardMaterial({
      map: new THREE.CanvasTexture(this.wallTexture()), roughness: 0.85,
    });
    wallMat.map.wrapS = wallMat.map.wrapT = THREE.RepeatWrapping;
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8b3a3a, roughness: 0.8 });
    const trunkMat = new THREE.MeshStandardMaterial({
      map: new THREE.CanvasTexture(this.woodTexture()), roughness: 0.95,
    });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f6b32, roughness: 1 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x7c8087, roughness: 0.9 });

    /* --- buildings: hollow boxes you can run into and fight around --- */
    const placeBuilding = (cx, cz, w, d, floors) => {
      const h = floors * 4;
      const t = 0.4;
      const parts = [
        [cx, h / 2, cz - d / 2, w / 2, h / 2, t],       // north wall
        [cx, h / 2, cz + d / 2, w / 2, h / 2, t],       // south
        [cx - w / 2, h / 2, cz, t, h / 2, d / 2],       // west
        [cx + w / 2, h / 2, cz, t, h / 2, d / 2],       // east
      ];
      parts.forEach(([x, y, z, hx, hy, hz]) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), wallMat);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        this.addBox(x, y, z, hx, hy, hz, 'wall', Infinity, mesh);
      });

      // a doorway: knock a gap by shrinking the north wall into two posts
      const gap = 3;
      const north = this.boxes[this.boxes.length - 4];
      group.remove(north.mesh);
      this.boxes.splice(this.boxes.length - 4, 1);
      [-1, 1].forEach((side) => {
        const segW = (w - gap) / 2;
        const x = cx + side * (gap / 2 + segW / 2);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(segW, h, t * 2), wallMat);
        mesh.position.set(x, h / 2, cz - d / 2);
        mesh.castShadow = true;
        group.add(mesh);
        this.addBox(x, h / 2, cz - d / 2, segW / 2, h / 2, t, 'wall', Infinity, mesh);
      });

      // roof, which is also a walkable surface
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 1, 0.5, d + 1), roofMat);
      roof.position.set(cx, h, cz);
      roof.castShadow = true;
      roof.receiveShadow = true;
      group.add(roof);
      this.addBox(cx, h, cz, (w + 1) / 2, 0.25, (d + 1) / 2, 'roof', Infinity, roof);

      // loot inside
      this.loot.push({ x: cx, z: cz, kind: 'weapon' });
      if (rng() > 0.5) this.loot.push({ x: cx + 2, z: cz + 1, kind: 'potion' });
    };

    const spots = [
      [-52, -46, 16, 14, 2], [44, -52, 20, 16, 2], [0, 0, 24, 20, 3],
      [-60, 40, 18, 16, 2], [54, 44, 16, 14, 2], [-8, -66, 14, 12, 1],
      [12, 62, 18, 14, 2], [70, 0, 14, 20, 1], [-72, -6, 14, 18, 1],
    ];
    spots.forEach(([x, z, w, d, f]) => placeBuilding(x, z, w, d, f));

    /* --- trees: harvestable for wood --- */
    for (let i = 0; i < 120; i++) {
      const x = (rng() - 0.5) * ARENA;
      const z = (rng() - 0.5) * ARENA;
      if (this.overlaps(x, z, 4)) continue;

      const height = 5 + rng() * 4;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, height, 7), trunkMat);
      trunk.position.set(x, height / 2, z);
      trunk.castShadow = true;
      group.add(trunk);

      const leaves = new THREE.Mesh(new THREE.ConeGeometry(2.6, 5.5, 8), leafMat);
      leaves.position.set(x, height + 1.6, z);
      leaves.castShadow = true;
      group.add(leaves);

      const box = this.addBox(x, height / 2, z, 0.6, height / 2, 0.6, 'tree', 100, trunk);
      box.extra = leaves;
      box.wood = 34;
    }

    /* --- rocks: cover, and stone if you hit them --- */
    for (let i = 0; i < 60; i++) {
      const x = (rng() - 0.5) * ARENA;
      const z = (rng() - 0.5) * ARENA;
      if (this.overlaps(x, z, 3)) continue;
      const s = 1.4 + rng() * 2.4;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
      rock.position.set(x, s * 0.6, z);
      rock.castShadow = true;
      rock.receiveShadow = true;
      group.add(rock);
      const box = this.addBox(x, s * 0.6, z, s * 0.8, s * 0.6, s * 0.8, 'rock', 140, rock);
      box.wood = 24;
    }

    /* --- open-field loot --- */
    for (let i = 0; i < 26; i++) {
      const x = (rng() - 0.5) * ARENA * 0.9;
      const z = (rng() - 0.5) * ARENA * 0.9;
      if (this.overlaps(x, z, 3)) continue;
      this.loot.push({ x, z, kind: rng() > 0.4 ? 'weapon' : (rng() > 0.5 ? 'ammo' : 'potion') });
    }

    scene.add(group);
    return group;
  },

  overlaps(x, z, pad) {
    return this.boxes.some((b) =>
      Math.abs(b.x - x) < b.hx + pad && Math.abs(b.z - z) < b.hz + pad);
  },

  /* ---------- Queries used by movement and shooting ---------- */

  /* Highest surface under a point that the mover can stand on. */
  supportY(x, z, feetY, radius) {
    let best = 0;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (b.dead) continue;
      if (Math.abs(b.x - x) > b.hx + radius || Math.abs(b.z - z) > b.hz + radius) continue;
      const top = b.y + b.hy;
      if (top <= feetY + 0.65 && top > best) best = top;
    }
    return best;
  },

  /* Does a capsule at (x, feetY..feetY+height) hit anything solid? */
  blocked(x, z, feetY, height, radius) {
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (b.dead) continue;
      const top = b.y + b.hy;
      const bottom = b.y - b.hy;
      if (top <= feetY + 0.65) continue;          // low enough to step onto
      if (bottom >= feetY + height) continue;     // above our head
      if (Math.abs(b.x - x) > b.hx + radius) continue;
      if (Math.abs(b.z - z) > b.hz + radius) continue;
      return true;
    }
    return false;
  },

  /* Clear shot between two points? Sampled against the box list. */
  clearShot(x1, y1, z1, x2, y2, z2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    const span = Math.hypot(dx, dy, dz);
    const steps = Math.max(2, Math.ceil(span / 1.1));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = x1 + dx * t;
      const py = y1 + dy * t;
      const pz = z1 + dz * t;
      for (let k = 0; k < this.boxes.length; k++) {
        const b = this.boxes[k];
        if (b.dead) continue;
        if (Math.abs(b.x - px) < b.hx && Math.abs(b.y - py) < b.hy && Math.abs(b.z - pz) < b.hz) {
          return false;
        }
      }
    }
    return true;
  },

  /* Nearest destructible box along a ray, for pickaxe swings and bullets. */
  hitScan(origin, direction, range) {
    let closest = null;
    let closestT = range;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (b.dead) continue;
      const t = this.rayBox(origin, direction, b);
      if (t !== null && t < closestT) {
        closestT = t;
        closest = b;
      }
    }
    return closest ? { box: closest, distance: closestT } : null;
  },

  /* Slab method: the ray enters every axis' span at the same time or it misses. */
  rayBox(o, d, b) {
    let near = 0;
    let far = Infinity;
    const lo = [b.x - b.hx, b.y - b.hy, b.z - b.hz];
    const hi = [b.x + b.hx, b.y + b.hy, b.z + b.hz];
    const op = [o.x, o.y, o.z];
    const dp = [d.x, d.y, d.z];

    for (let a = 0; a < 3; a++) {
      if (Math.abs(dp[a]) < 1e-8) {
        if (op[a] < lo[a] || op[a] > hi[a]) return null;
        continue;
      }
      let t1 = (lo[a] - op[a]) / dp[a];
      let t2 = (hi[a] - op[a]) / dp[a];
      if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
      near = Math.max(near, t1);
      far = Math.min(far, t2);
      if (near > far) return null;
    }
    return near;
  },

  /* Take a chunk out of the world. Returns the wood earned. */
  damageBox(box, amount) {
    if (box.dead || box.health === Infinity) return 0;
    box.health -= amount;
    if (box.health > 0) return 0;

    box.dead = true;
    if (box.mesh) box.mesh.visible = false;
    if (box.extra) box.extra.visible = false;

    /* A ramp is four collision steps under one sloped mesh, so breaking any
       step takes the whole ramp with it — otherwise you would be left walking
       on an invisible staircase. */
    if (box.siblings) box.siblings.forEach((step) => { step.dead = true; });
    if (box.onDeath) box.onDeath();

    return box.wood || 0;
  },

  dispose(scene) {
    if (!this.group) return;
    scene.remove(this.group);
    this.group.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
    this.group = null;
    this.boxes = [];
    this.loot = [];
  },
};
