/**
 * Persistence layer for the elicitation study (server-only).
 *
 * If DATABASE_URL is set (Neon in prod, local Postgres in dev) responses are
 * written to Postgres. If it is NOT set — e.g. a first local run with no DB —
 * rows are appended to ./data/*.jsonl so the app still runs and captures data.
 * The study collects irreplaceable human data, so it must never silently drop a
 * response just because a database isn't wired up yet.
 */
import fs from "node:fs";
import path from "node:path";
import type Postgres from "postgres";
import type { Dimension } from "./material";

type Sql = Postgres.Sql;

const DATABASE_URL = process.env.DATABASE_URL;
export const usingDatabase = Boolean(DATABASE_URL);

// On Vercel/any serverless host the filesystem is read-only, so the JSONL
// fallback cannot work there — a missing DATABASE_URL is a configuration error.
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_REGION);

/** Human-readable hint for why a persistence call may have failed. */
export function storageHint(): string {
  if (!DATABASE_URL) {
    return IS_SERVERLESS
      ? "DATABASE_URL is not set. Add it in your Vercel project → Settings → Environment Variables (a Neon pooled connection string), then redeploy."
      : "DATABASE_URL is not set (using local ./data JSONL fallback).";
  }
  return "Database write failed. Check the DATABASE_URL is correct and that sql/schema.sql has been applied to it.";
}

let _sql: Sql | null = null;
async function getSql(): Promise<Sql> {
  if (!_sql) {
    const pg = (await import("postgres")).default;
    const local = /localhost|127\.0\.0\.1/.test(DATABASE_URL!);
    _sql = pg(DATABASE_URL!, { ssl: local ? false : "require" });
  }
  return _sql;
}

