/* LAN game server for Bot Royale.

   One process does both jobs: it serves the game files over HTTP and runs the
   authoritative match over a WebSocket on the same port, so only one port ever
   needs opening in the firewall.

   What the server owns (and therefore what cannot disagree between players):
     - the world seed, so every client builds a byte-identical map
     - the roster, and who is alive
     - health, and all damage
     - the storm: centre, radius, phase and the clock
     - every structure anyone builds, and every tree or rock anyone fells
     - loot that has been taken
     - match flow, and who won

   What clients own: their own movement. On a LAN that is a couple of
   milliseconds of trust in exchange for controls that never feel laggy. */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || 8080);
const TICK = 1000 / 20;          // 20 snapshots a second
const MIN_PLAYERS = 2;
const COUNTDOWN = 8;             // seconds once enough players are ready

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/* ---------- Static files ---------- */

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);

  if (!file.startsWith(ROOT) || rel.startsWith('node_modules')) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': rel.endsWith('.glb') ? 'public, max-age=86400' : 'no-store',
    });
    res.end(data);
  });
});

/* ---------- Match state ---------- */

const COLOURS = [0xef4444, 0x3b82f6, 0x22c55e, 0xeab308, 0xa855f7, 0xf97316,
  0x14b8a6, 0xec4899, 0x84cc16, 0x0ea5e9];

const PHASES = [
  { wait: 26, shrink: 20, radius: 78, damage: 1 },
  { wait: 18, shrink: 18, radius: 54, damage: 2 },
  { wait: 14, shrink: 16, radius: 34, damage: 4 },
  { wait: 12, shrink: 14, radius: 18, damage: 7 },
  { wait: 10, shrink: 14, radius: 6, damage: 10 },
];

const match = {
  state: 'lobby',            // lobby | countdown | live | over
  seed: 1,
  countdown: 0,
  clock: 0,
  players: new Map(),        // id -> player
  builds: [],                // every structure placed this match
  broken: [],                // indices of felled terrain
  taken: [],                 // loot ids picked up
  storm: null,
  winner: null,
  nextId: 1,
};

function resetMatch() {
  match.seed = (Math.random() * 0x7fffffff) | 0 || 1;
  match.builds = [];
  match.broken = [];
  match.taken = [];
  match.clock = 0;
  match.winner = null;
  match.storm = {
    x: (Math.random() - 0.5) * 30,
    z: (Math.random() - 0.5) * 30,
    radius: 130,
    target: 130,
    phase: 0,
    timer: PHASES[0].wait,
    shrinking: false,
    damage: PHASES[0].damage,
    nextX: 0,
    nextZ: 0,
    nextRadius: PHASES[0].radius,
  };
  planNext();

  let slot = 0;
  match.players.forEach((p) => {
    const angle = (slot / Math.max(1, match.players.size)) * Math.PI * 2;
    p.x = Math.cos(angle) * 72;
    p.z = Math.sin(angle) * 72;
    p.y = 78;                 // everyone drops in
    p.yaw = Math.atan2(-p.x, -p.z);
    p.hp = 100;
    p.shield = 0;
    p.alive = true;
    p.kills = 0;
    p.placement = 0;
    p.ready = false;
    slot += 1;
  });
}

function planNext() {
  const storm = match.storm;
  const phase = PHASES[Math.min(storm.phase, PHASES.length - 1)];
  storm.nextRadius = phase.radius;
  storm.nextX = storm.x + (Math.random() - 0.5) * storm.radius * 0.35;
  storm.nextZ = storm.z + (Math.random() - 0.5) * storm.radius * 0.35;
}

const living = () => [...match.players.values()].filter((p) => p.alive);

/* ---------- Wire ---------- */

const wss = new WebSocketServer({ server });

function send(socket, type, data) {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify({ t: type, ...data }));
}

function broadcast(type, data, except) {
  const payload = JSON.stringify({ t: type, ...data });
  wss.clients.forEach((socket) => {
    if (socket !== except && socket.readyState === socket.OPEN) socket.send(payload);
  });
}

