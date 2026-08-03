-- Weight-elicitation study schema (Postgres / Neon).
-- Run once against your DATABASE_URL:  psql "$DATABASE_URL" -f sql/schema.sql

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
    id                 bigserial PRIMARY KEY,
    participant_id     text REFERENCES participants(id),
    task_id            text NOT NULL,
    scenario_id        text,
    chosen_hotel_id    text NOT NULL,
    -- full option set with hidden component vectors: [{hotel_id, components}]
    options            jsonb NOT NULL,
    is_attention_check boolean NOT NULL DEFAULT false,
    attention_pass     boolean,
    -- render/first-interaction/decision times, per-option dwell, revisions
    timing             jsonb,
    submitted_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS responses_participant_idx ON responses (participant_id);
CREATE INDEX IF NOT EXISTS responses_scenario_idx ON responses (scenario_id);
