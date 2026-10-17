# ARENA

A fast-movement, Quake-style multiplayer arena shooter that runs in the browser.
Three.js client + a tiny Node.js WebSocket server.

## Movement
| Input | What it does |
|---|---|
| WASD | Move (Quake-style ground acceleration and friction) |
| Space | Jump. **Hold it** to bunny-hop: no friction on landing, so speed carries |
| Strafe + turn mid-air | Air-strafing: hold A or D and turn the mouse the same way to gain speed |
| E | Your ability (Dash by default; see **Ability**) |
| C | Crouch. At speed it becomes a **slide** with a speed boost. Jump out of a slide to keep momentum |
| Space next to a wall mid-air | Wall jump (3 per airtime) |
| Look down, jump + fire a rocket | **Rocket jump.** Your own rockets push you 20% harder and only do 30% damage to you (about 25–30 HP, less with armor). Jumping at the same moment adds the two together for big height, and you can steer in the air |
| Glowing pads | Jump pads to the mega-health platform and the high walkways |

## Ability (press `E`)
Pick **one** ability in the *Loadout* panel, on the main menu or the Esc menu. You use it with `E` (`G` also works). Your choice is saved, and a change takes effect when you next respawn (press `K` to respawn right away).

| Ability | What it does |
|---|---|
| **Dash** | Burst of speed the way you're moving. 2 charges |
| **Blink** | Teleport 8 m where you look and keep your momentum. 2 charges |
| **Double Jump** | Press E in mid-air to jump again. Resets when you land |
| **Jetpack** | Hold E to fly. Fuel refills on the ground |
| **Frag Grenade** | Bouncing grenade, 2 s fuse, 90 damage splash. 2 charges, 9 s each. Can be used to grenade-jump |
| **Stim** | +40 health and 35% more speed for 3 s. 15 s cooldown |
| **Barrier** | Take 60% less damage for 3 s (others see a shield bubble). 16 s cooldown |

The server enforces cooldowns, healing, damage and the Barrier. Grenades follow the same bounce path on the server and every client (`S.nadePath` in `shared.js`), so they land in the same place for everyone. Bots throw grenades.

## Weapons
The guns are 2D pixel-art sprites in the style of 90s shooters, made from metal-shaded 3D models (worn gunmetal, polymer, walnut) with real recoil, ejected brass and shells, barrel smoke, and layered gunshot sounds with room reverb. When the game loads, and again on each map change so they pick up that map's lighting, every animation frame is rendered once from a 3D model, shrunk, colour-limited with dithering and outlined. The frames then play back in steps, with choppy whole-pixel bob and sway. The frame lists live in `FRAMES` in `index.html`.

1 Rocket Launcher · 2 Railgun · 3 Shotgun · 4 Machinegun. Ammo is unlimited.
Mouse wheel or `Q` (last weapon) also switch. Pickups: health, mega health (centre top), red armor (side platforms), armor shards (tower tops).

Crouch isn't bound to Ctrl on purpose: Ctrl+W closes the browser tab.

Other keys: `T` chat (opens the match chat with scrollable history; use the mouse wheel) · `Tab` scoreboard · `K` respawn.

## Server list & lobbies
The game connects to its server automatically and opens on the **server list**: every lobby with its map, round and player count. **Main Arena** is always there.
- **Create lobby:** pick a name, map, max players (2–12), bots, and **Public** or **Private**.
  - **Public** lobbies are open to anyone in the list.
  - **Private** lobbies show a 🔒 and need the password you set.
- **Invite friends:** in a match, press Esc → **Copy invite link**. Opening the link takes them straight to your lobby (a private lobby still asks for the password).
- Leaving a match drops you back on the server list. Empty lobbies close after a minute.
- If the page isn't served by the game server (GitHub Pages, say), set the server once with `DEFAULT_SERVER` in `index.html` or `?server=wss://…`. A manual override is under Settings → Server.

- **Lobby chat:** after you click *Find servers*, the room browser has a chat box shared by everyone on the server who isn't in a match. It also shows who joined which room, and how many people are online.
- **Match chat:** press `T` in game to talk to everyone in your room.