function roster() {
  return [...match.players.values()].map((p) => ({
    id: p.id, name: p.name, colour: p.colour, hp: p.hp, shield: p.shield,
    alive: p.alive, kills: p.kills, ready: p.ready, placement: p.placement,
  }));
}

function pushRoster() {
  broadcast('roster', { players: roster(), state: match.state, count: match.players.size });
}

wss.on('connection', (socket) => {
  const id = match.nextId++;
  const player = {
    id,
    socket,
    name: `Player ${id}`,
    colour: COLOURS[(id - 1) % COLOURS.length],
    x: 0, y: 0, z: 0, yaw: 0,
    slot: 0, moving: 0,
    hp: 100, shield: 0, alive: true, kills: 0, placement: 0, ready: false,
  };
  match.players.set(id, player);

  send(socket, 'welcome', {
    id,
    seed: match.seed,
    state: match.state,
    storm: match.storm,
    builds: match.builds,
    broken: match.broken,
    taken: match.taken,
    players: roster(),
    minPlayers: MIN_PLAYERS,
  });
  pushRoster();
  console.log(`+ player ${id} joined (${match.players.size} connected)`);

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    handle(player, msg);
  });

  socket.on('close', () => {
    match.players.delete(id);
    console.log(`- player ${id} left (${match.players.size} connected)`);
    broadcast('left', { id });
    pushRoster();
    if (match.state === 'live') checkWinner();
    if (match.players.size === 0) {
      match.state = 'lobby';
      resetMatch();
    }
  });
});

function handle(player, msg) {
  switch (msg.t) {
    case 'name':
      player.name = String(msg.name || '').slice(0, 14) || `Player ${player.id}`;
      pushRoster();
      break;

    case 'ready':
      player.ready = Boolean(msg.ready);
      pushRoster();
      maybeStart();
      break;

    /* Movement is trusted: on a LAN the alternative is laggy controls. */
    case 'move':
      player.x = msg.x;
      player.y = msg.y;
      player.z = msg.z;
      player.yaw = msg.yaw;
      player.slot = msg.slot | 0;
      player.moving = msg.moving || 0;
      break;

    /* Damage is not trusted to the victim's client — the shooter reports, the
       server applies, so both sides always agree on who died. */
    case 'shot': {
      const victim = match.players.get(msg.id);
      if (!victim || !victim.alive || !player.alive || match.state !== 'live') break;
      applyDamage(victim, Number(msg.damage) || 0, player);
      break;
    }

    case 'hurt':
      // storm and fall damage, which only the client can measure
      if (player.alive && match.state === 'live') applyDamage(player, Number(msg.amount) || 0, null);
      break;

    case 'heal':
      if (!player.alive) break;
      if (msg.kind === 'shield') player.shield = Math.min(100, player.shield + 50);
      else player.hp = Math.min(100, player.hp + 50);
      pushRoster();
      break;

    case 'build':
      if (match.state !== 'live') break;
      match.builds.push(msg.piece);
      broadcast('build', { piece: msg.piece }, player.socket);
      break;

    case 'broke':
      if (match.broken.includes(msg.index)) break;
      match.broken.push(msg.index);
      broadcast('broke', { index: msg.index }, player.socket);
      break;

    case 'took':
      if (match.taken.includes(msg.index)) break;
      match.taken.push(msg.index);
      broadcast('took', { index: msg.index }, player.socket);
      break;

    default:
      break;
  }
}

function applyDamage(victim, amount, from) {
  let left = amount;
  if (victim.shield > 0) {
    const absorbed = Math.min(victim.shield, left);
    victim.shield -= absorbed;
    left -= absorbed;
  }
  victim.hp -= left;

  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.alive = false;
    victim.placement = living().length + 1;
    if (from && from !== victim) from.kills += 1;
    broadcast('down', {
      id: victim.id,
      by: from ? from.id : null,
      byName: from ? from.name : 'the storm',
      placement: victim.placement,
      alive: living().length,
    });
    checkWinner();
  }
  pushRoster();
}

