/* Building: walls, ramps and floors snapped to the world grid.

   A ramp is drawn as one sloped slab but collides as four rising steps, which
   is what makes it walkable — the movement code only knows how to step up onto
   a surface, so a real slope would just be a wall you cannot climb. */

const Build = {
  WALL_COST: 10,
  FLOOR_COST: 10,
  RAMP_COST: 10,
  HEALTH: 180,

  pieces: ['wall', 'ramp', 'floor'],
  selected: 0,
  ghost: null,
  materials: null,

  init(THREE, scene) {
    this.THREE = THREE;
    this.scene = scene;

    const wood = new THREE.MeshStandardMaterial({ color: 0xb58149, roughness: 0.85 });
    const ghostOk = new THREE.MeshBasicMaterial({
      color: 0x4ade80, transparent: true, opacity: 0.4, depthWrite: false,
    });
    const ghostBad = new THREE.MeshBasicMaterial({
      color: 0xef4444, transparent: true, opacity: 0.35, depthWrite: false,
    });
    this.materials = { wood, ghostOk, ghostBad };

    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ghostOk);
    this.ghost.visible = false;
    scene.add(this.ghost);
  },

  cycle(direction) {
    this.selected = (this.selected + direction + this.pieces.length) % this.pieces.length;
    return this.pieces[this.selected];
  },

  select(index) {
    if (index >= 0 && index < this.pieces.length) this.selected = index;
    return this.pieces[this.selected];
  },

  get piece() {
    return this.pieces[this.selected];
  },

  cost() {
    return { wall: this.WALL_COST, ramp: this.RAMP_COST, floor: this.FLOOR_COST }[this.piece];
  },

  /* Where the current piece would land: the grid cell one step ahead of the
     player, at the level their feet are on. */
  target(player) {
    const G = Arena.GRID;
    const facing = this.facingAxis(player.yaw);
    const ahead = G * 0.85;
    const px = player.x + facing.x * ahead;
    const pz = player.z + facing.z * ahead;

    const cx = Math.floor(px / G) * G + G / 2;
    const cz = Math.floor(pz / G) * G + G / 2;
    const level = Math.max(0, Math.round(player.feetY / G)) * G;

    return { cx, cz, level, facing };
  },

  /* Snap the aim direction to the nearest of the four grid axes, the way
     Fortnite snaps a wall flat to the quadrant you are facing. */
  facingAxis(yaw) {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    return Math.abs(fx) > Math.abs(fz)
      ? { x: Math.sign(fx), z: 0 }
      : { x: 0, z: Math.sign(fz) };
  },

  /* Geometry for a piece, as { position, half, rotationY, slope }. */
  shape(piece, spot) {
    const G = Arena.GRID;
    const t = 0.35;
    if (piece === 'wall') {
      // flat against the edge of the cell nearest the player
      const onX = spot.facing.x !== 0;
      return {
        x: spot.cx - spot.facing.x * (G / 2),
        y: spot.level + G / 2,
        z: spot.cz - spot.facing.z * (G / 2),
        hx: onX ? t : G / 2,
        hy: G / 2,
        hz: onX ? G / 2 : t,
        slope: false,
      };
    }
    if (piece === 'floor') {
      return {
        x: spot.cx, y: spot.level + t, z: spot.cz,
        hx: G / 2, hy: t, hz: G / 2, slope: false,
      };
    }
    return {
      x: spot.cx, y: spot.level + G / 2, z: spot.cz,
      hx: G / 2, hy: G / 2, hz: G / 2, slope: true,
    };
  },

  /* Nothing may overlap an existing solid, and it has to be inside the map. */
  legal(shape) {
    if (Math.abs(shape.x) > Arena.ARENA / 2 + 8 || Math.abs(shape.z) > Arena.ARENA / 2 + 8) return false;
    return !Arena.boxes.some((b) => {
      if (b.dead) return false;
      return Math.abs(b.x - shape.x) < b.hx + shape.hx - 0.25
        && Math.abs(b.y - shape.y) < b.hy + shape.hy - 0.25
        && Math.abs(b.z - shape.z) < b.hz + shape.hz - 0.25;
    });
  },

  preview(player, wood) {
    const spot = this.target(player);
    const shape = this.shape(this.piece, spot);
    const ok = this.legal(shape) && wood >= this.cost();

    this.ghost.visible = true;
    this.ghost.material = ok ? this.materials.ghostOk : this.materials.ghostBad;
    this.ghost.position.set(shape.x, shape.y, shape.z);
    this.ghost.scale.set(shape.hx * 2, shape.hy * 2, shape.hz * 2);
    return { shape, ok, spot };
  },

  hidePreview() {
    if (this.ghost) this.ghost.visible = false;
  },

  /* Place a piece. Returns the wood spent, or 0 if it could not go there. */
  place(player, wood) {
    const { shape, ok, spot } = this.preview(player, wood);
    if (!ok) return 0;

    const THREE = this.THREE;
    const G = Arena.GRID;

    if (!shape.slope) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(shape.hx * 2, shape.hy * 2, shape.hz * 2),
        this.materials.wood,
      );
      mesh.position.set(shape.x, shape.y, shape.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      const box = Arena.addBox(shape.x, shape.y, shape.z, shape.hx, shape.hy, shape.hz,
        'built', this.HEALTH, mesh);
      box.built = true;
      return this.cost();
    }

    /* Ramp: one sloped slab for looks... */
    const group = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(G, 0.35, G * 1.42), this.materials.wood);
    slab.rotation.x = -Math.PI / 4 * (spot.facing.z !== 0 ? 1 : 1);
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);
    group.position.set(shape.x, spot.level + G / 2, shape.z);
    // face the slope along the direction of travel
    group.rotation.y = spot.facing.x !== 0
      ? (spot.facing.x > 0 ? Math.PI / 2 : -Math.PI / 2)
      : (spot.facing.z > 0 ? Math.PI : 0);
    this.scene.add(group);

    /* ...and four rising steps for collision, so it can actually be walked. */
    const steps = 4;
    const stepBoxes = [];
    for (let i = 0; i < steps; i++) {
      const along = (i + 0.5) / steps - 0.5;             // -0.5 .. 0.5 across the cell
      const height = ((i + 1) / steps) * G;
      const x = shape.x + (spot.facing.x !== 0 ? along * G * spot.facing.x : 0);
      const z = shape.z + (spot.facing.z !== 0 ? along * G * spot.facing.z : 0);
      const box = Arena.addBox(
        x, spot.level + height / 2, z,
        spot.facing.x !== 0 ? G / (steps * 2) : G / 2,
        height / 2,
        spot.facing.z !== 0 ? G / (steps * 2) : G / 2,
        'built', this.HEALTH, null,
      );
      box.built = true;
      box.ramp = group;
      box.siblings = stepBoxes;
      stepBoxes.push(box);
    }
    // the whole ramp goes at once, not step by step
    stepBoxes.forEach((box) => { box.onDeath = () => { group.visible = false; }; });

    return this.cost();
  },

  reset() {
    this.selected = 0;
    this.hidePreview();
  },
};
