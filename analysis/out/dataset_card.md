# ALMA hotel-choice dataset

Generated 2026-08-14T16:41:35+00:00

## Shape

| | |
|---|---|
| Participants | 3 |
| Queries (participant x task) | 16 |
| Rows (candidates) | 410 |
| Positive labels | 11 |
| Rows per query | up to 25 |

Attention-check tasks excluded from the dataset: 2.
Participants who failed the attention check: 2
(rows dropped: 0).

## Files

| File | Format |
|---|---|
| `dataset.csv` | one row per candidate, all columns |
| `dataset.jsonl` | same rows as JSON |
| `dataset.ltr.txt` | `<label> qid:<n> 1:.. 6:.. # <hotel_id>` (RankLib / XGBoost) |
| `groups.txt` | group sizes in qid order |

## Features (in `dataset.ltr.txt` order)

1. `spatial`
2. `accessibility`
3. `facility`
4. `economic`
5. `disruption`
6. `position`

`position` is the 1-based rank the hotel was displayed at, or 0 if the
participant had filtered it out. `shown` in the CSV distinguishes the two.

## Caveats a user of this data must know

- **Position is confounded with proximity.** Each task's list opens sorted by
  distance to the task anchor, so the nearest hotels are also the ones at the
  top. `position` is exported so this can be modelled or corrected; a model
  trained without it will attribute the effect of rank to the spatial feature.
- **`spatial` and `accessibility` are strongly correlated** (~0.9 across the
  pool: in Colombo, being close and being quick to reach mostly coincide).
  Treat them as one location signal unless you have a design that separates
  them. Observed correlations at or above 0.5 in this export:
  - `spatial` vs `accessibility`: r = 0.90
  - `facility` vs `economic`: r = -0.69
- **Choice sets are participant-dependent.** Search and filters were available,
  so the candidates actually on screen differ between participants for the same
  task. `shown`, `n_shown`, `final_sort`, `final_query` and `final_max_price`
  describe what each participant had narrowed the list to.
- **Repeated task.** `t10` deliberately repeats `t2`; `repeat_of` marks it. Use
  the pair to measure test-retest consistency, and drop one of them before
  training so the same decision is not counted twice.
