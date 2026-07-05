# P2P Hold'em ♠ ♥ ♦ ♣

Serverless **No-Limit Texas Hold'em** you play with friends straight in the browser.
One person creates a room and shares a key/link; everyone else opens it and plays — no
accounts, no backend, no database. The whole app is a static site on GitHub Pages, and
real-time play is relayed peer-to-peer through a public message broker.

**Play:** open the deployed link → enter a name → **Create room** → share the invite
link. Friends open it and join. Or type the room key **`TEST`** to sit at a practice
table against bots.

---

## Highlights

- **No-Limit Texas Hold'em** with a correct betting engine: heads-up blind rules,
  min-raise tracking, all-ins, and multi-way **side pots**.
- **Cash game** (fixed blinds, self-service rebuys) and **Tournament** (blinds rise on
  every bust-out; last player standing wins).
- **Reconnect & reclaim your seat**, a **45-second shot clock** with auto-fold, and
  AFK players are removed from hands until they sit back in.
- **Card privacy** — you only ever receive your own hole cards; opponents' cards exist
  only in the host's tab until a showdown.
- **Table & list layouts**, light/dark themes, hold-to-peek cards, real poker **sound
  effects**, and a responsive design for desktop and phones.
- **Zero infrastructure** — one static bundle, one small runtime dependency.

---

## Tech stack

| Concern      | Choice                                                                 |
| ------------ | ---------------------------------------------------------------------- |
| Language     | **TypeScript**, no UI framework — a tiny hand-rolled DOM builder       |
| Build        | **Vite** (ES modules, single static bundle)                            |
| Transport    | **MQTT over secure WebSocket** (`mqtt` / MQTT.js) via a public broker  |
| Audio        | **Web Audio API** with bundled CC0 samples (no runtime network)        |
| Tests        | **Vitest** (+ jsdom for a render smoke test)                           |
| Hosting      | **GitHub Pages** via GitHub Actions                                    |

The only production dependency is [`mqtt`](https://github.com/mqttjs/MQTT.js). Everything
else — the poker engine, the rendering, the theming, the sound — is plain TypeScript.

---

## How it works

There is no server that owns the game. Instead, the app uses a **host-authority** model
over a public **MQTT** broker (`broker.emqx.io`) as a dumb message relay.

```
  Guest tab ──cmd──►  ┌───────────────┐  ──redacted view──►  Guest tab
  Guest tab ──cmd──►  │   MQTT broker │  ──redacted view──►  Guest tab
                      │  (pub/sub)    │
  Host  tab ◄─cmd───  └───────────────┘  ◄── owns the engine + deck
       │                                          ▲
       └── runs the game, redacts, broadcasts ────┘
```

- **The host** is whoever created the room. Their browser tab runs the entire game
  engine and holds the shuffled deck.
- **Guests** publish intent — `join`, `action` (fold/check/call/raise), `sitOut`,
  `show`, `ping` — to the room's command topic.
- **The host** validates every command against the rules, advances the state machine,
  then publishes a **separate redacted view to each player's own topic**. Your view
  contains your hole cards and the public board — never anyone else's cards.
- **Presence** is a heartbeat: clients `ping`, and the host prunes anyone who goes
  quiet. Absent players are auto-folded by the shot clock and skipped until they return.
- **Resilience** — the host snapshots game state to `localStorage`, so a refresh
  resumes the same room; the deck and hole cards are never persisted (card privacy).

Because the broker only relays opaque JSON, it works across any networks (mobile data
included) with no accounts, no WebRTC/TURN setup, and no server of our own.

---

## Project structure

```
src/
  engine/        Pure poker logic — no DOM, no network (fully unit-tested)
    cards.ts       card & rank primitives
    deck.ts        shuffle
    evaluator.ts   5-of-7 hand ranking
    pots.ts        pot / side-pot resolution
    game.ts        betting state machine (blinds, streets, shot clock, AFK)
    types.ts       shared domain types
  net/           Networking & authority
    room.ts        HostClient / GuestClient over MQTT
    protocol.ts    commands + per-player redacted view builder
  ui/            Presentation (vanilla TS)
    dom.ts         h() element builder, theme/layout/reveal helpers
    cards.ts       card / chip rendering
    screens.ts     lobby, connecting, and table (oval + list) views
    sound.ts       Web Audio effects (deal / chips / knock / win / turn)
    styles.css     theming via CSS custom properties
  assets/sfx/    CC0 poker sounds (Kenney) + a public-domain knock
  main.ts        App wiring: identity, routing, client lifecycle, sound cues
```

The layering is strict: **`engine` knows nothing about the DOM or the network**, so the
rules are testable in isolation; **`net`** turns UI intent into engine calls and builds
the redacted views; **`ui`** only renders the view it's given.

---

## Develop

```bash
npm install
npm run dev        # local dev server
npm test           # engine + protocol + render unit tests (Vitest)
npm run build      # typecheck + production build to dist/
```

Open two browser tabs (or two devices) on the dev URL to play against yourself, or join
room **`TEST`** to play a full table against bots.

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which typechecks, builds, and
publishes `dist/` to GitHub Pages. Enable it once under
**Settings → Pages → Source: GitHub Actions**.

---

## Credits

Sound effects: [Kenney "Casino Audio"](https://kenney.nl/assets/casino-audio) (CC0) and a
public-domain wood-knock from Wikimedia Commons. Fonts: Space Grotesk + Inter.
