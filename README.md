# VWorld Game — Phase 2

A web-based 3D multiplayer virtual-world game built on **[@vworld/engine](../vworld-engine)**
(Three.js + Rapier physics, Laravel-style DX). Small shared worlds (10–30 players per room),
real-time player sync, text chat, and a prefab prop-building system with physics.

> Phase 2 = the **game layer**. The engine (rendering, physics, player controller,
> character registry, build helpers) lives in `../vworld-engine`.

## Run it

```bash
cd ~/workspace/vworld-game
npm install          # installs server + client workspaces

# Terminal 1 — authoritative server (port 8081, or PORT env)
npm run server

# Terminal 2 — web client (Vite dev server)
npm run client:dev   # open the printed http://localhost:5173 URL
```

Production client build: `npm run client:build` → `client/dist/`.
End-to-end smoke test (spawns its own server on :8099, two fake clients): `npm run smoke` — 8/8 steps pass.

## How to play

1. Enter a username, pick a character pack, then **Create** a room (you get a 6-letter code)
   or **Join** with a friend's code.
2. Click the 3D view for mouse-look.

**Controls**

| Input | Action |
|---|---|
| WASD / arrows | Move (camera-relative) |
| Mouse | Look (pointer lock) |
| Space / Shift | Jump / sprint |
| 1–8 | Select prop (brick, wall, floor, roof, door, table, chair, lamp) |
| Q / W / E / R | Place / Move / Rotate / Delete tools |
| R (with ghost) | Rotate ghost 45° |
| Enter or `/` | Chat |
| Esc | Exit build tool |

**Avatars (PUBG rule):** everyone has the built-in default character. The *Ember* pack
can be downloaded from the character menu; any player whose pack you haven't
downloaded renders as the default — you always see *someone*.

## Architecture

```
                    ┌─────────────────────────────┐
  Browser A         │      vworld-game/client     │
 ┌──────────────┐   │  Vite + Three.js            │
 │ PlayerCtrl   │   │  @vworld/engine:            │
 │ RemotePlayers│◄──┼── Entity.serialize /        │
 │ PropManager  │   │     applySnapshot,          │
 │ BuildMode    │   │     characters.spawn(),     │
 │ Chat UI      │   │     build.ghost/snapVec3    │
 └──────┬───────┘   └──────────────┬──────────────┘
        │  WebSocket JSON          │
        │  15Hz move ──►           │  ◄── 20Hz players tick
        │  place/moveProp/delProp ─►│  ◄── propAdd/propMove/propDel
        │  chat ──►               │  ◄── chat relay
        ▼                          ▼
 ┌──────────────────────────────────────────────┐
 │            vworld-game/server (Node + ws)    │
 │  rooms: code → Room{players, props} (memory) │
 │  20Hz tick: changed player snapshots only   │
 │  prop validation: kind, bounds ±100, ≤500   │
 │  persistence: data/<CODE>.json (2s debounce)│
 └──────────────────────────────────────────────┘
```

The server is **authoritative** for rooms, props, and presence; clients are
authoritative for their own movement (server relays, does not simulate).
Props render only from server echoes — never optimistically.

## Known limitations (v1)

- **No auth** — usernames are trusted from the client; anyone can impersonate anyone.
- **No lag compensation / client prediction** — remote players are lerped; high ping looks slidey.
- **Single server process** — rooms live in memory; no horizontal scaling yet (the per-room
  data model is the seam a multi-process design would build on).
- **No ownership** — any player can move/delete anyone's props.
- **No voice chat** — text only.
- Demo not visually verified in a headless sandbox — check it in a real browser.
