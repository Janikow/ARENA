/* ARENA — shared data & math. Loaded by the browser client AND the Node server. */
(function (root, factory) {
  const S = factory();
  if (typeof module === 'object' && module.exports) module.exports = S;
  else root.ArenaShared = S;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const S = {};
  S.VERSION = 2;

  // Player hull
  S.PW = 0.4;      // half width
  S.PH = 1.8;      // standing height
  S.PHC = 1.0;     // crouched height
  S.EYE = 1.6;
  S.EYEC = 0.85;

  // Rockets
  S.ROCKET_SPEED = 30;
  S.ROCKET_R = 4.5;      // splash radius
  S.ROCKET_KNOCK = 15;   // knockback impulse at point blank
  S.SELF_KNOCK = 1.2;    // your own rockets push you harder (rocket jumping)
  S.SELF_DMG = 0.3;      // ...and only hurt you 30%

  S.WEAPONS = {
    rocket:  { name: 'Rocket Launcher', short: 'RL', cd: 0.8,  dmg: 100, pellets: 1,  spread: 0,     color: '#ff6a2a' },
    rail:    { name: 'Railgun',         short: 'RG', cd: 1.5,  dmg: 85,  pellets: 1,  spread: 0,     color: '#36e0ff' },
    shotgun: { name: 'Shotgun',         short: 'SG', cd: 0.95, dmg: 7,   pellets: 11, spread: 0.07,  color: '#ffcf5a' },
    mg:      { name: 'Machinegun',      short: 'MG', cd: 0.1,  dmg: 7,   pellets: 1,  spread: 0.016, color: '#e8ecff' },
  };
  S.WORDER = ['rocket', 'rail', 'shotgun', 'mg'];

  // Abilities: one movement slot (Shift) and one utility slot (E)
  S.MOVES = {
    dash:  { name: 'Dash', desc: 'Burst of speed the way you are moving. 2 charges.' },
    blink: { name: 'Blink', desc: 'Teleport 8 m where you look and keep your momentum. 2 charges.' },
    djump: { name: 'Double Jump', desc: 'Press E in mid-air to jump again. Resets on landing.' },
    jet:   { name: 'Jetpack', desc: 'Hold E to fly. Fuel refills on the ground.' },
  };
  S.UTILS = {
    frag:   { name: 'Frag Grenade', desc: 'Bouncing grenade, 2 s fuse, big splash. 2 charges, 9 s each.', charges: 2, cd: 9 },
    stim:   { name: 'Stim', desc: '+40 health and 35% more speed for 3 s. 15 s cooldown.', charges: 1, cd: 15 },
    shield: { name: 'Barrier', desc: 'Take 60% less damage for 3 s. 16 s cooldown.', charges: 1, cd: 16 },
  };
  S.NADE = { fuse: 2, r: 5, dmg: 90, g: 18, bounce: 0.42, frict: 0.72, dt: 1 / 120, speed: 17, rad: 0.1 };
  // Deterministic grenade path: the server and every client compute exactly the same bounces.
  S.nadePath = function (o, v, boxes) {
    const N = S.NADE, p = o.slice(), vel = v.slice(), out = [p.slice()];
    const hit = (x, y, z) => S.hitAt(x, y - N.rad, z, N.rad * 2, N.rad, boxes);
    const steps = Math.round(N.fuse / N.dt);
    for (let i = 0; i < steps; i++) {
      vel[1] -= N.g * N.dt;
      for (let ax = 0; ax < 3; ax++) {
        const np = p.slice();
        np[ax] += vel[ax] * N.dt;
        if (hit(np[0], np[1], np[2])) {
          vel[ax] *= -N.bounce;
          if (ax === 1) { vel[0] *= N.frict; vel[2] *= N.frict; if (Math.abs(vel[1]) < 0.6) vel[1] = 0; }
        } else p[ax] = np[ax];
      }
      if (p[1] < -30) p[1] = -30;
      out.push(p.slice());
    }
    return out;
  };

  // Rounds
  S.ROUND_SECONDS = 300;
  S.FRAGLIMIT = 20;
  S.VOTE_SECONDS = 15;

  S.PICKUP_TYPES = {
    health: { hp: 25, max: 100, respawn: 20, color: '#4dff7a' },
    mega:   { hp: 100, max: 200, respawn: 35, color: '#4d9bff' },
    armor:  { ar: 100, max: 200, respawn: 25, color: '#ff4d4d' },
    shard:  { ar: 10, max: 200, respawn: 20, color: '#ffd24d' },
  };

  // ---------------- MAP BUILDING ----------------
  const Q = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  function makeMap(id, name, theme, size, wallH, build) {
    const m = { id, name, theme, size, boxes: [], pads: [], spawns: [], pickups: [], lights: [] };
    const B = (x1, y1, z1, x2, y2, z2, s) => m.boxes.push({
      min: [Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2)],
      max: [Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2)],
      s: s || 'wall',
    });
    B(-size, -1, -size, size, 0, size, 'floor');
    const doors = { zn: [], zp: [], xn: [], xp: [] };
    // stairs: top edge centred at (ax,az), descending along unit (ux,uz)
    const stairs = (ax, az, ux, uz, halfW, n, stepH, depth, topH, style) => {
      const px = -uz, pz = ux;
      for (let k = 0; k < n; k++) {
        B(ax + ux * k * depth - px * halfW, 0, az + uz * k * depth - pz * halfW,
          ax + ux * (k + 1) * depth + px * halfW, topH - k * stepH, az + uz * (k + 1) * depth + pz * halfW, style || 'stair');
      }
    };
    build({
      B, stairs,
      pad: (x, y, z, vx, vy, vz) => m.pads.push({ p: [x, y, z], r: 1.2, v: [vx, vy, vz] }),
      spawn: (x, y, z) => m.spawns.push({ p: [x, y, z], yaw: (x || z) ? Math.atan2(x, z) : 0 }),
      item: (type, x, y, z) => m.pickups.push({ type, p: [x, y, z] }),
      light: (x, y, z) => m.lights.push([x, y, z]),
      // cut a doorway into an outer wall: side zn/zp (along x) or xn/xp (along z), span a0..a1, height y0..y1
      door: (side, a0, a1, y0, y1) => doors[side].push([a0, a1, y0, y1]),
      tip: (t) => { m.tip = t; },
    });
    // outer walls, split around doorways
    const segs = (s0, s1, ops) => {
      const cuts = [...new Set([s0, s1, ...ops.flatMap((o) => [o[0], o[1]])].filter((v) => v >= s0 && v <= s1))].sort((a, b) => a - b);
      const out = [];
      for (let i = 0; i < cuts.length - 1; i++) {
        const a = cuts[i], b = cuts[i + 1], mid = (a + b) / 2;
        let y = 0;
        for (const o of ops.filter((o) => o[0] < mid && o[1] > mid).sort((p, q) => p[2] - q[2])) {
          if (o[2] > y) out.push([a, b, y, o[2]]);
          y = Math.max(y, o[3]);
        }
        if (y < wallH) out.push([a, b, y, wallH]);
      }
      return out;
    };
    for (const [a, b, y0, y1] of segs(-size - 1, size + 1, doors.zn)) B(a, y0, -size - 1, b, y1, -size, 'outer');
    for (const [a, b, y0, y1] of segs(-size - 1, size + 1, doors.zp)) B(a, y0, size, b, y1, size + 1, 'outer');
    for (const [a, b, y0, y1] of segs(-size, size, doors.xn)) B(-size - 1, y0, a, -size, y1, b, 'outer');
    for (const [a, b, y0, y1] of segs(-size, size, doors.xp)) B(size, y0, a, size + 1, y1, b, 'outer');
    // overall extents (for bot waypoints and shadows)
    const fl = m.boxes.filter((b) => b.s === 'floor');
    m.bounds = [Math.min(...fl.map((b) => b.min[0])), Math.min(...fl.map((b) => b.min[2])), Math.max(...fl.map((b) => b.max[0])), Math.max(...fl.map((b) => b.max[2]))];
    m.extent = Math.max(...m.bounds.map(Math.abs));
    return m;
  }

  S.MAPS = [
    // ------------------------------------------------ FOUNDRY
    makeMap(0, 'Foundry', 'foundry', 40, 24, ({ B, stairs, pad, spawn, item, light, door }) => {
      B(-6, 0, -6, 6, 1.2, 6, 'plat');
      B(-4, 9.4, -4, 4, 10, 4, 'plat');
      for (const [sx, sz] of Q) {
        B(sx * 28, 0, sz * 28, sx * 40, 7, sz * 40, 'tower');
        for (let i = 1; i <= 13; i++) B(sx * (14 + i), 0, sz * 30, sx * (15 + i), 0.5 * i, sz * 34, 'stair');
        B(sx * 11, 0, sz * 11, sx * 13, 6, sz * 13, 'pillar');
        B(sx * 18, 0, sz * 9, sx * 19, 2.2, sz * 14, 'cover');
      }
      for (const s of [1, -1]) {
        B(-28, 6.4, s * 36, 28, 7, s * 40, 'plat');
        B(-8, 0, s * 18, 8, 2, s * 19, 'cover');
        B(s * 28, 3.4, -6, s * 40, 4, 6, 'plat');
        B(s * 22, 0, -1.5, s * 24, 1.2, 1.5, 'crate');
        B(s * 24, 0, -1.5, s * 26, 2.4, 1.5, 'crate');
        B(s * 26, 0, -1.5, s * 28, 3.6, 1.5, 'crate');
        B(s * 16, 6, -2, s * 20, 6.5, 2, 'plat');
      }
      pad(10, 0, 0, -6, 22.5, 0); pad(-10, 0, 0, 6, 22.5, 0);
      pad(0, 0, 32, 0, 18.5, 4.5); pad(0, 0, -32, 0, 18.5, -4.5);
      [[-20, 0, -20], [20, 0, 20], [20, 0, -20], [-20, 0, 20], [0, 0, -26], [0, 0, 26], [-24, 0, 8], [24, 0, -8],
        [34, 4, 0], [-34, 4, 0], [34, 7, 34], [-34, 7, -34], [0, 1.2, 3]].forEach((p) => spawn(...p));
      item('mega', 0, 10, 0);
      item('armor', 34, 4, 0); item('armor', -34, 4, 0);
      item('health', 8, 0, 30); item('health', -8, 0, 30); item('health', 8, 0, -30); item('health', -8, 0, -30);
      item('health', 18, 6.5, 0); item('health', -18, 6.5, 0);
      item('shard', 34, 7, 34); item('shard', -34, 7, 34); item('shard', 34, 7, -34); item('shard', -34, 7, -34);
      light(0, 9.5, 39.3); light(0, 9.5, -39.3); light(0, 13, 0);
      // ---- indoor: Smelter Halls east and west, with a catwalk loop joined to the side platforms
      for (const s of [1, -1]) {
        const X = (v) => s * v, side = s > 0 ? 'xp' : 'xn';
        door(side, -4, 4, 0, 3.2);   // ground door, under the side platform
        door(side, -3, 3, 4, 7);     // upper door, from the side platform onto the catwalk
        B(X(41), -1, -16, X(62), 0, 16, 'floor');
        B(X(41), 0, -17, X(63), 14, -16, 'outer'); B(X(41), 0, 16, X(63), 14, 17, 'outer'); B(X(62), 0, -16, X(63), 14, 16, 'outer');
        B(X(40), 14, -17, X(63), 15, 17, 'ceil');
        B(X(41), 3.4, -12, X(46), 4, 12, 'plat'); B(X(41), 3.4, 12, X(62), 4, 16, 'plat'); B(X(41), 3.4, -16, X(62), 4, -12, 'plat');
        stairs(X(56), 12, 0, -1, 1.5, 7, 0.5, 1, 3.5);
        B(X(50), 0, -3, X(56), 5, 3, 'pillar');           // furnace
        B(X(58), 0, -8, X(60), 1.2, -6, 'crate'); B(X(47), 0, 6, X(49), 1.2, 8, 'crate');
        spawn(X(48), 0, -8); spawn(X(59.5), 0, 4);
        item('health', X(59), 0, -3); item('shard', X(43.5), 4, 0); item('shard', X(53), 5, 0);
        light(X(61.3), 9, 0); light(X(51), 9.5, -15.3);
      }
    }),

    // ------------------------------------------------ REACTOR
    makeMap(1, 'Reactor', 'reactor', 36, 20, ({ B, stairs, pad, spawn, item, light, door }) => {
      // cross-shaped overpass with a central hub, over a reactor core
      B(-30, 5, -2.5, 30, 5.6, 2.5, 'plat');
      B(-2.5, 5, -30, 2.5, 5.6, 30, 'plat');
      B(-5, 5, -5, 5, 5.6, 5, 'plat');
      B(-2, 0, -2, 2, 3, 2, 'pillar');
      for (const s of [1, -1]) {
        stairs(s * 28, 2.5, 0, 1, 1.5, 11, 0.5, 1, 5.5);
        stairs(2.5, s * 28, 1, 0, 1.5, 11, 0.5, 1, 5.5);
        B(s * 15 - 0.75, 0, -0.75, s * 15 + 0.75, 5, 0.75, 'pillar');
        B(-0.75, 0, s * 15 - 0.75, 0.75, 5, s * 15 + 0.75, 'pillar');
      }
      for (const [sx, sz] of Q) {
        B(sx * 24, 0, sz * 24, sx * 36, 3, sz * 36, 'tower');
        B(sx * 20, 0, sz * 29, sx * 22, 1.2, sz * 32, 'crate');
        B(sx * 22, 0, sz * 29, sx * 24, 2.4, sz * 32, 'crate');
        B(sx * 14, 0, sz * 19, sx * 19, 1.6, sz * 20, 'cover');
        B(sx * 19, 0, sz * 14, sx * 20, 1.6, sz * 20, 'cover');
        pad(sx * 12, 0, sz * 12, 0, 17, -sz * 9.5);
      }
      [[8, 0, 18], [-8, 0, -18], [18, 0, -8], [-18, 0, 8], [22, 0, 22], [-22, 0, -22], [22, 0, -22], [-22, 0, 22],
        [-20, 5.6, 0], [0, 5.6, 20], [31, 3, -31], [-31, 3, 31]].forEach((p) => spawn(...p));
      item('mega', 0, 5.6, 0);
      item('armor', 30, 3, 30); item('armor', -30, 3, -30);
      item('shard', 30, 3, -30); item('shard', -30, 3, 30);
      item('health', 24, 0, -6); item('health', -24, 0, 6); item('health', 6, 0, 24); item('health', -6, 0, -24);
      item('health', 20, 5.6, 0); item('health', 0, 5.6, -20);
      light(35.3, 7, 0); light(-35.3, 7, 0); light(0, 4.2, 0);
      // ---- indoor: Control Rooms north and south, a ring corridor around a solid core
      for (const s of [1, -1]) {
        const Z = (v) => s * v, side = s > 0 ? 'zp' : 'zn';
        door(side, -3, 3, 0, 3.5); door(side, -14, -10, 0, 3.5); door(side, 10, 14, 0, 3.5);
        B(-16, -1, Z(37), 16, 0, Z(58), 'floor');
        B(-17, 0, Z(37), -16, 9, Z(59), 'outer'); B(16, 0, Z(37), 17, 9, Z(59), 'outer'); B(-17, 0, Z(58), 17, 9, Z(59), 'outer');
        B(-17, 7, Z(36), 17, 8, Z(59), 'ceil');
        B(-8, 0, Z(43), 8, 7, Z(52), 'iwall');
        B(10, 0, Z(46), 13, 1.3, Z(49), 'cover'); B(-13, 0, Z(46), -10, 1.3, Z(49), 'cover');
        B(-6, 0, Z(54), 6, 1.2, Z(58), 'plat');
        spawn(12, 0, Z(40)); spawn(-12, 0, Z(54));
        item('health', 12, 0, Z(55)); item('health', -12, 0, Z(40)); item('shard', 0, 1.2, Z(56));
        light(0, 6.3, Z(39.5)); light(0, 6.3, Z(55.5));
      }
    }),

    // ------------------------------------------------ ZIGGURAT
    makeMap(2, 'Ziggurat', 'temple', 36, 22, ({ B, stairs, pad, spawn, item, light, door }) => {
      // stepped pyramid
      B(-10, 0, -10, 10, 1, 10, 'plat');
      B(-7, 1, -7, 7, 2, 7, 'plat');
      B(-4, 2, -4, 4, 3, 4, 'plat');
      for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        [10, 7, 4].forEach((e, t) => {
          const px = -uz, pz = ux;
          B(ux * e - px * 1.5, t, uz * e - pz * 1.5, ux * (e + 1) + px * 1.5, t + 0.5, uz * (e + 1) + pz * 1.5, 'stair');
        });
      }
      // ring of pillars
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4, cx = Math.cos(a) * 17, cz = Math.sin(a) * 17;
        B(cx - 0.8, 0, cz - 0.8, cx + 0.8, 7, cz + 0.8, 'pillar');
      }
      for (const s of [1, -1]) {
        // raised side galleries
        B(s * 29, 4, -30, s * 36, 4.6, 30, 'tower');
        stairs(s * 29, 27, -s, 0, 2, 9, 0.5, 1, 4.5);
        stairs(s * 29, -27, -s, 0, 2, 9, 0.5, 1, 4.5);
        pad(s * 22, 0, 0, s * 8.5, 16, 0);
        B(-6, 0, s * 26, 6, 1.4, s * 27, 'cover');
      }
      [[14, 0, 14], [-14, 0, -14], [14, 0, -14], [-14, 0, 14], [0, 0, 22], [0, 0, -22], [22, 0, 10], [-22, 0, -10],
        [32, 4.6, -20], [-32, 4.6, 20]].forEach((p) => spawn(...p));
      item('mega', 0, 3, 0);
      item('armor', 32, 4.6, 0); item('armor', -32, 4.6, 0);
      item('shard', 8.5, 1, 8.5); item('shard', -8.5, 1, 8.5); item('shard', 8.5, 1, -8.5); item('shard', -8.5, 1, -8.5);
      item('health', 14, 0, 24); item('health', -14, 0, -24); item('health', 0, 0, 31); item('health', 0, 0, -31);
      light(35.3, 7.5, -15); light(35.3, 7.5, 15); light(-35.3, 7.5, -15); light(-35.3, 7.5, 15);
      light(0, 7, 35.3); light(0, 7, -35.3); light(0, 6, 0);
      // ---- indoor: Crypts east and west, under the galleries
      for (const s of [1, -1]) {
        const X = (v) => s * v, side = s > 0 ? 'xp' : 'xn';
        door(side, -3, 3, 0, 3.4); door(side, -12, -9, 0, 3.4); door(side, 9, 12, 0, 3.4);
        B(X(37), -1, -16, X(56), 0, 16, 'floor');
        B(X(37), 0, -17, X(57), 10, -16, 'outer'); B(X(37), 0, 16, X(57), 10, 17, 'outer'); B(X(56), 0, -16, X(57), 10, 16, 'outer');
        B(X(36), 6, -17, X(57), 7, 17, 'ceil');
        for (const cx of [42, 48]) for (const cz of [-9, -3, 3, 9]) B(X(cx - 0.6), 0, cz - 0.6, X(cx + 0.6), 6, cz + 0.6, 'pillar');
        B(X(44), 0, -1.2, X(46.5), 1.1, 1.2, 'stair');      // sarcophagi
        B(X(50.5), 0, 5, X(53.5), 1.1, 7, 'stair'); B(X(50.5), 0, -7, X(53.5), 1.1, -5, 'stair');
        B(X(53), 0, -3, X(56), 1.5, 3, 'plat');              // altar
        spawn(X(51), 0, 12); spawn(X(39), 0, -6);
        item('health', X(51), 0, -12); item('health', X(39.5), 0, 12); item('shard', X(54.5), 1.5, 0);
        light(X(55.3), 4.5, 10); light(X(45), 5.2, -15.3);
      }
    }),
    // ------------------------------------------------ VAULT (fully indoor, close quarters)
    makeMap(3, 'Vault', 'base', 26, 13, ({ B, spawn, item, light, tip }) => {
      tip('ROCKET-JUMP TO THE MEGA HEALTH');
      // interior walls with doorways; gaps are [from, to] along the wall, doorway height 3.5
      const wallX = (z0, z1, x0, x1, gaps, top) => {
        const pts = [x0, ...gaps.flat(), x1];
        for (let i = 0; i < pts.length - 1; i += 2) if (pts[i + 1] > pts[i]) B(pts[i], 0, z0, pts[i + 1], top, z1, 'iwall');
        for (const [a, b] of gaps) B(a, 3.5, z0, b, top, z1, 'iwall');
      };
      const wallZ = (x0, x1, z0, z1, gaps, top) => {
        const pts = [z0, ...gaps.flat(), z1];
        for (let i = 0; i < pts.length - 1; i += 2) if (pts[i + 1] > pts[i]) B(x0, 0, pts[i], x1, top, pts[i + 1], 'iwall');
        for (const [a, b] of gaps) B(x0, 3.5, a, x1, top, b, 'iwall');
      };
      const G = [[-23, -21], [-2, 2], [21, 23]];
      for (const s of [1, -1]) {
        // 3x3 grid of rooms
        wallX(s > 0 ? 17 : -18, s > 0 ? 18 : -17, -26, 26, G, 12);
        wallZ(s > 0 ? 17 : -18, s > 0 ? 18 : -17, -26, 26, G, 12);
        // atrium in the middle (the only tall room)
        wallX(s > 0 ? 9 : -10, s > 0 ? 10 : -9, -10, 10, [[-2, 2]], 12);
        wallZ(s > 0 ? 9 : -10, s > 0 ? 10 : -9, -9, 9, [[-2, 2]], 12);
      }
      // ceilings: low in the rooms and the ring corridor, tall over the atrium
      B(-26, 12, -26, 26, 13, 26, 'ceil');
      B(17, 5.5, -26, 26, 12, 26, 'ceil'); B(-26, 5.5, -26, -17, 12, 26, 'ceil');
      B(-17, 5.5, 17, 17, 12, 26, 'ceil'); B(-17, 5.5, -26, 17, 12, -17, 'ceil');
      B(-17, 6, 10, 17, 12, 17, 'ceil'); B(-17, 6, -17, 17, 12, -10, 'ceil');
      B(10, 6, -10, 17, 12, 10, 'ceil'); B(-17, 6, -10, -10, 12, 10, 'ceil');
      // atrium: floating mega platform + ledges, all rocket-jump height
      B(-1.6, 5, -1.6, 1.6, 5.5, 1.6, 'plat');
      B(-6, 4.5, 7.5, 6, 5, 9, 'plat');
      B(-6, 4.5, -9, 6, 5, -7.5, 'plat');
      for (const [sx, sz] of Q) {
        B(sx * 4, 0, sz * 4, sx * 7, 1.3, sz * 5, 'cover');
        B(sx * 4, 0, sz * 5, sx * 5, 1.3, sz * 7, 'cover');
        B(sx * 12.5, 0, sz * 12.5, sx * 14.5, 6, sz * 14.5, 'pillar');   // ring-corridor corners
        B(sx * 23, 0, sz * 23, sx * 25, 1.2, sz * 25, 'crate');          // corner rooms
      }
      // east hall: crates
      B(20, 0, -12, 22, 1.2, -10, 'crate'); B(23, 0, 4, 25, 1.2, 6, 'crate'); B(23, 0, 6, 25, 2.4, 8, 'crate');
      B(19, 0, 10, 21, 1.2, 12, 'crate'); B(21, 0, -3, 22, 1.4, 3, 'cover');
      // west hall: crate maze
      B(-25, 0, -14, -23, 2.4, -12, 'crate'); B(-21, 0, -8, -19, 1.2, -6, 'crate');
      B(-24, 0, -2, -22, 1.2, 2, 'crate'); B(-22, 0, 2, -20, 2.4, 4, 'crate'); B(-25, 0, 8, -23, 1.2, 10, 'crate');
      // north: server racks
      B(-14, 0, 21.5, -4, 5.5, 22.5, 'pillar'); B(4, 0, 21.5, 14, 5.5, 22.5, 'pillar');
      // south: armory with low cover
      B(-4, 0, -20, 4, 1.2, -19.5, 'cover'); B(-8, 0, -24, -7, 1.4, -20, 'cover'); B(7, 0, -24, 8, 1.4, -20, 'cover');

      [[13.5, 0, 6], [-13.5, 0, -6], [6, 0, 13.5], [-6, 0, -13.5], [22, 0, 10], [-22, 0, -10], [10, 0, 19.5], [-10, 0, -22],
        [22, 0, 22], [-22, 0, -22], [22, 0, -22], [-22, 0, 22], [0, 0, 4.5], [0, 0, -4.5]].forEach((p) => spawn(...p));
      item('mega', 0, 5.5, 0);
      item('armor', 0, 5, 8.25); item('armor', 0, 0, -23);
      item('shard', -3, 5, -8.25); item('shard', 3, 5, -8.25); item('shard', 0, 0, 24); item('shard', -20, 0, 24); item('shard', 20, 0, -24);
      item('health', 13.5, 0, -8); item('health', -13.5, 0, 8); item('health', 24, 0, -15); item('health', -24, 0, 15);
      item('health', 20, 0, 24); item('health', -20, 0, -24);
      light(0, 9, 8.65); light(0, 9, -8.65);
      light(13.5, 5.4, 0); light(-13.5, 5.4, 0);
      light(25.4, 4.9, 0); light(-25.4, 4.9, 0); light(0, 4.9, 25.4); light(0, 4.9, -25.4);
      for (const [sx, sz] of Q) light(sx * 21, 5.1, sz * 21);
    }),
  ];
  S.getMap = (id) => S.MAPS[id] || S.MAPS[0];

  // ---------------- MATH ----------------
  // Ray vs AABB (slab). Returns entry distance t >= 0, 0 if origin inside, -1 on miss.
  S.rayAABB = function (o, d, min, max) {
    let tmin = 0, tmax = Infinity;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (o[i] < min[i] || o[i] > max[i]) return -1;
      } else {
        let t1 = (min[i] - o[i]) / d[i], t2 = (max[i] - o[i]) / d[i];
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return -1;
      }
    }
    return tmin;
  };
  // Distance along normalized ray d to first box (capped at maxT)
  S.rayWorld = function (o, d, maxT, boxes) {
    let best = maxT;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const t = S.rayAABB(o, d, b.min, b.max);
      if (t >= 0 && t < best) best = t;
    }
    return best;
  };
  S.boxDist = function (p, min, max) {
    let s = 0;
    for (let i = 0; i < 3; i++) {
      const v = p[i] < min[i] ? min[i] - p[i] : p[i] > max[i] ? p[i] - max[i] : 0;
      s += v * v;
    }
    return Math.sqrt(s);
  };
  // Player hull (feet at x,y,z) overlapping any box?
  S.hitAt = function (x, y, z, h, pw, boxes) {
    pw = pw || S.PW;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (x + pw > b.min[0] && x - pw < b.max[0] && y + h > b.min[1] && y < b.max[1] && z + pw > b.min[2] && z - pw < b.max[2]) return b;
    }
    return null;
  };
  // Floor-level waypoints for bots (cached per map)
  S.botWps = function (map) {
    if (map._wps) return map._wps;
    const w = [];
    const [x0, z0, x1, z1] = map.bounds;
    for (let x = Math.ceil(x0 / 4) * 4; x <= x1 - 2; x += 4) {
      for (let z = Math.ceil(z0 / 4) * 4; z <= z1 - 2; z += 4) {
        if (!S.hitAt(x, 0.01, z, S.PH, 0.7, map.boxes) && S.hitAt(x, -0.05, z, 0.04, 0.2, map.boxes)) w.push([x, 0, z]);
      }
    }
    Object.defineProperty(map, '_wps', { value: w, enumerable: false });
    return w;
  };
  return S;
});
