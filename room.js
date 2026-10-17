/* ARENA — authoritative match room. Runs on the Node server, and in the browser for offline practice.
   Flow: PLAY (a round on one map) -> VOTE (scoreboard + map vote) -> PLAY on the winning map -> ... */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const S = isNode ? require('./shared.js') : root.ArenaShared;
  const R = factory(S);
  if (isNode) module.exports = R; else root.ArenaRoom = R;
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  const COLORS = ['#ff4d5e', '#3fa9ff', '#4dff8a', '#ffcc33', '#c46bff', '#ff8a33', '#33ffe6', '#ff6bc4', '#b4ff33', '#f2f2f2', '#8a8aff', '#ff5a22'];
  const BOT_NAMES = ['Vex', 'Kilo', 'Rift', 'Nova', 'Grim', 'Hex', 'Bolt', 'Echo', 'Jinx', 'Shard', 'Talon', 'Volt'];
  const RESPAWN_MS = 2500, SPAWN_PROT_MS = 1000;

  const now = () => Date.now();
  function clean(s, n) {
    return String(s == null ? '' : s).replace(/[<>&"`\\]/g, '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n || 16);
  }
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const vec = (a) => (Array.isArray(a) && a.length === 3 ? [num(a[0]), num(a[1]), num(a[2])] : null);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const norm = (d) => { const l = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / l, d[1] / l, d[2] / l]; };
  const r2 = (v) => Math.round(v * 100) / 100;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  function hull(p) {
    const h = p.cr ? S.PHC : S.PH;
    return [[p.p[0] - S.PW, p.p[1], p.p[2] - S.PW], [p.p[0] + S.PW, p.p[1] + h, p.p[2] + S.PW]];
  }

  class Room {
    constructor(name, opts) {
      opts = opts || {};
      this.name = name;
      this.id = opts.id || name;
      this.priv = !!opts.priv;
      this.pw = opts.pw || '';
      this.max = Math.max(2, Math.min(12, opts.max | 0 || 12));
      this.fill = opts.fill == null ? 4 : opts.fill; // bots top the room up to this many players
      this.persistent = !!opts.persistent;
      this.players = new Map();
      this.nades = [];
      this.nextId = 1;
      this.rockets = []; this.nades = [];
      this.round = 1;
      this.phase = 'play';
      this.phaseEnd = now() + S.ROUND_SECONDS * 1000;
      this.options = [];
      this.votes = new Map();
      this.lastDecay = now();
      this.lastTick = now();
      this.emptySince = 0;
      this.setMap(opts.map | 0);
    }
    get inter() { return this.phase !== 'play'; }
    get humans() { let n = 0; for (const p of this.players.values()) if (!p.bot) n++; return n; }
    get botCount() { let n = 0; for (const p of this.players.values()) if (p.bot) n++; return n; }
    summary() { return { id: this.id, name: this.name, n: this.humans, b: this.botCount, max: this.max, map: this.map.name, round: this.round, priv: this.priv, main: this.persistent }; }
    timeLeft() { return Math.max(0, Math.round((this.phaseEnd - now()) / 1000)); }

    setMap(id) {
      this.map = S.getMap(id);
      this.boxes = this.map.boxes;
      this.pickups = this.map.pickups.map((k, i) => ({ id: i, type: k.type, p: k.p, on: true, at: 0 }));
      this.rockets = []; this.nades = [];
    }
    voteCounts() { return this.options.map((id) => [...this.votes.values()].filter((v) => v === id).length); }

    send(p, obj) { if (p.conn) { try { p.conn.send(JSON.stringify(obj)); } catch (e) {} } }
    broadcast(obj, except) {
      const s = JSON.stringify(obj);
      for (const p of this.players.values()) if (p.conn && p !== except) { try { p.conn.send(s); } catch (e) {} }
    }
    pub(p) { return { id: p.id, name: p.name, color: p.color, f: p.frags, d: p.deaths, w: p.wins, bot: !!p.bot, alive: p.alive }; }

    addPlayer(conn, name, isBot, util) {
      const id = this.nextId++;
      const used = new Set([...this.players.values()].map((q) => q.color));
      const color = COLORS.find((c) => !used.has(c)) || COLORS[id % COLORS.length];
      const p = {
        id, conn: conn || null, name: clean(name) || 'Player' + id, color,
        p: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0, cr: 0,
        hp: 100, ar: 0, alive: false, frags: 0, deaths: 0, wins: 0, lastFire: {}, respawnAt: 0, spawnT: 0, lastPt: 0,
        util: S.UTILS[util] ? util : (isBot ? 'frag' : null), pendingUtil: undefined, uCharge: 0, shieldUntil: 0, nadeCid: 0,
        bot: isBot ? { wp: null, wpUntil: 0, vy: 0, ground: true, nextShot: 0, nextNade: 0, cid: 0 } : null,
      };
      this.players.set(id, p);
      if (conn) {
        this.send(p, {
          t: 'welcome', id, room: this.name, rid: this.id, priv: this.priv, v: S.VERSION,
          map: this.map.id, round: this.round, phase: this.phase, tl: this.timeLeft(),
          options: this.options, counts: this.voteCounts(),
          players: [...this.players.values()].map((q) => this.pub(q)),
          pickups: this.pickups.map((k) => [k.id, k.on ? 1 : 0]),
        });
      }
      this.broadcast({ t: 'pjoin', ...this.pub(p) }, p);
      this.spawn(p); // during a vote you can still run around the old map
      return p;
    }

    removePlayer(p) {
      if (!this.players.has(p.id)) return;
      this.players.delete(p.id);
      p.conn = null;
      if (this.votes.delete(p.id)) this.broadcast({ t: 'votes', counts: this.voteCounts() });
      this.broadcast({ t: 'pleave', id: p.id });
    }

    spawn(p) {
      const t = now();
      const others = [...this.players.values()].filter((q) => q !== p && q.alive);
      let pool = this.map.spawns;
      if (p.bot) pool = pool.filter((s) => s.p[1] === 0);
      const scored = pool.map((s) => ({
        s, d: others.length ? Math.min(...others.map((o) => dist(o.p, s.p))) : Math.random() * 10,
      })).sort((a, b) => b.d - a.d);
      const pick = scored[Math.floor(Math.random() * Math.min(3, scored.length))].s;
      p.p = pick.p.slice(); p.vel = [0, 0, 0]; p.yaw = pick.yaw; p.pitch = 0; p.cr = 0;
      p.hp = 100; p.ar = 0; p.alive = true; p.spawnT = t; p.respawnAt = 0; p.lastPt = 0;
      if (p.pendingUtil !== undefined) { p.util = p.pendingUtil; p.pendingUtil = undefined; }
      p.uCharge = p.util ? S.UTILS[p.util].charges : 0; p.shieldUntil = 0;
      if (p.bot) p.bot.nextNade = t + 6000 + Math.random() * 6000;
      if (p.bot) { p.bot.vy = 0; p.bot.wp = null; p.bot.nextShot = t + 1500 + Math.random() * 1200; }
      this.broadcast({ t: 'spawn', id: p.id, p: p.p, yaw: r2(p.yaw) });
      this.send(p, { t: 'hp', hp: p.hp, ar: p.ar });
    }

    // ---------- client messages ----------
    handle(p, m) {
      if (!m || typeof m.t !== 'string' || !this.players.has(p.id)) return;
      switch (m.t) {
        case 's': {
          const v = vec(m.p);
          if (!v || !p.alive) return;
          const t = now();
          if (p.lastPt) {
            const dt = (t - p.lastPt) / 1000;
            if (dt > 0.005) p.vel = [(v[0] - p.p[0]) / dt, (v[1] - p.p[1]) / dt, (v[2] - p.p[2]) / dt];
          }
          p.lastPt = t; p.p = v; p.yaw = num(m.yaw); p.pitch = num(m.pitch); p.cr = m.cr ? 1 : 0;
          break;
        }
        case 'shoot': this.onShoot(p, m); break;
        case 'rocket': this.onRocket(p, m); break;
        case 'pick': this.onPick(p, m); break;
        case 'vote': {
          const id = m.map | 0;
          if (this.phase !== 'vote' || !this.options.includes(id)) return;
          this.votes.set(p.id, id);
          this.broadcast({ t: 'votes', counts: this.voteCounts() });
          break;
        }
        case 'chat': {
          const text = clean(m.text, 120);
          if (text) this.broadcast({ t: 'chat', id: p.id, name: p.name, color: p.color, text });
          break;
        }
        case 'suicide': if (p.alive) this.kill(p, null, 'void'); break;
        case 'loadout': p.pendingUtil = S.UTILS[m.u] ? m.u : null; break; // takes effect on respawn; null = a movement ability
        case 'nade': this.onNade(p, m); break;
        case 'ability': this.onAbility(p, m); break;
        case 'ping': this.send(p, { t: 'pong', ts: num(m.ts) }); break;
      }
    }

    useUtil(p, a) {
      if (!p.alive || this.inter || p.util !== a || p.uCharge < 1) return false;
      p.uCharge -= 1;
      return true;
    }
    onNade(p, m) {
      let o = vec(m.o), v = vec(m.v);
      if (!o || !v || !this.useUtil(p, 'frag')) return;
      const eye = [p.p[0], p.p[1] + 1.5, p.p[2]];
      if (dist(o, eye) > 3) o = eye;
      const sp = Math.hypot(v[0], v[1], v[2]);
      if (sp > 40) v = v.map((x) => x * 40 / sp);
      this.throwNade(p, o.map(r3), v.map(r3), m.cid | 0);
    }
    throwNade(p, o, v, cid) {
      const id = p.id + ':n' + cid;
      const path = S.nadePath(o, v, this.boxes);
      this.nades.push({ id, owner: p.id, pos: path[path.length - 1], at: now() + S.NADE.fuse * 1000 });
      this.broadcast({ t: 'nade', id, owner: p.id, o, v }, p.bot ? null : p);
    }
    onAbility(p, m) {
      if (m.a === 'frag' || !this.useUtil(p, m.a)) return;
      if (m.a === 'stim') { if (p.hp < 100) p.hp = Math.min(100, p.hp + 40); this.send(p, { t: 'hp', hp: p.hp, ar: p.ar }); }
      if (m.a === 'shield') p.shieldUntil = now() + 3000;
      this.broadcast({ t: 'abil', id: p.id, a: m.a, dur: 3000 });
    }
    explodeNade(n) {
      this.broadcast({ t: 'boom', id: n.id, owner: n.owner, p: n.pos.map(r2), k: 'nade' });
      const owner = this.players.get(n.owner) || null, N = S.NADE;
      for (const q of [...this.players.values()]) {
        if (!q.alive) continue;
        const [mn, mx] = hull(q);
        const d = S.boxDist(n.pos, mn, mx);
        if (d >= N.r) continue;
        let dmg = N.dmg * (1 - d / N.r);
        if (q.id === n.owner) dmg *= S.SELF_DMG;
        if (q.bot) q.bot.vy = Math.max(q.bot.vy, 9 * (1 - d / N.r));
        if (dmg >= 1) this.damage(q, owner, dmg, 'nade', n.pos);
      }
    }

    canFire(p, w) {
      const W = S.WEAPONS[w];
      if (!W || !p.alive || this.inter) return false;
      const t = now();
      if (t - (p.lastFire[w] || 0) < W.cd * 1000 * 0.8) return false;
      p.lastFire[w] = t;
      return true;
    }

    onShoot(p, m) {
      const w = m.w;
      if (w === 'rocket' || !this.canFire(p, w)) return;
      const W = S.WEAPONS[w];
      const o = vec(m.o) || [p.p[0], p.p[1] + 1.5, p.p[2]];
      const ends = (Array.isArray(m.ends) ? m.ends.slice(0, W.pellets) : []).map(vec).filter(Boolean).map((e) => e.map(r2));
      this.broadcast({ t: 'shot', id: p.id, w, o: o.map(r2), ends }, p);
      const tally = new Map();
      for (const h of (Array.isArray(m.hits) ? m.hits.slice(0, 32) : [])) {
        if (!Array.isArray(h)) continue;
        const id = h[0] | 0;
        tally.set(id, (tally.get(id) || 0) + Math.max(0, num(h[1])));
      }
      const cap = W.dmg * W.pellets;
      for (const [id, d] of tally) {
        const q = this.players.get(id);
        if (!q || q === p || !q.alive) continue;
        this.damage(q, p, Math.min(cap, d), w, o);
      }
    }

    onRocket(p, m) {
      if (!this.canFire(p, 'rocket')) return;
      let o = vec(m.o), d = vec(m.d);
      if (!o || !d) return;
      const eye = [p.p[0], p.p[1] + 1.5, p.p[2]];
      if (dist(o, eye) > 4) o = eye;
      this.fireRocket(p, o, norm(d), m.cid | 0);
    }

    fireRocket(p, o, d, cid) {
      const id = p.id + ':' + cid;
      this.rockets.push({ id, owner: p.id, p: o.slice(), d, born: now() });
      this.broadcast({ t: 'rocket', id, owner: p.id, o: o.map(r2), d: d.map((v) => Math.round(v * 10000) / 10000) }, p);
    }

    onPick(p, m) {
      const k = this.pickups[m.id | 0];
      if (!k || !k.on || !p.alive) return;
      const dx = Math.hypot(p.p[0] - k.p[0], p.p[2] - k.p[2]), dy = p.p[1] - k.p[1];
      if (dx > 1.8 || dy < -1.2 || dy > 2.2) return;
      const T = S.PICKUP_TYPES[k.type];
      if (T.hp) { if (p.hp >= T.max) return; p.hp = Math.min(T.max, p.hp + T.hp); }
      if (T.ar) { if (p.ar >= T.max) return; p.ar = Math.min(T.max, p.ar + T.ar); }
      k.on = false; k.at = now() + T.respawn * 1000;
      this.broadcast({ t: 'pick', id: k.id, on: 0, by: p.id });
      this.send(p, { t: 'hp', hp: p.hp, ar: p.ar });
    }

    damage(v, a, amt, w, src) {
      if (!v.alive || this.inter || amt <= 0) return;
      const t = now();
      if (a && a !== v && t - v.spawnT < SPAWN_PROT_MS) return;
      if (v.shieldUntil > t) amt *= 0.4; // Barrier
      amt = Math.round(amt);
      let take = amt;
      if (v.ar > 0) { const save = Math.min(v.ar, Math.round(take * 0.66)); v.ar -= save; take -= save; }
      v.hp -= take;
      this.send(v, { t: 'hp', hp: Math.max(0, v.hp), ar: v.ar });
      this.send(v, { t: 'dmg', amt, src: src ? src.map(r2) : null, from: a ? a.id : 0 });
      let killed = false;
      if (v.hp <= 0) { this.kill(v, a, w); killed = true; }
      if (a && a !== v) this.send(a, { t: 'hitc', amt, k: killed ? 1 : 0 });
    }

    kill(v, a, w) {
      v.alive = false; v.hp = 0; v.deaths++;
      v.respawnAt = now() + RESPAWN_MS;
      const real = a && a !== v;
      if (real) a.frags++; else v.frags--;
      this.broadcast({ t: 'kill', k: real ? a.id : 0, v: v.id, w, kf: real ? a.frags : 0, vf: v.frags, vd: v.deaths });
      if (real && a.frags >= S.FRAGLIMIT) this.endRound();
    }

    // ---------- rounds & voting ----------
    endRound() {
      if (this.phase !== 'play') return;
      const ranked = [...this.players.values()].sort((a, b) => b.frags - a.frags || a.deaths - b.deaths);
      const winner = ranked[0] && ranked[0].frags > 0 ? ranked[0] : null;
      if (winner) winner.wins++;
      this.phase = 'vote';
      this.phaseEnd = now() + S.VOTE_SECONDS * 1000;
      const ids = S.MAPS.map((m) => m.id);
      // up to 3 options; with more maps than that, offer 3 maps other than the one just played
      this.options = ids.length <= 3 ? ids : ids.filter((id) => id !== this.map.id).sort(() => Math.random() - 0.5).slice(0, 3).sort((a, b) => a - b);
      this.votes = new Map();
      this.rockets = []; this.nades = [];
      this.broadcast({
        t: 'end', round: this.round, winner: winner ? winner.id : 0,
        scores: ranked.map((p) => this.pub(p)), options: this.options, counts: this.voteCounts(), tl: this.timeLeft(),
      });
    }

    startRound() {
      const counts = this.voteCounts();
      const top = Math.max(0, ...counts);
      let pool = this.options.filter((id, i) => counts[i] === top);
      if (top === 0) pool = this.options.filter((id) => id !== this.map.id); // nobody voted: switch it up
      if (!pool.length) pool = [this.map.id];
      this.setMap(pool[Math.floor(Math.random() * pool.length)]);
      this.round++;
      this.phase = 'play';
      this.phaseEnd = now() + S.ROUND_SECONDS * 1000;
      this.options = []; this.votes = new Map();
      for (const p of this.players.values()) { p.frags = 0; p.deaths = 0; p.alive = false; }
      this.broadcast({
        t: 'start', map: this.map.id, round: this.round, tl: this.timeLeft(),
        players: [...this.players.values()].map((p) => this.pub(p)),
        pickups: this.pickups.map((k) => [k.id, 1]),
      });
      for (const p of this.players.values()) this.spawn(p);
    }

    // ---------- bots ----------
    manageBots() {
      const h = this.humans;
      const want = h > 0 ? Math.max(0, Math.min(this.fill, this.max) - h) : 0;
      const bots = [...this.players.values()].filter((p) => p.bot);
      if (bots.length < want) {
        const used = new Set([...this.players.values()].map((p) => p.name));
        const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot' + this.nextId;
        this.addPlayer(null, name, true);
      } else if (bots.length > want) {
        this.removePlayer(bots[bots.length - 1]);
      }
    }

    pickWaypoint(p, t) {
      const b = p.bot, wps = S.botWps(this.map);
      for (let i = 0; i < 14; i++) {
        const wp = wps[Math.floor(Math.random() * wps.length)];
        const dx = wp[0] - p.p[0], dz = wp[2] - p.p[2];
        const l = Math.hypot(dx, dz);
        if (l < 5 || l > 40) continue;
        const d = [dx / l, 0, dz / l];
        if (S.rayWorld([p.p[0], 0.5, p.p[2]], d, l, this.boxes) < l - 0.1) continue;
        if (S.rayWorld([p.p[0], 1.5, p.p[2]], d, l, this.boxes) < l - 0.1) continue;
        b.wp = wp; b.wpUntil = t + 7000;
        return;
      }
      b.wp = null; b.wpUntil = t + 400;
    }

    updateBot(p, dt, t) {
      const b = p.bot;
      if (!p.alive) return;
      b.vy -= 21 * dt;
      p.p[1] += b.vy * dt;
      if (p.p[1] <= 0) { p.p[1] = 0; b.vy = 0; b.ground = true; } else b.ground = false;
      if (!b.wp || t > b.wpUntil || Math.hypot(b.wp[0] - p.p[0], b.wp[2] - p.p[2]) < 1.2) this.pickWaypoint(p, t);
      let mx = 0, mz = 0;
      if (b.wp) {
        const dx = b.wp[0] - p.p[0], dz = b.wp[2] - p.p[2];
        const l = Math.hypot(dx, dz) || 1;
        const sp = 7.5;
        const nx = p.p[0] + (dx / l) * sp * dt, nz = p.p[2] + (dz / l) * sp * dt;
        if (S.hitAt(nx, p.p[1] + 0.05, nz, S.PH, 0, this.boxes)) { b.wp = null; }
        else { p.p[0] = nx; p.p[2] = nz; mx = (dx / l) * sp; mz = (dz / l) * sp; }
      }
      p.vel = [mx, b.vy, mz];
      if (b.ground && Math.random() < dt * 0.45) b.vy = 7.5;
      const eye = [p.p[0], p.p[1] + 1.5, p.p[2]];
      let best = null, bd = 48;
      for (const q of this.players.values()) {
        if (q === p || !q.alive) continue;
        const c = [q.p[0], q.p[1] + 1.0, q.p[2]];
        const d = dist(eye, c);
        if (d >= bd) continue;
        const dir = [(c[0] - eye[0]) / d, (c[1] - eye[1]) / d, (c[2] - eye[2]) / d];
        if (S.rayWorld(eye, dir, d, this.boxes) < d - 0.6) continue;
        best = q; bd = d;
      }
      if (best) {
        const tt = bd / S.ROCKET_SPEED;
        const grounded = Math.abs(best.vel[1]) < 0.5;
        const aim = [
          best.p[0] + best.vel[0] * tt * 0.75 + (Math.random() - 0.5) * 1.4,
          best.p[1] + (grounded ? 0.15 : 0.9 + best.vel[1] * tt * 0.4),
          best.p[2] + best.vel[2] * tt * 0.75 + (Math.random() - 0.5) * 1.4,
        ];
        const d = norm([aim[0] - eye[0], aim[1] - eye[1], aim[2] - eye[2]]);
        p.yaw = Math.atan2(-d[0], -d[2]);
        p.pitch = Math.asin(Math.max(-1, Math.min(1, d[1])));
        if (t >= b.nextShot && !this.inter && t - p.spawnT > 800) {
          b.nextShot = t + 2000 + Math.random() * 1800;
          p.lastFire.rocket = t;
          this.fireRocket(p, [eye[0] + d[0] * 0.5, eye[1] + d[1] * 0.5, eye[2] + d[2] * 0.5], d, ++b.cid);
        }
        if (t >= b.nextNade && bd > 6 && bd < 24 && !this.inter && t - p.spawnT > 1500 && p.uCharge >= 1) {
          b.nextNade = t + 9000 + Math.random() * 7000;
          p.uCharge -= 1;
          const T = 1.0 + bd * 0.02, hx = best.p[0] - eye[0], hz = best.p[2] - eye[2], hl = Math.hypot(hx, hz) || 1;
          const vh = Math.min(22, hl / T), vy = (best.p[1] + 0.3 - eye[1]) / T + 0.5 * S.NADE.g * T;
          this.throwNade(p, eye.map(r3), [hx / hl * vh, Math.min(16, vy), hz / hl * vh].map(r3), ++p.nadeCid);
        }
      } else if (mx || mz) {
        p.yaw = Math.atan2(-mx, -mz);
        p.pitch = 0;
      }
    }

    // ---------- rockets ----------
    updateRockets(dt, t) {
      const step = S.ROCKET_SPEED * dt;
      const keep = [];
      for (const r of this.rockets) {
        let hitT = S.rayWorld(r.p, r.d, step, this.boxes);
        let direct = null;
        for (const q of this.players.values()) {
          if (!q.alive || q.id === r.owner) continue;
          const [mn, mx] = hull(q);
          mn[0] -= 0.1; mn[2] -= 0.1; mx[0] += 0.1; mx[2] += 0.1;
          const tt = S.rayAABB(r.p, r.d, mn, mx);
          if (tt >= 0 && tt < hitT) { hitT = tt; direct = q; }
        }
        if (hitT < step) {
          const pos = [r.p[0] + r.d[0] * (hitT - 0.05), r.p[1] + r.d[1] * (hitT - 0.05), r.p[2] + r.d[2] * (hitT - 0.05)];
          this.explode(r, pos, direct);
        } else {
          r.p[0] += r.d[0] * step; r.p[1] += r.d[1] * step; r.p[2] += r.d[2] * step;
          if (t - r.born < 6000) keep.push(r);
        }
      }
      this.rockets = keep;
    }

    explode(r, pos, direct) {
      this.broadcast({ t: 'boom', id: r.id, owner: r.owner, p: pos.map(r2) });
      const owner = this.players.get(r.owner) || null;
      for (const q of [...this.players.values()]) {
        if (!q.alive) continue;
        const [mn, mx] = hull(q);
        const d = q === direct ? 0 : S.boxDist(pos, mn, mx);
        if (d >= S.ROCKET_R) continue;
        let dmg = S.WEAPONS.rocket.dmg * (1 - d / S.ROCKET_R);
        if (q.id === r.owner) dmg *= S.SELF_DMG;
        if (q.bot) q.bot.vy = Math.max(q.bot.vy, 9 * (1 - d / S.ROCKET_R));
        if (dmg >= 1) this.damage(q, owner, dmg, 'rocket', pos);
      }
    }

    // ---------- main tick ----------
    tick() {
      const t = now();
      const dt = Math.min(0.1, (t - this.lastTick) / 1000);
      this.lastTick = t;
      this.manageBots();

      for (const p of this.players.values()) {
        if (!p.alive && p.respawnAt && t >= p.respawnAt) this.spawn(p);
        if (p.bot) this.updateBot(p, dt, t);
      }
      if (!this.inter) this.updateRockets(dt, t);
      for (const p of this.players.values()) {
        const U = S.UTILS[p.util];
        if (U && p.alive && p.uCharge < U.charges) p.uCharge = Math.min(U.charges, p.uCharge + dt / U.cd);
      }
      if (this.nades.length) {
        const due = this.nades.filter((n) => t >= n.at);
        if (due.length) { this.nades = this.nades.filter((n) => t < n.at); if (!this.inter) due.forEach((n) => this.explodeNade(n)); }
      }

      for (const k of this.pickups) {
        if (!k.on && t >= k.at) { k.on = true; this.broadcast({ t: 'pick', id: k.id, on: 1 }); }
      }
      if (t - this.lastDecay >= 1000) {
        this.lastDecay = t;
        for (const p of this.players.values()) {
          if (!p.alive) continue;
          let ch = false;
          if (p.hp > 100) { p.hp--; ch = true; }
          if (p.ar > 100) { p.ar--; ch = true; }
          if (ch) this.send(p, { t: 'hp', hp: p.hp, ar: p.ar });
        }
      }
      if (t >= this.phaseEnd) { if (this.phase === 'play') this.endRound(); else this.startRound(); }

      const ps = [];
      for (const p of this.players.values()) {
        ps.push([p.id, r2(p.p[0]), r2(p.p[1]), r2(p.p[2]), r2(p.yaw), r2(p.pitch), p.cr, p.alive ? 1 : 0]);
      }
      this.broadcast({ t: 'snap', tl: this.timeLeft(), ps });
    }
  }
  Room.clean = clean;
  return Room;
});
