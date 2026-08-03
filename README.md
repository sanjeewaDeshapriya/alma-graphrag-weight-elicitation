# Weight-Elicitation Study

A small **Discrete Choice Experiment (DCE)** for the ALMA-GraphRAG project. It
shows travellers a scenario and a set of real Colombo hotels, records which one
they would book (best-of-5) plus fine-grained timing, and from that data we
**learn the composite-score weights** instead of hand-tuning them.

The five sub-scores it calibrates are the same ones the retriever uses:
`spatial · accessibility · facility · economic · disruption`
(see `../../src/graph/retriever.py`, `ScoringWeights`).

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

`/` consent → `/demographics` (optional) → `/study` (best-of-5 tasks) → `/done`.

Captured per choice: chosen hotel, the full option set with **hidden** component
vectors (re-derived server-side so the browser never sees them), attention-check
pass/fail, and timing (render → first-interaction → decision, per-option dwell,
selection revisions).

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

- **Done:** app scaffold, full study flow, timing capture, JSONL/Postgres
  persistence, admin dashboard (`/admin`, token-gated) with CSV/JSON export,
  LiteAPI material generator (real Colombo hotels — image, facilities,
  description, reviews), production build verified.
- **Next:** deploy to Vercel + Neon; `analysis/fit_weights.py` (conditional
  logit → learned weights → re-run `evaluation/run_eval.py`).
