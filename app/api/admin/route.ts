import { NextResponse } from "next/server";
import { fetchAllData, usingDatabase } from "@/lib/db";
import { loadMaterial } from "@/lib/material";

/**
 * Admin read endpoint. Gated by ADMIN_TOKEN (query `?token=` or `x-admin-token`
 * header). If ADMIN_TOKEN is not configured, access is allowed only from
 * localhost — so local dev is frictionless but a deployed instance is closed
 * until a token is set.
 */
function authorized(request: Request): boolean {
  const url = new URL(request.url);
  const token =
    url.searchParams.get("token") ?? request.headers.get("x-admin-token");
  const expected = process.env.ADMIN_TOKEN;
  if (expected) return token === expected;
  const host = request.headers.get("host") ?? "";
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "unauthorized — supply ?token=… (or set ADMIN_TOKEN)" },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "json";

  const { participants, responses } = await fetchAllData();
  const material = loadMaterial();
  const hotelName = (id: string) => material.hotels[id]?.name ?? id;
  // Scenarios are now the tasks themselves - each carries its own persona,
  // anchor and the dimension pair it is designed to stress.
  const scenarioPersona = (id: string) =>
    material.tasks.find((t) => t.id === id)?.persona ?? id;

  // ---- CSV export: one row per choice (for quick eyeballing / spreadsheets) --
  if (format === "csv") {
    const header = [
      "participant_id",
      "task_id",
      "scenario_id",
      "scenario_persona",
      "chosen_hotel_id",
      "chosen_hotel_name",
      "is_attention_check",
      "attention_pass",
      "decision_ms",
      "time_to_first_interaction_ms",
      "revisions",
      "submitted_at",
    ];
    const lines = [header.join(",")];
    for (const r of responses) {
      const t = r.timing as Record<string, unknown>;
      lines.push(
        [
          r.participantId,
          r.taskId,
          r.scenarioId,
          scenarioPersona(r.scenarioId),
          r.chosenHotelId,
          hotelName(r.chosenHotelId),
          r.isAttentionCheck,
          r.attentionPass,
          t.decision_ms ?? "",
          t.time_to_first_interaction_ms ?? "",
          t.revisions ?? "",
          r.submittedAt,
        ]
          .map(csvEscape)
          .join(","),
      );
    }
    return new NextResponse(lines.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="responses_${material.version}.csv"`,
      },
    });
  }

  // ---- Full raw dump (for the Python choice-model analysis) ------------------
  if (format === "raw") {
    return NextResponse.json(
      { version: material.version, participants, responses },
      {
        headers: {
          "content-disposition": `attachment; filename="study_data_${material.version}.json"`,
        },
      },
    );
  }

  // ---- Dashboard summary -----------------------------------------------------
  const nTasks = material.tasks.length;
  const respByParticipant = new Map<string, number>();
  for (const r of responses)
    respByParticipant.set(
      r.participantId,
      (respByParticipant.get(r.participantId) ?? 0) + 1,
    );
  const completed = [...respByParticipant.values()].filter(
    (n) => n >= nTasks,
  ).length;

  const attentionRows = responses.filter((r) => r.isAttentionCheck);
  const attentionPasses = attentionRows.filter((r) => r.attentionPass === true);

  const decisionTimes = responses
    .map((r) => Number((r.timing as Record<string, unknown>).decision_ms))
    .filter((n) => Number.isFinite(n));

  // Per-scenario choice distribution (skip attention checks)
  const byScenario = material.tasks
    .filter((s) => !s.is_attention_check)
    .map((s) => {
      const rows = responses.filter((r) => r.scenarioId === s.id);
      const counts = new Map<string, number>();
      for (const r of rows)
        counts.set(
          r.chosenHotelId,
          (counts.get(r.chosenHotelId) ?? 0) + 1,
        );
      const distribution = [...counts.entries()]
        .map(([id, count]) => ({ hotelId: id, hotel: hotelName(id), count }))
        .sort((a, b) => b.count - a.count);
      return {
        scenarioId: s.id,
        persona: s.persona,
        primaryDimension: s.primary_dimension,
        total: rows.length,
        distribution,
      };
    });

  const enrichedResponses = responses.map((r) => ({
    ...r,
    chosenHotel: hotelName(r.chosenHotelId),
    persona: scenarioPersona(r.scenarioId),
    decisionMs: (r.timing as Record<string, unknown>).decision_ms ?? null,
  }));

  return NextResponse.json({
    storage: usingDatabase ? "postgres" : "jsonl-local",
    version: material.version,
    summary: {
      participants: participants.length,
      responses: responses.length,
      completed,
      totalTasks: nTasks,
      attentionChecks: attentionRows.length,
      attentionPassRate:
        attentionRows.length === 0
          ? null
          : attentionPasses.length / attentionRows.length,
      medianDecisionMs: median(decisionTimes),
    },
    byScenario,
    participants,
    responses: enrichedResponses,
  });
}
