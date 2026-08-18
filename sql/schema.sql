-- Weight-elicitation study schema (Postgres / Neon).
-- Run once against your DATABASE_URL:  psql "$DATABASE_URL" -f sql/schema.sql
--
-- Each row in `responses` is ONE RANKING GROUP: a task shows the whole hotel
-- pool for a given location anchor, and `options` holds every candidate with its
-- five component features, the position it was displayed at, and whether it was
-- the one chosen. That is the shape a learning-to-rank exporter consumes
-- directly (see analysis/export_dataset.py).

CREATE TABLE IF NOT EXISTS participants (
    id               text PRIMARY KEY,
    consent          boolean NOT NULL DEFAULT false,
    consent_ts       timestamptz,
    demographics     jsonb,
    material_version text,
    user_agent       text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS responses (
    id                  bigserial PRIMARY KEY,
    participant_id      text REFERENCES participants(id),
    task_id             text NOT NULL,
    scenario_id         text,
    -- which Colombo location the task was framed around (galle_face, ...)
    anchor_id           text,
    -- the dimension the scenario is designed to stress, and its trade-off partner
    primary_dimension   text,
    secondary_dimension text,
    -- set when this task deliberately repeats an earlier one (test-retest)
    repeat_of           text,
    chosen_hotel_id     text NOT NULL,
    -- [{hotel_id, components{5}, displayed_position, chosen}] — the labelled group
    options             jsonb NOT NULL,
    -- stage 2: which room inside the chosen hotel was booked, its full offer
    -- record, and the sibling offers it was chosen over
    chosen_room_id      text,
    room                jsonb,
    room_options        jsonb,
    is_attention_check  boolean NOT NULL DEFAULT false,
    attention_pass      boolean,
    -- render/first-interaction/decision times, per-option dwell, revisions
    timing              jsonb,
    -- ordered log of search / filter / sort actions taken during the task
    interactions        jsonb,
    submitted_at        timestamptz NOT NULL DEFAULT now()
);

-- Upgrade path for a database created before the anchored design.
--
-- These MUST come before the indexes below. On an existing database the
-- CREATE TABLE above is skipped, so `anchor_id` does not exist yet; building
-- responses_anchor_idx first fails with 42703 and aborts the rest of the
-- script, leaving the columns unadded. (That is exactly how the deployed
-- study ended up rejecting every insert.)
ALTER TABLE responses ADD COLUMN IF NOT EXISTS anchor_id           text;
ALTER TABLE responses ADD COLUMN IF NOT EXISTS primary_dimension   text;
ALTER TABLE responses ADD COLUMN IF NOT EXISTS secondary_dimension text;
ALTER TABLE responses ADD COLUMN IF NOT EXISTS repeat_of           text;
ALTER TABLE responses ADD COLUMN IF NOT EXISTS interactions        jsonb;
-- added with the two-stage (hotel then room) design
ALTER TABLE responses ADD COLUMN IF NOT EXISTS chosen_room_id      text;
ALTER TABLE responses ADD COLUMN IF NOT EXISTS room                jsonb;
ALTER TABLE responses ADD COLUMN IF NOT EXISTS room_options        jsonb;

CREATE INDEX IF NOT EXISTS responses_participant_idx ON responses (participant_id);
CREATE INDEX IF NOT EXISTS responses_scenario_idx    ON responses (scenario_id);
CREATE INDEX IF NOT EXISTS responses_anchor_idx      ON responses (anchor_id);