function maybeStart() {
  if (match.state !== 'lobby') return;
  const all = [...match.players.values()];
  if (all.length < MIN_PLAYERS) return;
  if (!all.every((p) => p.ready)) return;

  resetMatch();
  match.state = 'countdown';
  match.countdown = COUNTDOWN;
  broadcast('start', { seed: match.seed, storm: match.storm, countdown: COUNTDOWN, players: roster() });
  console.log(`match starting: ${all.length} players, seed ${match.seed}`);
}

function checkWinner() {
  if (match.state !== 'live') return;
  const alive = living();
  if (alive.length > 1) return;
  const winner = alive[0] || null;
  if (winner) winner.placement = 1;
  match.state = 'over';
  match.winner = winner ? winner.id : null;
  broadcast('over', {
    winner: match.winner,
    winnerName: winner ? winner.name : null,
    players: roster(),
  });
  console.log(`match over: ${winner ? winner.name : 'nobody'} won`);

  setTimeout(() => {
    match.state = 'lobby';
    resetMatch();
    pushRoster();
    broadcast('lobby', {});
  }, 9000);
}

/* ---------- Tick ---------- */

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - last) / 1000;
  last = now;

  if (match.state === 'countdown') {
    match.countdown -= dt;
    if (match.countdown <= 0) {
      match.state = 'live';
      match.clock = 0;
      broadcast('live', { storm: match.storm });
    }
  } else if (match.state === 'live') {
    match.clock += dt;
    stepStorm(dt);
  }

  /* snapshot */
  const players = [];
  match.players.forEach((p) => {
    players.push([p.id, round(p.x), round(p.y), round(p.z), round(p.yaw, 100),
      p.slot, p.moving | 0, Math.ceil(p.hp), Math.ceil(p.shield), p.alive ? 1 : 0]);
  });
  broadcast('snap', {
    p: players,
    s: match.state === 'live' ? [round(match.storm.x), round(match.storm.z),
      round(match.storm.radius), match.storm.damage,
      Math.max(0, Math.round(match.storm.timer)), match.storm.shrinking ? 1 : 0,
      round(match.storm.nextX), round(match.storm.nextZ), round(match.storm.nextRadius)] : null,
    c: match.state === 'countdown' ? Math.ceil(match.countdown) : 0,
  });
}, TICK);

const round = (v, f = 10) => Math.round(v * f) / f;

function stepStorm(dt) {
  const storm = match.storm;
  const phase = PHASES[Math.min(storm.phase, PHASES.length - 1)];
  storm.timer -= dt;

  if (!storm.shrinking) {
    if (storm.timer <= 0) {
      storm.shrinking = true;
      storm.timer = phase.shrink;
      storm.target = storm.nextRadius;
      storm.x = storm.nextX;
      storm.z = storm.nextZ;
    }
  } else {
    storm.radius += (storm.target - storm.radius) * Math.min(1, dt / Math.max(0.5, storm.timer));
    if (storm.timer <= 0) {
      storm.shrinking = false;
      storm.radius = storm.target;
      storm.phase = Math.min(storm.phase + 1, PHASES.length - 1);
      storm.timer = PHASES[storm.phase].wait;
      storm.damage = PHASES[storm.phase].damage;
      planNext();
    }
  }
}

/* ---------- Go ---------- */

resetMatch();

server.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  const addresses = [];
  Object.keys(nets).forEach((name) => {
    nets[name].forEach((net) => {
      if (net.family === 'IPv4' && !net.internal) addresses.push({ name, address: net.address });
    });
  });

  console.log('');
  console.log('  Bot Royale — LAN server');
  console.log(`  listening on port ${PORT}`);
  console.log('');
  console.log(`  this machine:  http://localhost:${PORT}/`);
  addresses.forEach((a) => console.log(`  on the network: http://${a.address}:${PORT}/    (${a.name})`));
  console.log('');
  console.log(`  waiting for ${MIN_PLAYERS}+ players to press READY`);
  console.log('');
});
