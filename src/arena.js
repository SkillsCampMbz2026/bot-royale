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

  /* Grass with actual blades and mown patches, so the ground reads as a
     surface rather than a flat green fill. */
  grassTexture() {
    return this.texture(512, (g, s) => {
      g.fillStyle = '#416b39';
      g.fillRect(0, 0, s, s);

      // broad patches of lighter and darker growth
      for (let i = 0; i < 26; i++) {
        const r = 30 + Math.random() * 90;
        const grd = g.createRadialGradient(Math.random() * s, Math.random() * s, 0,
          Math.random() * s, Math.random() * s, r);
        const light = Math.random() > 0.5;
        grd.addColorStop(0, light ? 'rgba(126,166,86,0.3)' : 'rgba(38,60,32,0.32)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, s, s);
      }

      // blades
      for (let i = 0; i < 9000; i++) {
        const x = Math.random() * s;
        const y = Math.random() * s;
        const h = 2 + Math.random() * 5;
        const shade = 70 + Math.random() * 70;
        g.strokeStyle = `rgba(${shade * 0.55 | 0},${shade | 0},${shade * 0.45 | 0},0.5)`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (Math.random() - 0.5) * 2, y - h);
        g.stroke();
      }

      // scuffs of bare earth
      for (let i = 0; i < 90; i++) {
        g.fillStyle = `rgba(104,80,52,${0.1 + Math.random() * 0.22})`;
        g.beginPath();
        g.ellipse(Math.random() * s, Math.random() * s, 3 + Math.random() * 12,
          2 + Math.random() * 7, Math.random() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
    });
  },

  /* Rendered brick courses with mortar depth and weathering. */
  wallTexture() {
    return this.texture(256, (g, s) => {
      g.fillStyle = '#6e6157';
      g.fillRect(0, 0, s, s);

      const rows = 10;
      const h = s / rows;
      for (let row = 0; row < rows; row++) {
        const offset = (row % 2) * (s / 8);
        for (let col = -1; col < 5; col++) {
          const x = offset + col * (s / 4);
          const tone = 168 + Math.random() * 40;
          g.fillStyle = `rgb(${tone},${tone * 0.88 | 0},${tone * 0.7 | 0})`;
          g.fillRect(x + 2, row * h + 2, s / 4 - 4, h - 4);
          // top highlight and bottom shadow give each brick a lip
          g.fillStyle = 'rgba(255,255,255,0.13)';
          g.fillRect(x + 2, row * h + 2, s / 4 - 4, 2);
          g.fillStyle = 'rgba(0,0,0,0.26)';
          g.fillRect(x + 2, row * h + h - 5, s / 4 - 4, 3);
        }
      }

      for (let i = 0; i < 3200; i++) {
        g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
        g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
      }
      // damp streaks running down the wall
      for (let i = 0; i < 20; i++) {
        g.fillStyle = `rgba(60,50,40,${0.05 + Math.random() * 0.09})`;
        g.fillRect(Math.random() * s, 0, 3 + Math.random() * 9, s);
      }
    });
  },

  /* A soft dark blob laid on the ground under a prop. Contact shadows are the
     cheapest way to stop things looking like they are hovering. */
  contactShadow(THREE, group, x, z, radius, y) {
    if (!this.shadowMat) {
      const blob = this.texture(64, (g, s) => {
        const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        grd.addColorStop(0, 'rgba(0,0,0,0.55)');
        grd.addColorStop(0.55, 'rgba(0,0,0,0.25)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, s, s);
      });
      this.shadowMat = new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(blob), transparent: true, depthWrite: false,
      });
    }
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), this.shadowMat);
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(x, (y || 0) + 0.03, z);
    group.add(decal);
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

  /* Sky dome, clouds and a ring of distant hills. None of it is collidable —
     it exists so the map has a horizon instead of ending in fog. */
  skybox(THREE, group) {
    const sky = this.texture(256, (g, s) => {
      const grd = g.createLinearGradient(0, 0, 0, s);
      grd.addColorStop(0, '#2f6fb8');
      grd.addColorStop(0.45, '#7db6e4');
      grd.addColorStop(0.75, '#bfe0f5');
      grd.addColorStop(1, '#e8f4ff');
      g.fillStyle = grd;
      g.fillRect(0, 0, s, s);
    });
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(400, 24, 16),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(sky), side: THREE.BackSide, depthWrite: false, fog: false,
      }),
    );
    group.add(dome);

    const cloudMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false, fog: false,
    });
    for (let i = 0; i < 26; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(Math.random() * 4);
      for (let p = 0; p < puffs; p++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(6 + Math.random() * 9, 7, 5), cloudMat);
        puff.position.set((p - puffs / 2) * 9, Math.random() * 4, Math.random() * 6);
        puff.scale.y = 0.55;
        cloud.add(puff);
      }
      const angle = Math.random() * Math.PI * 2;
      const radius = 130 + Math.random() * 190;
      cloud.position.set(Math.cos(angle) * radius, 90 + Math.random() * 60, Math.sin(angle) * radius);
      group.add(cloud);
    }

    /* hills, sunk so only their tops show over the treeline */
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x4a6b48, roughness: 1 });
    for (let i = 0; i < 26; i++) {
      const angle = (i / 26) * Math.PI * 2 + Math.random() * 0.2;
      const radius = ARENA * 0.78 + Math.random() * 40;
      const size = 26 + Math.random() * 34;
      const hill = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 7), hillMat);
      hill.position.set(Math.cos(angle) * radius, -size * 0.55, Math.sin(angle) * radius);
      hill.scale.y = 0.6;
      group.add(hill);
    }
  },

  build(THREE, scene, rng) {
    this.boxes = [];
    this.loot = [];
    const group = new THREE.Group();
    this.group = group;
    this.skybox(THREE, group);

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

      /* Lit windows, so buildings read as places rather than crates. */
      const glass = new THREE.MeshStandardMaterial({
        color: 0x2a3550, emissive: 0xffd79a, emissiveIntensity: 0.85, roughness: 0.25,
      });
      for (let floor = 0; floor < floors; floor++) {
        const y = 1.6 + floor * 4;
        [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([sx, sz]) => {
          const count = sx ? Math.max(1, Math.floor(d / 5)) : Math.max(1, Math.floor(w / 5));
          for (let n = 0; n < count; n++) {
            if (Math.random() > 0.72) continue;
            const along = (n + 0.5) / count - 0.5;
            const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.15), glass);
            pane.position.set(
              cx + sx * (w / 2 + 0.42) + (sz ? along * w : 0),
              y,
              cz + sz * (d / 2 + 0.42) + (sx ? along * d : 0),
            );
            pane.rotation.y = sx ? sx * Math.PI / 2 : (sz > 0 ? 0 : Math.PI);
            group.add(pane);
          }
        });
      }

      this.contactShadow(THREE, group, cx, cz, Math.max(w, d) * 0.72, 0);

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
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.62, height, 8), trunkMat);
      trunk.position.set(x, height / 2, z);
      trunk.rotation.y = rng() * Math.PI;
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      group.add(trunk);

      /* Three tiers of foliage, each its own shade and rotation — one cone
         reads as a traffic cone, three read as a tree. */
      const leaves = new THREE.Group();
      const hue = 0.28 + rng() * 0.05;
      for (let tier = 0; tier < 3; tier++) {
        const spread = 2.9 - tier * 0.7;
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(spread, 2.9 + rng() * 0.8, 9),
          new THREE.MeshStandardMaterial({
            color: new THREE.Color().setHSL(hue, 0.45 - tier * 0.04, 0.2 + tier * 0.055),
            roughness: 1,
          }),
        );
        cone.position.y = height * 0.62 + tier * 1.5;
        cone.rotation.y = rng() * Math.PI;
        cone.castShadow = true;
        leaves.add(cone);
      }
      leaves.position.set(x, 0, z);
      group.add(leaves);

      this.contactShadow(THREE, group, x, z, 2.6, 0);

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
      rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      rock.castShadow = true;
      rock.receiveShadow = true;
      group.add(rock);
      this.contactShadow(THREE, group, x, z, s * 1.5, 0);
      const box = this.addBox(x, s * 0.6, z, s * 0.8, s * 0.6, s * 0.8, 'rock', 140, rock);
      box.wood = 24;
    }

    /* --- ground cover: bushes and grass tufts, purely to break up the plane --- */
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x35592f, roughness: 1 });
    const tuftMat = new THREE.MeshStandardMaterial({
      color: 0x6f9c4a, roughness: 1, side: THREE.DoubleSide,
    });
    for (let i = 0; i < 150; i++) {
      const x = (rng() - 0.5) * ARENA;
      const z = (rng() - 0.5) * ARENA;
      if (rng() > 0.55) {
        const s = 0.7 + rng() * 0.9;
        const bush = new THREE.Mesh(new THREE.SphereGeometry(s, 7, 5), bushMat);
        bush.position.set(x, s * 0.62, z);
        bush.scale.y = 0.7;
        bush.castShadow = true;
        group.add(bush);
        this.contactShadow(THREE, group, x, z, s * 1.7, 0);
      } else {
        // two crossed quads: a grass tuft from any angle, for two triangles
        const tuft = new THREE.Group();
        for (let k = 0; k < 2; k++) {
          const blade = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.9), tuftMat);
          blade.position.y = 0.45;
          blade.rotation.y = k * Math.PI / 2;
          tuft.add(blade);
        }
        tuft.position.set(x, 0, z);
        tuft.rotation.y = rng() * Math.PI;
        group.add(tuft);
      }
    }

    /* --- open-field loot --- */
    for (let i = 0; i < 26; i++) {
      const x = (rng() - 0.5) * ARENA * 0.9;
      const z = (rng() - 0.5) * ARENA * 0.9;
      if (this.overlaps(x, z, 3)) continue;
      const roll = rng();
      this.loot.push({
        x, z,
        kind: roll > 0.55 ? 'weapon' : roll > 0.38 ? 'ammo' : roll > 0.18 ? 'potion' : 'medkit',
      });
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
