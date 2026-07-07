# P2P Hold'em ♠ ♥ ♦ ♣

Serverless **No-Limit Texas Hold'em** you play with friends in the browser — no accounts,
no backend, no database. One person creates a room and shares a link; everyone else opens
it and plays. The whole app is a static site on GitHub Pages, with real-time play relayed
peer-to-peer through a public message broker.

**Play:** open the link → enter a name → **Create room** → share the invite link. Or type
the room key **`TEST`** to sit at a practice table against bots.

## Features

- Correct **No-Limit** betting engine: heads-up blind rules, min-raise tracking, all-ins,
  and multi-way **side pots**.
- **Cash game** (fixed blinds, self-service rebuys) and **Tournament** (blinds rise on each
  bust-out; last player standing wins).
- **Reconnect and reclaim your seat**, a **45-second shot clock** with auto-fold, and AFK
  players skipped until they sit back in.
- **Card privacy** — you only ever receive your own hole cards; opponents' cards live only
  in the host's tab until showdown.
- Oval-table & list layouts, light/dark themes, hold-to-peek cards, real poker **sound
  effects**, and a responsive design for desktop and phone.

## How it works

There's no server that owns the game. The app uses a **host-authority** model over a public
**MQTT** broker (`broker.emqx.io`) as a dumb message relay:

- **The host** (whoever created the room) runs the entire game engine and holds the deck.
- **Guests** publish intent — `join`, `action`, `sitOut`, `show`, `ping` — to the room's
  command topic.
- **The host** validates each command, advances the state machine, then publishes a
  **separate redacted view to each player** — your view has your hole cards and the board,
  never anyone else's.
- **Presence** is a heartbeat; the host prunes quiet clients. State snapshots to
  `localStorage` so a refresh resumes the room (the deck and hole cards are never persisted).

Because the broker only relays opaque JSON, it works across any networks with no accounts,
no WebRTC/TURN, and no server of our own.

## Tech stack

**TypeScript** with no UI framework (a tiny hand-rolled DOM builder), built with **Vite**
into a single static bundle. Transport is **MQTT over WebSocket** (`mqtt` — the only
production dependency); audio is the **Web Audio API** with bundled CC0 samples; tests run
on **Vitest**; hosting is **GitHub Pages** via GitHub Actions.

The layering is strict — `engine/` (pure poker logic) knows nothing about the DOM or
network, `net/` turns UI intent into engine calls and builds redacted views, and `ui/` only
renders the view it's given.

```
src/
  engine/   cards, deck, evaluator (5-of-7), pots (side pots), game (betting state machine)
  net/      room.ts (HostClient/GuestClient over MQTT), protocol.ts (commands + redacted views)
  ui/       dom, cards, screens (lobby/join/table), sound, styles.css
  main.ts   app wiring: identity, routing, client lifecycle, sound cues
```

## Develop

```bash
npm install
npm run dev      # local dev server
npm test         # engine + protocol + render tests (Vitest)
npm run build    # typecheck + production build to dist/
```

Open two tabs (or two devices) to play against yourself, or join room **`TEST`** to play a
full table against bots. Pushing to `main` triggers `.github/workflows/deploy.yml`, which
typechecks, builds, and publishes to GitHub Pages (enable once under **Settings → Pages →
Source: GitHub Actions**).

## Credits

Sound effects: [Kenney "Casino Audio"](https://kenney.nl/assets/casino-audio) (CC0) and a
public-domain wood-knock from Wikimedia Commons. Fonts: Space Grotesk + Inter.
