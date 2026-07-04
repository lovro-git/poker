# P2P Hold'em — Context

A browser-based, serverless Texas Hold'em you play with friends. One person creates
a room and shares a key/link; everyone joins and plays. Hosted as a static site on
GitHub Pages — there is no backend.

## How it works (one paragraph)

The site is static. Real-time play happens **peer-to-peer** via [Trystero]: the room
creator's browser is the authoritative **host** (dealer) that runs the game engine and
is also seat 0. Peers send *actions* to the host; the host validates them, advances the
game, and broadcasts a public *state snapshot* to everyone plus each player's own
private hole cards. There are no secrets and no accounts.

[Trystero]: https://github.com/dmotz/trystero

## Core decisions

- **Transport:** P2P (Trystero). No backend, no signup, no secrets. Room = a short
  shareable key/link. Accepted tradeoff: authoritative state lives in the host's tab.
- **Host = player.** The creator plays from seat 0 and runs the engine.
- **Host resilience:** host snapshots full state to `localStorage` after every action,
  so an accidental refresh/crash-reopen resumes the same hand. Full host *migration*
  (electing a new host if the host leaves for good) is **deferred** — the table ends.
- **Player identity:** a persistent id in `localStorage`, decoupled from the transient
  peer connection. On rejoin you reclaim your seat, chips, and cards.
- **Absent players never stall the table:** on their turn, a disconnected *or* idle
  (shot-clock-expired) player is auto-checked if free, otherwise auto-folded. Default
  shot clock 45s, host-configurable.

## Game rules

- **No-Limit Texas Hold'em**, 2–9 seats, standard min-raise rules, multi-way side pots,
  odd chips awarded to the first seat left of the button. Correct heads-up blinds
  (button posts SB, acts first pre-flop, last post-flop).
- **Cash game:** fixed blinds. A busted (or short) player self-serves a **rebuy** to the
  buy-in between hands — no approval.
- **Tournament:** no rebuys; busting = elimination. **Blinds escalate one ladder level
  each time a player is eliminated.** Last player standing wins.
- **Hand flow:** auto-advance ~5s after showdown. The between-hands window is when
  queued changes apply — rebuys, new joiners sitting down, sit-out toggles.
- **Joining mid-hand / full table:** you become a **spectator** (public state only, no
  hole cards, cannot act) and are auto-seated at the next hand boundary when a seat is
  free. First-come queue.
- **Reveal policy:** folded cards stay hidden; an uncalled win (everyone folds) stays
  hidden with an optional "Show"; at showdown remaining hands are revealed, a beaten
  player may muck, and the winner's hand is always shown.

## Frontend

- **Vanilla TypeScript + Vite**, state-driven `render(state)`. Only runtime dependency
  is Trystero. Small bundle, fast on phones.
- **Responsive:** desktop landscape and phone portrait. Modern, minimalist, rounded.
- **Layout:** oval table + community cards + pot up top; my hole cards large at
  bottom-right; my action controls (Fold/Check/Call/Raise + slider and
  Min/½-Pot/Pot/All-In presets) at bottom-left.

## Testing & deploy

- **Vitest** unit tests on the engine (hand evaluation, side pots, betting legality,
  odd-chip splits, heads-up blind order). Net/UI verified by running the app.
- **GitHub Actions → Pages** on push to `main`; public repo. Live at
  `https://<user>.github.io/poker/`.

See `docs/adr/` for any decisions that get revisited, and `.scratch/holdem/` for the PRD
and issues.
