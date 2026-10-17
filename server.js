/* ARENA — multiplayer server. Serves the game AND hosts WebSocket rooms.
   Run locally:  npm install && npm start   →  http://localhost:8080
   On Render:    Web Service, build "npm install", start "npm start". */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Room = require('./room.js');
const S = require('./shared.js');
Room.mapCount = S.MAPS.length;
// optional tuning via environment variables (e.g. on Render: Environment tab)
if (+process.env.ROUND_SECONDS > 0) S.ROUND_SECONDS = +process.env.ROUND_SECONDS;
if (+process.env.FRAGLIMIT > 0) S.FRAGLIMIT = +process.env.FRAGLIMIT;
if (+process.env.VOTE_SECONDS > 0) S.VOTE_SECONDS = +process.env.VOTE_SECONDS;

const PORT = process.env.PORT || 8080;
const TICK_HZ = 30;
const MAX_ROOMS = 24;
const MAIN_ID = 'main';

const STATIC = {
  '/index.html': 'text/html; charset=utf-8',
  '/shared.js': 'application/javascript; charset=utf-8',
  '/room.js': 'application/javascript; charset=utf-8',
};

const rooms = new Map(); // id -> Room
rooms.set(MAIN_ID, new Room('Main Arena', { id: MAIN_ID, persistent: true, fill: 4 }));
const roomList = () => [...rooms.values()].map((r) => r.summary())
  .sort((a, b) => (b.main - a.main) || (b.n - a.n) || a.name.localeCompare(b.name));
function newId() {
  let id;
  do { id = Math.random().toString(36).slice(2, 8); } while (rooms.has(id));
  return id;
}

// ---- lobby chat: everyone connected but not inside a match
const lobby = new Set();
const lobbyLog = [];
function lobbySend(o) { const s = JSON.stringify(o); for (const c of lobby) c.send(s); }
function lobbyPost(name, text, sys) {
  const msg = { name, text, sys: !!sys, ts: Date.now() };
  lobbyLog.push(msg);
  if (lobbyLog.length > 50) lobbyLog.shift();
  lobbySend({ t: 'lchat', ...msg });
}

const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  const file = p === '/' ? '/index.html' : p;
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (file === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (file === '/rooms') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(roomList())); }
  if (STATIC[file]) {
    return fs.readFile(path.join(__dirname, file.slice(1)), (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': STATIC[file], 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

const wss = new WebSocketServer({ server, maxPayload: 32 * 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let room = null, player = null;
  let windowStart = Date.now(), count = 0;
  const conn = { send(s) { if (ws.readyState === 1 && ws.bufferedAmount < 2e6) ws.send(s); } };
  const reply = (o) => conn.send(JSON.stringify(o));
  let lastChat = 0;
  lobby.add(conn);

  ws.on('message', (data) => {
    const t = Date.now();
    if (t - windowStart > 1000) { windowStart = t; count = 0; }
    if (++count > 160) return; // flood guard
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;

    if (!player) {
      if (m.t === 'list') {
        reply({ t: 'rooms', list: roomList() });
        return reply({ t: 'lhist', msgs: lobbyLog, online: wss.clients.size });
      }
      if (m.t === 'lchat') {
        if (t - lastChat < 700) return;
        lastChat = t;
        const text = Room.clean(m.text, 140);
        if (text) lobbyPost(Room.clean(m.name, 16) || 'Player', text);
        return;
      }
      if (m.t === 'ping') return reply({ t: 'pong', ts: m.ts });
      if (m.t === 'create') {
        const lname = Room.clean(m.lname, 24);
        if (!lname) return reply({ t: 'err', where: 'create', msg: 'Give your lobby a name.' });
        if ([...rooms.values()].some((r) => r.name.toLowerCase() === lname.toLowerCase())) return reply({ t: 'err', where: 'create', msg: 'A lobby with that name already exists.' });
        if (rooms.size >= MAX_ROOMS) return reply({ t: 'err', where: 'create', msg: 'This server has too many lobbies right now. Try again later.' });
        const priv = !!m.priv, pw = Room.clean(m.pw, 24);
        if (priv && !pw) return reply({ t: 'err', where: 'create', msg: 'Private lobbies need a password.' });
        const fill = Number.isFinite(m.fill) ? Math.max(0, Math.min(8, m.fill | 0)) : 4;
        const map = Number.isFinite(m.map) ? Math.max(0, Math.min(Room.mapCount - 1, m.map | 0)) : 0;
        const max = Number.isFinite(m.max) ? Math.max(2, Math.min(12, m.max | 0)) : 8;
        const r = new Room(lname, { id: newId(), fill: Math.min(fill, max), map, max, priv, pw });
        rooms.set(r.id, r);
        console.log(`lobby created: ${lname} (${priv ? 'private' : 'public'})`);
        lobbySend({ t: 'rooms', list: roomList() });
        return enter(r, m);
      }
      if (m.t === 'join') {
        const r = rooms.get(String(m.id || ''));
        if (!r) { reply({ t: 'err', where: 'join', msg: 'That lobby has closed.' }); return reply({ t: 'rooms', list: roomList() }); }
        if (r.humans >= r.max) return reply({ t: 'err', where: 'join', msg: 'That lobby is full.' });
        if (r.priv && String(m.pw || '') !== r.pw) return reply({ t: 'err', where: 'join', code: 'pw', id: r.id, msg: m.pw ? 'Wrong password.' : 'This lobby is private.' });
        return enter(r, m);
      }
      return;
    }
    if (m.t === 'leave') { // back to the server list, same connection
      room.removePlayer(player);
      console.log(`${player.name} left ${room.name}`);
      room = null; player = null;
      lobby.add(conn);
      reply({ t: 'rooms', list: roomList() });
      return reply({ t: 'lhist', msgs: lobbyLog, online: wss.clients.size });
    }
    room.handle(player, m);
  });
  function enter(r, m) {
    room = r;
    lobby.delete(conn);
    player = r.addPlayer(conn, m.name, false, m.util);
    if (!r.priv) lobbyPost('', `${player.name} joined ${r.name} (${r.map.name})`, true);
    console.log(`${player.name} joined ${r.name} (${r.humans} humans)`);
  }

  ws.on('close', () => {
    lobby.delete(conn);
    if (room && player) {
      room.removePlayer(player);
      console.log(`${player.name} left ${room.name}`);
    }
    room = null; player = null;
  });
  ws.on('error', () => {});
});

// game loop
setInterval(() => {
  const t = Date.now();
  for (const [name, r] of rooms) {
    try { r.tick(); } catch (e) { console.error('tick error in', name, e); }
    if (!r.persistent) {
      if (r.humans === 0) {
        if (!r.emptySince) r.emptySince = t;
        else if (t - r.emptySince > 60000) { rooms.delete(name); console.log(`room closed: ${name}`); }
      } else r.emptySince = 0;
    }
  }
}, 1000 / TICK_HZ);

// keep the lobby's room list and player count fresh
setInterval(() => {
  if (!lobby.size) return;
  lobbySend({ t: 'rooms', list: roomList() });
  lobbySend({ t: 'online', n: wss.clients.size });
}, 3000);

// keep-alive (also stops idle proxies from dropping sockets)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 25000);

server.listen(PORT, () => console.log(`ARENA server listening on :${PORT}`));
