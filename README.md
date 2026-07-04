# P2P Hold'em ♠♥♦♣

Serverless Texas Hold'em you play with friends in the browser. One person creates a
room and shares a key/link; everyone joins and plays. No backend — real-time play is
peer-to-peer via [Trystero], and the whole thing is a static site on GitHub Pages.

**Play:** open the deployed link, enter a name, **Create room**, and share the invite
link. Others open it and join. See [`CONTEXT.md`](CONTEXT.md) for how it works.

## Features

- No-Limit Texas Hold'em, 2–9 players, correct heads-up blinds and multi-way side pots.
- **Cash game** (fixed blinds, self-service rebuys) and **Tournament** (blinds rise on
  every bust-out, last player standing wins).
- Reconnect and reclaim your seat; a 45s shot clock and auto-fold keep absent players
  from stalling the table.
- Muck/show controls, spectators, responsive layout for desktop and phones.

## Develop

```bash
npm install
npm run dev        # local dev server
npm test           # engine + protocol unit tests (Vitest)
npm run build      # typecheck + production build to dist/
```

Open two browser tabs (or two devices) on the dev URL to play against yourself.

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes to
GitHub Pages. Enable Pages once in **Settings → Pages → Source: GitHub Actions**.

## Layout

- `src/engine/` — pure game logic (cards, evaluator, betting state machine, side pots).
- `src/net/` — Trystero room controller (host authority) + redacted view protocol.
- `src/ui/` — vanilla-TS state-driven rendering.

[Trystero]: https://github.com/dmotz/trystero