## Rounds, maps and voting
A **round** lasts 5 minutes or until someone hits 20 frags. The top fragger wins the round, which is tracked in the **WINS** column.
Then everyone gets 15 seconds to **vote for the next map**: press 1–3 or click a card. The most votes wins and ties are picked at random. If nobody votes, the map changes anyway.

| Map | Look | Layout |
|---|---|---|
| **Foundry** | rusted metal, brick, molten light | corner towers, walkways, jump pads to a floating mega-health platform · indoor **Smelter Halls** east and west, with a catwalk loop and doors at ground and catwalk level |
| **Reactor** | steel, hazard stripes, toxic green | cross-shaped overpass above a reactor core, raised corner bunkers · indoor **Control Rooms** north and south: ring corridors around a solid core, 3 doors each |
| **Vault** | steel techbase, red emergency strips | fully indoor and close quarters: a 3×3 grid of low-ceilinged rooms (crate halls, server racks, an armory) around a ring corridor and a tall central atrium. The mega health and the atrium ledges can only be reached by **rocket jumping** |
| **Ziggurat** | sandstone, torchlight, night sky | stepped pyramid ringed by pillars, raised side galleries · indoor **Crypts** east and west, with column rows, sarcophagi and an altar |

You can change the timings on the server with environment variables (on Render: the service's **Environment** tab):
`ROUND_SECONDS` (default 300), `FRAGLIMIT` (default 20), `VOTE_SECONDS` (default 15).

### Adding a map
Maps are defined in `shared.js` (`S.MAPS`) as lists of boxes, jump pads, spawns, pickups and lamps. `door(side, from, to, y0, y1)` cuts a doorway into the outer wall, and the wall is split around it automatically.
Each map names a theme, and the themes' pixel-art textures and lighting are in `THEMES` in `index.html`.

## Files
| File | Purpose |
|---|---|
| `index.html` | The whole game client |
| `shared.js` | Maps, weapons, collision math. Used by both client and server |
| `room.js` | Rounds, map voting, authoritative match logic and bots. Runs on the server, and in the browser for offline practice |
| `server.js` | Serves the game and hosts the multiplayer rooms over WebSockets |

---

## Hosting

GitHub Pages can only host static files, so it **can't run the multiplayer server**.
The client works fine there, though. There are two setups.

### Option A — Render only (easiest)
Render serves the game page *and* runs the server, so one link does everything.

1. Push this folder to a GitHub repo.
2. On [render.com](https://render.com): **New → Web Service** → pick the repo.
   - Runtime: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: Free is fine

   (Or use **New → Blueprint**, and Render reads `render.yaml` for you.)
3. Open `https://<your-service>.onrender.com`. The server field fills itself in. Click **Find servers**.

### Option B — GitHub Pages for the game, Render for the server
1. Deploy the server to Render as in Option A.
2. In the repo on GitHub: **Settings → Pages → Deploy from branch → main / root**.
3. Point the client at your server, using either method:
   - Edit `DEFAULT_SERVER` near the top of the script in `index.html`:
     `const DEFAULT_SERVER = 'wss://<your-service>.onrender.com';`
   - Or share a link like
     `https://<you>.github.io/<repo>/?server=wss://<your-service>.onrender.com`

Players can also type any server address into the menu. It's remembered.

### Render free-tier note
Free services go to sleep after about 15 minutes with nobody connected.
The first person to connect wakes the server, which takes about a minute, and the menu shows a "connecting" message meanwhile.
Practice mode (vs bots) needs no server at all.

## Run locally
```bash
npm install
npm start
# open http://localhost:8080  (friends on your Wi-Fi: http://<your-LAN-IP>:8080)
```

## Rooms and bots
- **Main Arena** always exists. You can create more rooms from the menu. Empty rooms close after a minute.
- Bots fill a room up to its chosen size (default 4 players) and leave as humans join.
- Up to 12 humans per room.

## Netcode in one paragraph
Each client simulates its own movement at 125 Hz and sends its position 30× a second.
The server runs at 30 Hz, owns health, armor, pickups, rockets and scoring, and broadcasts snapshots.
Other players are drawn 100 ms in the past and interpolated, so they move smoothly.
Hitscan uses what the shooter saw (favor-the-shooter), and the server checks fire rates and damage caps.
It's built for playing with friends, not hardened against determined cheaters.
