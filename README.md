# Чума / Plague

A real-time survival and social-deduction game for 5–10 players in the browser. The town is under
quarantine: ten days to make a serum, or to survive at any cost. Everyone acts at once inside a
timed day and night; you only see who is in the same place as you. RU and EN interface, mobile and
desktop, spectators, reconnection and rematches. Full rules: [docs/RULES.md](docs/RULES.md).

## Quick start

Requirements: Node.js 22+ and [pnpm](https://pnpm.io) 10 (`corepack enable`).

```bash
pnpm install
pnpm dev          # server on :3000, web client on http://localhost:5173
```

To try it alone, lower the player minimum: `MIN_PLAYERS=1 pnpm dev`.

Production-style run (one process serves the client and the sockets):

```bash
pnpm install
pnpm build
pnpm start        # http://localhost:3000
```

Docker: `docker build -t plague . && docker run -p 3000:3000 plague`. `render.yaml` is a Render Blueprint.

Other checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.

## Configuration

See `.env.example`: `PORT`, `HOST`, `TRUST_PROXY`, `ALLOWED_ORIGINS`, `WEB_DIR`, plus `MIN_PLAYERS`
(default 5). Rooms live in memory, so run a single instance. `/healthz` returns `{ok, rooms}`.

## Layout

| Package | What it is |
| --- | --- |
| `packages/engine` | Pure rules engine: `reduce(state, command, now)`, per-viewer `projectView`. Time comes in as an argument; no I/O. |
| `packages/protocol` | Socket message types and hand-written validators shared by client and server. |
| `packages/server` | Rooms, sessions, the one-second clock tick, host migration, rate limiting, static files, Socket.IO adapter. |
| `packages/web` | React 19 + Vite client with its own small store, i18n and CSS. |

The server is authoritative. Clients send intents only; each client receives a view with its own
stats, the people and rolls in its location and the messages addressed to it. Other players' roles,
stats and inventories, the event schedule and the random seed never leave the server.

## Design notes

- The game clock runs only during day and night and stops for court and the end-of-day summary.
- Every personal task is checked by the server from what actually happened (time spent together,
  trades, attacks…), see `packages/engine/src/quests.ts`.
- Views are sent only when something visible changed; countdowns run on the client.
