# Weight-Elicitation Study

A small **Discrete Choice Experiment (DCE)** for the ALMA-GraphRAG project. It
shows travellers a scenario and the whole pool of real Colombo hotels, records
the booking they would make plus fine-grained timing, and from that data we
**learn the composite-score weights** instead of hand-tuning them.

The five sub-scores it calibrates are the same ones the retriever uses:
`spatial · accessibility · facility · economic · disruption`
(see `../../src/graph/retriever.py`, `ScoringWeights`).

## The choice is two-stage

A booking is not "pick a hotel" — it is "pick a hotel, then pick a room in it",
and the study mirrors that:

| Stage | Alternatives | Attributes | Role |
|---|---|---|---|
| 1 · hotel | the whole pool (~34) | the five components, **hidden** from the browser | the weights |
| 2 · room | the 2–5 live offers in the chosen hotel | price (LKR), board basis, refundability, size, beds, occupancy — all **shown** | the money scale |

Stage 2 is not decoration. Stage-1 clicks identify the five weights only up to
an arbitrary scale factor. The room step carries an explicit price attribute in
rupees, so the trade-offs inside it — what a guest pays to add breakfast, or to
keep free cancellation — convert coefficients into willingness-to-pay and put
the whole weight vector on a monetary scale. Carrying a price attribute for
exactly this reason is standard DCE practice.

Both stages come from live LiteAPI data, joined offline:

- `POST /hotels/rates` → the commercial side of each offer (price, board,
  refundable, cancellation deadline) and a supplier room label.
- `GET /data/hotel` → the content side (proper room name, floor area, bed
  configuration, occupancy, photos, in-room amenities), plus the hotel's full
  facility list, image gallery, check-in times and guest-sentiment breakdown.
- `rates[].mappedRoomId` joins onto `rooms[].id`, and resolves for essentially
  every live offer.

Hotels offering fewer than two live rooms are dropped by the generator: a forced
non-choice is not an observation.

## Why it's decoupled

The study collects irreplaceable human data, so it must not depend on Neo4j or
pgvector at runtime. The pipeline has exactly two seams:

```
Python (main repo, offline)              This app (Next.js, Vercel)
─────────────────────────                ──────────────────────────
generator/build_material.py   ──JSON──▶  serves tasks, records choices
  (reuses src/ scoring)                    → Postgres (Neon) or ./data/*.jsonl
                                                      │
analysis/fit_weights.py   ◀────── DB / export ────────┘
  conditional logit → ŵ → re-run evaluation/run_eval.py
```

`material/study_material_v1.json` is generated offline and committed (versioned),
so every response is reproducibly tied to a material version.

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000
```

**No database needed for a local run.** With `DATABASE_URL` unset, responses are
appended to `./data/*.jsonl`. To persist to Postgres instead, copy `.env.example`
to `.env.local` and set `DATABASE_URL` (local Postgres or Neon), then apply the
schema once:

```bash
psql "$DATABASE_URL" -f sql/schema.sql
```

## Flow

`/` consent → `/demographics` (optional) → `/study` → `/done`.

Within a task: browse/search/sort the pool → open a hotel to see its gallery,
full facilities, guest ratings and rooms → pick a room → **Book this room** →
Next.

Captured per choice:

- **Stage 1** — chosen hotel and the full option set with **hidden** component
  vectors, plus the position each candidate was displayed at.
- **Stage 2** — chosen room and every sibling offer in that hotel with its
  price, board, refundability, size and occupancy.
- Attention-check pass/fail.
- Timing — render → first-interaction → decision, per-card hover dwell,
  **per-hotel detail-panel dwell**, the order hotels were opened in, every room
  pick, and revisions to the confirmed choice.
- An ordered interaction log (search, sort, price filter, open/close hotel,
  gallery, select room, confirm).

Both the component vectors and the room attributes are re-derived server-side
from the frozen material, so the browser can neither see the stage-1 features
nor assert a price the material does not agree with.

## Deploy (Vercel + Neon)

1. **Neon** — create a free Postgres project (neon.tech). Copy the **pooled**
   connection string (`...-pooler...?sslmode=require`). Apply the schema once:
   ```bash
   psql "postgres://…-pooler…/db?sslmode=require" -f sql/schema.sql
   ```
2. **Vercel** — import this Git repo, then in the project settings set
   **Root Directory = `studies/weight-elicitation`** (Vercel auto-detects Next.js
   and runs `npm install` + `next build` there).
3. **Env vars** (Vercel → Settings → Environment Variables):
   - `DATABASE_URL` = the Neon pooled string
   - `ADMIN_TOKEN` = a long random secret (gates `/admin`)
4. Deploy. Study lives at `/`, admin at `/admin?token=<ADMIN_TOKEN>`.

The material JSON is bundled at build time and writes go straight to Neon, so
the deployment is independent of the main ALMA stack (no Neo4j/pgvector). The
`data/*.jsonl` fallback is local-dev only — production always uses `DATABASE_URL`.

## Status

- **Done:** app scaffold, full two-stage study flow, timing capture, JSONL/Postgres
  persistence, admin dashboard (`/admin`, token-gated) with CSV/JSON export,
  LiteAPI material generator (real Colombo hotels — gallery, full facilities,
  guest sentiment, check-in times, and live bookable rooms), ranking-dataset
  exporter for both stages, production build verified.
- **Next:** deploy to Vercel + Neon; `analysis/fit_weights.py` (conditional
  logit → learned weights → re-run `evaluation/run_eval.py`), fitting stage 2
  for the price coefficient and rescaling the stage-1 weights against it.

### Schema note

The room columns (`chosen_room_id`, `room`, `room_options`) are added by
idempotent `ALTER TABLE ... IF NOT EXISTS` statements that `lib/db.ts` applies
on the first database call of each process, so an existing Neon database picks
them up on the next deploy with no manual migration.
