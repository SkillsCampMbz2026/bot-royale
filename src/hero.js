/* The player character: a skinned glTF model.

   Three things had to be handled for this particular file:

   1. It carries a stray pistol mesh parked about 5,000 units below the body,
      which wrecks any bounding-box measurement. It gets dropped.
   2. Nothing about its scale or origin is usable directly, so the body is
      measured after load and normalised to a known height with its feet on
      the floor.
   3. It ships one idle clip and no run cycle. The idle plays through an
      AnimationMixer, and a run is layered *on top* by rotating the leg and
      arm bones after the mixer has written its pose each frame. Those
      rotations use world axes, so they work without knowing which way any
      individual bone happens to point. */

const Hero = {
  HEIGHT: 1.85,
  loaded: false,
  group: null,
  mixer: null,
  bones: {},
  phase: 0,
  tint: 0xffffff,

  /* Bones we drive, found by name prefix — the file suffixes every joint
     with an index, so exact names are not dependable. */
  WANTED: {
    thighL: 'thigh_l', calfL: 'calf_l', footL: 'foot_l',
    thighR: 'thigh_r', calfR: 'calf_r', footR: 'foot_r',
    armL: 'upperarm_l', foreL: 'lowerarm_l',
    armR: 'upperarm_r', foreR: 'lowerarm_r',
    spine: 'spine_02', head: 'head',
  },

  load(THREE, url) {
    this.THREE = THREE;
    return new Promise((resolve, reject) => {
      new THREE.GLTFLoader().load(url, (gltf) => {
        this.build(THREE, gltf);
        this.loaded = true;
        resolve(this);
      }, undefined, reject);
    });
  },

  build(THREE, gltf) {
    const root = gltf.scene;

    /* --- drop the floating weapon prop and collect the skin materials --- */
    const doomed = [];
    this.materials = [];
    root.traverse((object) => {
      if (!object.isMesh && !object.isSkinnedMesh) return;
      const name = `${object.name} ${(object.material && object.material.name) || ''}`;
      if (/pistol|cannon|weapon/i.test(name)) {
        doomed.push(object);
        return;
      }
      object.castShadow = true;
      object.frustumCulled = false;   // one creature, culled as a whole
      if (object.material) {
        object.material = object.material.clone();
        object.material.side = THREE.FrontSide;
        this.materials.push(object.material);
      }
    });
    doomed.forEach((mesh) => mesh.parent && mesh.parent.remove(mesh));

    /* --- normalise: known height, centred, feet on the floor --- */
    const holder = new THREE.Group();      // scale + offset
    holder.add(root);
    const group = new THREE.Group();       // position + yaw, what the game moves
    group.add(holder);

    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = this.HEIGHT / (size.y || 1);
    holder.scale.setScalar(scale);
    holder.position.set(
      -(box.min.x + box.max.x) / 2 * scale,
      -box.min.y * scale,
      -(box.min.z + box.max.z) / 2 * scale,
    );

    /* --- bones --- */
    const bones = {};
    root.traverse((object) => {
      if (!object.isBone) return;
      const lower = object.name.toLowerCase();
      Object.keys(this.WANTED).forEach((key) => {
        if (bones[key]) return;
        if (lower.startsWith(this.WANTED[key])) bones[key] = object;
      });
    });
    this.bones = bones;

    /* --- idle clip --- */
    if (gltf.animations && gltf.animations.length) {
      this.mixer = new THREE.AnimationMixer(root);
      this.idle = this.mixer.clipAction(gltf.animations[0]);
      this.idle.play();
    }

    this.group = group;
    this.root = root;
    this.axis = new THREE.Vector3();
    return group;
  },

  setTint(colour) {
    this.tint = colour;
    if (this.materials) this.materials.forEach((m) => m.color && m.color.setHex(colour));
  },

  /* Move it into whichever scene is being rendered. One instance is enough:
     the lobby and the match never draw at the same time, and cloning a
     skinned mesh needs SkeletonUtils, which the core build does not ship. */
  attach(scene) {
    if (this.group) scene.add(this.group);
  },

  place(x, y, z, yaw) {
    if (!this.group) return;
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
  },

  /* speed in world units/sec; the run is layered over the idle. */
  update(dt, speed, yaw, aiming) {
    if (this.mixer) this.mixer.update(dt);
    const bones = this.bones;
    const pace = Math.min(1, (speed || 0) / 8);

    /* The character's own right-hand axis in world space. Rotating about a
       world axis sidesteps every question about bone orientation. */
    this.axis.set(Math.cos(yaw || 0), 0, -Math.sin(yaw || 0));
    const swingOn = (bone, angle) => {
      if (bone && angle) bone.rotateOnWorldAxis(this.axis, angle);
    };

    if (pace > 0.04) {
      this.phase += dt * (4 + pace * 9);
      const swing = 0.72 * pace;
      const l = Math.sin(this.phase);
      const r = -l;

      swingOn(bones.thighL, l * swing);
      swingOn(bones.thighR, r * swing);
      swingOn(bones.calfL, Math.max(0, -l) * swing * 1.2);
      swingOn(bones.calfR, Math.max(0, -r) * swing * 1.2);
      swingOn(bones.footL, -Math.max(0, -l) * swing * 0.5);
      swingOn(bones.footR, -Math.max(0, -r) * swing * 0.5);

      if (!aiming) {
        swingOn(bones.armL, r * swing * 0.55);
        swingOn(bones.armR, l * swing * 0.55);
      }
      // a slight forward lean into the run
      swingOn(bones.spine, -0.12 * pace);
    }

    /* Weapon up: both arms forward, held there regardless of pace. */
    if (aiming) {
      swingOn(bones.armL, -1.15);
      swingOn(bones.armR, -1.05);
      swingOn(bones.foreL, -0.5);
      swingOn(bones.foreR, -0.35);
    }
  },
};
