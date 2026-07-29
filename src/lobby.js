/* The lobby: a lit stage with your character on a platform, rendered live
   behind the menu panels rather than being a flat picture.

   It gets its own scene and camera so nothing has to be torn down when a match
   starts — the loop simply renders one or the other. */

/* `tint` multiplies the character model's own textures, so the default has to
   be white — anything else would stain the artwork. `body`/`trim` are only
   used by the blocky stand-in when the model has not loaded. */
const SKINS = [
  { id: 'default', name: 'Standard', tint: 0xffffff, body: 0xef4444, trim: 0xf8fafc },
  { id: 'dusk', name: 'Dusk', tint: 0xc8d4ff, body: 0x3b82f6, trim: 0xdbeafe },
  { id: 'moss', name: 'Moss', tint: 0xcfe6bd, body: 0x22c55e, trim: 0xecfccb },
  { id: 'orchid', name: 'Orchid', tint: 0xe6ccff, body: 0xa855f7, trim: 0xf3e8ff },
  { id: 'ember', name: 'Ember', tint: 0xffd9b0, body: 0xf59e0b, trim: 0x422006 },
  { id: 'ash', name: 'Ash', tint: 0x9aa3b2, body: 0x374151, trim: 0x9ca3af },
];

const Lobby = {
  SKINS,
  skin: 0,
  scene: null,
  camera: null,
  figure: null,
  time: 0,

  init(THREE) {
    this.THREE = THREE;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a1030, 26, 90);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);
    this.camera.position.set(0.6, 2.5, 8.4);
    this.camera.lookAt(0, 1.55, 0);

    /* night sky: gradient dome plus stars */
    const sky = document.createElement('canvas');
    sky.width = sky.height = 256;
    const g = sky.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#070c26');
    grd.addColorStop(0.55, '#152a5e');
    grd.addColorStop(1, '#3b3a7a');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 320; i++) {
      g.fillStyle = `rgba(226,232,255,${0.25 + Math.random() * 0.7})`;
      g.fillRect(Math.random() * 256, Math.random() * 170, 1, 1);
    }
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(140, 24, 16),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(sky), side: THREE.BackSide, depthWrite: false, fog: false,
      }),
    );
    scene.add(dome);

    /* a big low moon, because it reads instantly as night */
    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(9, 32),
      new THREE.MeshBasicMaterial({ color: 0xdfe7ff, fog: false }),
    );
    moon.position.set(-26, 20, -95);
    scene.add(moon);
    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(15, 32),
      new THREE.MeshBasicMaterial({ color: 0x8ea6ff, transparent: true, opacity: 0.18, fog: false }),
    );
    halo.position.copy(moon.position).setZ(-96);
    scene.add(halo);

    /* the stage */
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(2.5, 2.9, 0.45, 40),
      new THREE.MeshStandardMaterial({ color: 0x232a48, roughness: 0.55, metalness: 0.4 }),
    );
    platform.position.y = -0.22;
    platform.receiveShadow = true;
    scene.add(platform);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.62, 0.08, 8, 48),
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 1.6, roughness: 0.3,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.03;
    scene.add(ring);
    this.ring = ring;

    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(4.4, 40),
      new THREE.MeshBasicMaterial({ color: 0x1d4ed8, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.02;
    scene.add(glow);

    /* silhouetted skyline so the stage sits somewhere */
    const dark = new THREE.MeshStandardMaterial({ color: 0x121a38, roughness: 1 });
    for (let i = 0; i < 26; i++) {
      const angle = (i / 26) * Math.PI * 2;
      const radius = 34 + Math.random() * 22;
      const h = 6 + Math.random() * 22;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(4 + Math.random() * 6, h, 4 + Math.random() * 6), dark);
      tower.position.set(Math.cos(angle) * radius, h / 2 - 1, Math.sin(angle) * radius - 8);
      scene.add(tower);
    }

    /* three-point lighting: warm key, cool rim, dim fill */
    const key = new THREE.SpotLight(0xfff0d6, 2.6, 40, 0.6, 0.5, 1.4);
    key.position.set(4.5, 8, 6);
    key.target.position.set(0, 1.4, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key.target);
    scene.add(key);

    const rim = new THREE.SpotLight(0x60a5fa, 3.2, 40, 0.7, 0.6, 1.4);
    rim.position.set(-6, 6, -6);
    rim.target.position.set(0, 1.4, 0);
    scene.add(rim.target);
    scene.add(rim);

    scene.add(new THREE.HemisphereLight(0x6f86d6, 0x0d1330, 0.5));

    /* drifting motes, caught in the key light */
    const motes = new THREE.Group();
    const moteMat = new THREE.MeshBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0.5 });
    for (let i = 0; i < 60; i++) {
      const mote = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), moteMat);
      mote.position.set((Math.random() - 0.5) * 9, Math.random() * 6, (Math.random() - 0.5) * 7);
      mote.userData.speed = 0.15 + Math.random() * 0.4;
      motes.add(mote);
    }
    scene.add(motes);
    this.motes = motes;

    this.setSkin(this.skin);
  },

  setSkin(index) {
    this.skin = ((index % SKINS.length) + SKINS.length) % SKINS.length;
    const skin = SKINS[this.skin];

    /* With the character model loaded the swatches are a tint on it; without
       one they rebuild the blocky stand-in. */
    if (Hero.loaded) {
      Hero.setTint(skin.tint);
      if (this.figure && this.figure !== Hero.group) {
        this.scene.remove(this.figure);
        this.figure = null;
      }
      return skin;
    }

    if (this.figure) this.scene.remove(this.figure);
    this.figure = Figure.make(this.THREE, skin.body, skin.trim);
    this.figure.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(this.figure);
    return skin;
  },

  /* Called once the character model is in: it stands on the platform. */
  useHero() {
    if (!Hero.loaded) return;
    if (this.figure && this.figure !== Hero.group) this.scene.remove(this.figure);
    Hero.attach(this.scene);
    Hero.place(0, 0, 0, 0);
    this.figure = Hero.group;
    Hero.setTint(SKINS[this.skin].tint);
  },

  get current() {
    return SKINS[this.skin];
  },

  /* Idle animation: a slow turntable, a breath, and the ring pulsing. */
  update(dt) {
    this.time += dt;

    if (this.figure === Hero.group && Hero.loaded) {
      // its own idle clip carries the performance; we just turn the platform
      Hero.group.rotation.y += dt * 0.35;
      Hero.update(dt, 0, Hero.group.rotation.y, false);
    } else if (this.figure) {
      this.figure.rotation.y += dt * 0.35;
      this.figure.position.y = Math.sin(this.time * 1.5) * 0.035;
      Figure.animate(this.figure, dt, 0, false);
      const rig = this.figure.userData;
      // a relaxed stance rather than the aiming pose
      rig.armL.rotation.x = -0.15 + Math.sin(this.time * 1.3) * 0.05;
      rig.armR.rotation.x = -0.15 + Math.sin(this.time * 1.3 + 1) * 0.05;
      rig.legL.rotation.x = 0;
      rig.legR.rotation.x = 0;
    }
    if (this.ring) {
      this.ring.material.emissiveIntensity = 1.2 + Math.sin(this.time * 2.2) * 0.5;
    }
    if (this.motes) {
      this.motes.children.forEach((mote) => {
        mote.position.y += mote.userData.speed * dt;
        if (mote.position.y > 6.5) mote.position.y = -0.3;
      });
    }
  },

  resize(width, height) {
    if (!this.camera) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  },
};