const DATA_DIR = path.join(process.cwd(), "data");
function appendJsonl(file: string, row: unknown): void {
  if (IS_SERVERLESS) {
    // Read-only FS on Vercel — never silently lose data; fail with a clear cause.
    throw new Error(storageHint());
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(path.join(DATA_DIR, file), JSON.stringify(row) + "\n");
}

function readJsonl<T>(file: string): T[] {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export async function createParticipant(rec: {
  id: string;
  consent: boolean;
  materialVersion: string;
  userAgent: string;
}): Promise<void> {
  if (!usingDatabase) {
    appendJsonl("participants.jsonl", {
      ...rec,
      created_at: new Date().toISOString(),
    });
    return;
  }
  const sql = await getSql();
  await sql`
    INSERT INTO participants (id, consent, consent_ts, material_version, user_agent)
    VALUES (${rec.id}, ${rec.consent}, now(), ${rec.materialVersion}, ${rec.userAgent})
    ON CONFLICT (id) DO NOTHING`;
}

export async function updateDemographics(
  id: string,
  demographics: Record<string, unknown>,
): Promise<void> {
  if (!usingDatabase) {
    appendJsonl("demographics.jsonl", {
      id,
      demographics,
      ts: new Date().toISOString(),
    });
    return;
  }
  const sql = await getSql();
  await sql`UPDATE participants SET demographics = ${sql.json(
    demographics as unknown as Postgres.JSONValue,
  )} WHERE id = ${id}`;
}

/** One candidate in a ranking group: its features, where it was shown, and the label. */
export interface OptionVec {
  hotel_id: string;
  components: Record<Dimension, number> | null;
  displayed_position: number | null;
  chosen: boolean;
}

export interface ResponseRecord {
  participantId: string;
  taskId: string;
  scenarioId: string;
  anchorId: string;
  primaryDimension: string | null;
  secondaryDimension: string | null;
  repeatOf: string | null;
  chosenHotelId: string;
  options: OptionVec[];
  isAttentionCheck: boolean;
  attentionPass: boolean | null;
  timing: Record<string, unknown>;
  /** Ordered log of search / filter / sort actions taken during the task. */
  interactions: unknown[];
}

export async function insertResponse(rec: ResponseRecord): Promise<void> {
  if (!usingDatabase) {
    appendJsonl("responses.jsonl", {
      ...rec,
      submitted_at: new Date().toISOString(),
    });
    return;
  }
  const sql = await getSql();
  await sql`
    INSERT INTO responses
      (participant_id, task_id, scenario_id, anchor_id, primary_dimension,
       secondary_dimension, repeat_of, chosen_hotel_id, options,
       is_attention_check, attention_pass, timing, interactions)
    VALUES
      (${rec.participantId}, ${rec.taskId}, ${rec.scenarioId}, ${rec.anchorId},
       ${rec.primaryDimension}, ${rec.secondaryDimension}, ${rec.repeatOf},
       ${rec.chosenHotelId},
       ${sql.json(rec.options as unknown as Postgres.JSONValue)},
       ${rec.isAttentionCheck}, ${rec.attentionPass},
       ${sql.json(rec.timing as unknown as Postgres.JSONValue)},
       ${sql.json(rec.interactions as unknown as Postgres.JSONValue)})`;
}

// ---------------------------------------------------------------------------
// Admin read-side (works in both Postgres and JSONL-fallback modes)
// ---------------------------------------------------------------------------

/** Raw participant row from either source (snake_case DB or camelCase JSONL). */
interface RawParticipant {
  id: string;
  consent?: boolean;
  demographics?: Record<string, unknown> | null;
  material_version?: string | null;
  materialVersion?: string | null;
  created_at?: string | Date | null;
}

interface RawResponse {
  participant_id?: string;
  participantId?: string;
  task_id?: string;
  taskId?: string;
  scenario_id?: string;
  scenarioId?: string;
  chosen_hotel_id?: string;
  chosenHotelId?: string;
  anchor_id?: string;
  anchorId?: string;
  primary_dimension?: string | null;
  primaryDimension?: string | null;
  secondary_dimension?: string | null;
  secondaryDimension?: string | null;
  repeat_of?: string | null;
  repeatOf?: string | null;
  options?: OptionVec[];
  is_attention_check?: boolean;
  isAttentionCheck?: boolean;
  attention_pass?: boolean | null;
  attentionPass?: boolean | null;
  timing?: Record<string, unknown>;
  interactions?: unknown[];
  submitted_at?: string | Date | null;
}

export interface AdminParticipant {
  id: string;
  consent: boolean;
  demographics: Record<string, unknown> | null;
  materialVersion: string | null;
  createdAt: string | null;
}

export interface AdminResponse {
  participantId: string;
  taskId: string;
  scenarioId: string;
  anchorId: string;
  primaryDimension: string | null;
  secondaryDimension: string | null;
  repeatOf: string | null;
  chosenHotelId: string;
  options: OptionVec[];
  isAttentionCheck: boolean;
  attentionPass: boolean | null;
  timing: Record<string, unknown>;
  interactions: unknown[];
  submittedAt: string | null;
}

function isoOrNull(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.toISOString();
}

function normParticipant(p: RawParticipant): AdminParticipant {
  return {
    id: p.id,
    consent: Boolean(p.consent),
    demographics: p.demographics ?? null,
    materialVersion: p.materialVersion ?? p.material_version ?? null,
    createdAt: isoOrNull(p.created_at),
  };
}

function normResponse(r: RawResponse): AdminResponse {
  return {
    participantId: r.participantId ?? r.participant_id ?? "",
    taskId: r.taskId ?? r.task_id ?? "",
    scenarioId: r.scenarioId ?? r.scenario_id ?? "",
    anchorId: r.anchorId ?? r.anchor_id ?? "",
    primaryDimension: r.primaryDimension ?? r.primary_dimension ?? null,
    secondaryDimension: r.secondaryDimension ?? r.secondary_dimension ?? null,
    repeatOf: r.repeatOf ?? r.repeat_of ?? null,
    chosenHotelId: r.chosenHotelId ?? r.chosen_hotel_id ?? "",
    options: r.options ?? [],
    isAttentionCheck: Boolean(r.isAttentionCheck ?? r.is_attention_check),
    attentionPass: r.attentionPass ?? r.attention_pass ?? null,
    timing: r.timing ?? {},
    interactions: r.interactions ?? [],
    submittedAt: isoOrNull(r.submitted_at),
  };
}

export async function fetchAllData(): Promise<{
  participants: AdminParticipant[];
  responses: AdminResponse[];
}> {
  if (!usingDatabase) {
    // Demographics live in a separate JSONL file in fallback mode — merge them in.
    const demoRows = readJsonl<{ id: string; demographics?: Record<string, unknown> }>(
      "demographics.jsonl",
    );
    const demoMap = new Map<string, Record<string, unknown>>();
    for (const d of demoRows) demoMap.set(d.id, d.demographics ?? {});

    const participants = readJsonl<RawParticipant>("participants.jsonl").map((p) =>
      normParticipant({ ...p, demographics: demoMap.get(p.id) ?? null }),
    );
    const responses = readJsonl<RawResponse>("responses.jsonl").map(normResponse);
    return { participants, responses };
  }

  const sql = await getSql();
  const prows = await sql<RawParticipant[]>`
    SELECT id, consent, demographics, material_version, created_at
    FROM participants ORDER BY created_at`;
  const rrows = await sql<RawResponse[]>`
    SELECT participant_id, task_id, scenario_id, anchor_id, primary_dimension,
           secondary_dimension, repeat_of, chosen_hotel_id, options,
           is_attention_check, attention_pass, timing, interactions, submitted_at
    FROM responses ORDER BY submitted_at`;

  return {
    participants: prows.map(normParticipant),
    responses: rrows.map(normResponse),
  };
}
