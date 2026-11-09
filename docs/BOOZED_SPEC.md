# Boozed (Bar Fest) — v1 Spec

Hybrid Mines-style push-your-luck game. Native iOS first. Bomb positions live on the server for the life of an active round; the device owns UI, animation, and display math.

## Core loop

- 5×5 board (tiles `0…24`).
- Proof → shot count `m`: 80→3, 100→5, 120→8, 151→12.
- Tap coasters; each safe raise increases multiplier.
- After `k ≥ 1` safe reveals, **Close your tab** banks `floor(100 × multiplier)` points.
- Tap a shot → **Blacked out**, 0 points that round, streak resets.
- Clearing all safes auto-cashes out.

### Multiplier (fair odds)

```
multiplier(0, m) = 1
multiplier(k, m) = ∏_{i=0}^{k-1} (25 − i) / (25 − m − i)
```

Display to 2 decimals; award from server cashout only.

## Theme

- Safe: snacks / soft drinks. Shot: harsh liquors (flavor only — no drinking dares).
- Difficulty label: **Proof**. Cash out: **Close your tab**. Blow: **Blacked out**.

## Network (low-data)

| Call | Purpose |
|------|---------|
| `boozed_start` | Create round; return `roundId`, `proof`, `shots` — **no bombs** |
| `boozed_reveal` | `{ tile }` → safe (+ item, k, mult) or shot (+ full board) |
| `boozed_cashout` | Points + profile stats + full board |
| `boozed_me` | Profile + optional active round (revealed tiles only) |

Optimistic flip on device; disable taps while a reveal is in flight. Idempotent reveal.

## Persistence

- `boozed_rounds` — bombs/items server-only while `status = active`.
- `boozed_profiles` — `tab_score`, `streak`, `best_multiplier`, `rounds_played`.
- Daily leaderboard via `ranked_daily_scores` with `game_type = 'boozed'` and `score_points` (best single cash-out that Eastern day).
- Stale active rounds expire after **24h** as blown.
- Identity: anonymous `user_id` (same Keychain id as the rest of the app), passed as `p_user_id`.

## UI

- Dark Games aesthetic (not wood/brass prototype skin).
- Lobby: title, one-line blurb, Proof chips, Start, Exit.
- Play: 5×5 coasters, receipt-style stats, Close your tab / Next round.
- Resume active round on open when `boozed_me` returns one.

## Out of scope (v1)

Cap/web port, friend challenges, provably-fair verify UI, friends/bar/global leaderboard scopes, bar perks, real money.

## Compliance

No wagering / IAP for points. No “loser drinks” mechanics. Alcohol is theme only.

## SQL

See [`supabase/boozed.sql`](../supabase/boozed.sql). Run in the Supabase SQL editor before shipping.
