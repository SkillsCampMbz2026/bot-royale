/* Client side of LAN multiplayer.

   The server is authoritative for everything that two players could otherwise
   disagree about: the map seed, health, damage, the storm, structures, felled
   terrain, taken loot, and who won. This module keeps a mirror of that and
   hands the game a list of other players to draw.

   Remote players are interpolated toward their last reported position rather
   than snapped to it, so a dropped packet reads as a smooth glide instead of a
   teleport. */

const Net = {
  socket: null,
  id: null,
  connected: false,
  state: 'offline',       // offline | lobby | countdown | live | over
  seed: 1,
  minPlayers: 2,
  countdown: 0,
  roster: [],
  remotes: new Map(),     // id -> { x, y, z, yaw, tx, ty, tz, tyaw, hp, alive, figure }
  storm: null,
  handlers: {},
  sendTimer: 0,
  SEND_RATE: 1 / 20,

  on(event, fn) {
    this.handlers[event] = fn;
    return this;
  },

  emit(event, payload) {
    if (this.handlers[event]) this.handlers[event](payload);
  },

  /* Same host and port the page came from, so there is nothing to configure. */
  url() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${location.host}`;
  },

  connect(name) {
    if (this.socket) return;
    let socket;
    try {
      socket = new WebSocket(this.url());
    } catch {
      this.emit('error', 'Could not open a connection');
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.connected = true;
      this.send('name', { name });
      this.emit('open');
    };

    socket.onclose = () => {
      this.connected = false;
      this.socket = null;
      this.state = 'offline';
      this.remotes.forEach((r) => this.emit('despawn', r));
      this.remotes.clear();
      this.emit('close');
    };

    socket.onerror = () => this.emit('error', 'Connection failed');

    socket.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this.receive(msg);
    };
  },

  disconnect() {
    if (this.socket) this.socket.close();
  },

  send(type, data) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ t: type, ...data }));
  },

  /* ---------- Inbound ---------- */

  receive(msg) {
    switch (msg.t) {
      case 'welcome':
        this.id = msg.id;
        this.seed = msg.seed;
        this.state = msg.state;
        this.storm = msg.storm;
        this.roster = msg.players || [];
        this.minPlayers = msg.minPlayers || 2;
        this.emit('welcome', msg);
        break;

      case 'roster':
        this.roster = msg.players || [];
        this.state = msg.state || this.state;
        this.emit('roster', msg);
        break;

      case 'start':
        this.seed = msg.seed;
        this.storm = msg.storm;
        this.state = 'countdown';
        this.countdown = msg.countdown;
        this.emit('start', msg);
        break;

      case 'live':
        this.state = 'live';
        this.storm = msg.storm || this.storm;
        this.emit('live', msg);
        break;

      case 'snap':
        this.applySnapshot(msg);
        break;

      case 'down':
        this.emit('down', msg);
        break;

      case 'over':
        this.state = 'over';
        this.roster = msg.players || this.roster;
        this.emit('over', msg);
        break;

      case 'lobby':
        this.state = 'lobby';
        this.emit('lobby', msg);
        break;

      case 'left': {
        const gone = this.remotes.get(msg.id);
        if (gone) {
          this.emit('despawn', gone);
          this.remotes.delete(msg.id);
        }
        break;
      }

      case 'build':
        this.emit('build', msg.piece);
        break;

      case 'broke':
        this.emit('broke', msg.index);
        break;

      case 'took':
        this.emit('took', msg.index);
        break;

      default:
        break;
    }
  },

  applySnapshot(msg) {
    if (msg.c) this.countdown = msg.c;

    if (msg.s) {
      this.storm = {
        x: msg.s[0], z: msg.s[1], radius: msg.s[2], damage: msg.s[3],
        timer: msg.s[4], shrinking: Boolean(msg.s[5]),
        nextX: msg.s[6], nextZ: msg.s[7], nextRadius: msg.s[8],
      };
    }

    const seen = new Set();
    (msg.p || []).forEach((row) => {
      const [id, x, y, z, yaw, slot, moving, hp, shield, alive] = row;
      seen.add(id);

      if (id === this.id) {
        // our own health is the server's business, not ours
        this.selfHp = hp;
        this.selfShield = shield;
        this.selfAlive = Boolean(alive);
        return;
      }

      let remote = this.remotes.get(id);
      if (!remote) {
        const info = this.roster.find((p) => p.id === id) || {};
        remote = {
          id, name: info.name || `Player ${id}`, colour: info.colour || 0x3b82f6,
          x, y, z, yaw, tx: x, ty: y, tz: z, tyaw: yaw,
          hp, shield, alive: Boolean(alive), slot, moving, figure: null, speed: 0,
        };
        this.remotes.set(id, remote);
        this.emit('spawn', remote);
      }

      remote.tx = x;
      remote.ty = y;
      remote.tz = z;
      remote.tyaw = yaw;
      remote.hp = hp;
      remote.shield = shield;
      remote.alive = Boolean(alive);
      remote.slot = slot;
      remote.moving = moving;
    });

    this.remotes.forEach((remote, id) => {
      if (seen.has(id)) return;
      this.emit('despawn', remote);
      this.remotes.delete(id);
    });
  },

  /* Ease remote players toward their reported position. */
  interpolate(dt) {
    const blend = Math.min(1, dt * 12);
    this.remotes.forEach((r) => {
      const before = { x: r.x, z: r.z };
      r.x += (r.tx - r.x) * blend;
      r.y += (r.ty - r.y) * blend;
      r.z += (r.tz - r.z) * blend;

      let delta = r.tyaw - r.yaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      r.yaw += delta * blend;

      // speed is inferred, so their legs move at the right rate
      r.speed = Math.hypot(r.x - before.x, r.z - before.z) / Math.max(dt, 0.001);
    });
  },

  /* ---------- Outbound ---------- */

  reportMove(dt, player) {
    this.sendTimer -= dt;
    if (this.sendTimer > 0) return;
    this.sendTimer = this.SEND_RATE;
    this.send('move', {
      x: Math.round(player.x * 10) / 10,
      y: Math.round(player.feetY * 10) / 10,
      z: Math.round(player.z * 10) / 10,
      yaw: Math.round(player.yaw * 100) / 100,
      slot: player.slot,
      moving: Math.round(Math.hypot(player.vx || 0, player.vz || 0)),
    });
  },

  reportShot(id, damage, headshot) {
    this.send('shot', { id, damage: Math.round(damage), head: headshot ? 1 : 0 });
  },

  reportHurt(amount) {
    this.send('hurt', { amount: Math.round(amount * 10) / 10 });
  },

  reportHeal(kind) {
    this.send('heal', { kind });
  },

  reportBuild(piece) {
    this.send('build', { piece });
  },

  reportBroke(index) {
    this.send('broke', { index });
  },

  reportTook(index) {
    this.send('took', { index });
  },

  setReady(ready) {
    this.send('ready', { ready });
  },
};

/* A tiny seeded generator, so every client builds the identical map from the
   seed the server hands out. mulberry32: small, fast, good enough spread. */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
