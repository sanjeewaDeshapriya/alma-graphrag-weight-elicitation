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
      "chosen_room_id",
      "chosen_room_name",
      "room_price_lkr",
      "room_board",
      "room_refundable",
      "room_size_sqm",
      "n_rooms_offered",
      "is_attention_check",
      "attention_pass",
      "decision_ms",
      "time_to_first_interaction_ms",
      "n_hotels_opened",
      "revisions",
      "room_revisions",
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
          r.chosenRoomId ?? "",
          r.room?.name ?? "",
          r.room?.price_lkr ?? "",
          r.room?.board_name ?? "",
          r.room?.refundable ?? "",
          r.room?.size_sqm ?? "",
          r.roomOptions.length,
          r.isAttentionCheck,
          r.attentionPass,
          t.decision_ms ?? "",
          t.time_to_first_interaction_ms ?? "",
          t.n_hotels_opened ?? "",
          t.revisions ?? "",
          t.room_revisions ?? "",
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

  // Stage 2. `upgradeRate` is the headline: how often a participant passed over
  // the cheapest room in the hotel they picked. If it were ~0 the room step
  // would be a formality and could not price anything.
  const withRoom = responses.filter((r) => r.room && r.roomOptions.length > 0);
  const upgrades = withRoom.filter((r) => {
    const cheapest = Math.min(...r.roomOptions.map((o) => o.price_lkr));
    return (r.room?.price_lkr ?? 0) > cheapest;
  });
  const premiums = withRoom.map((r) => {
    const cheapest = Math.min(...r.roomOptions.map((o) => o.price_lkr));
    return (r.room?.price_lkr ?? 0) - cheapest;
  });
  const boardCounts = new Map<string, number>();
  for (const r of withRoom) {
    const b = r.room?.board_name ?? "unknown";
    boardCounts.set(b, (boardCounts.get(b) ?? 0) + 1);
  }

  const enrichedResponses = responses.map((r) => ({
    ...r,
    chosenHotel: hotelName(r.chosenHotelId),
    chosenRoom: r.room?.name ?? null,
    roomPriceLkr: r.room?.price_lkr ?? null,
    roomBoard: r.room?.board_name ?? null,
    roomRefundable: r.room?.refundable ?? null,
    nRoomsOffered: r.roomOptions.length,
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
      roomChoices: withRoom.length,
      upgradeRate: withRoom.length === 0 ? null : upgrades.length / withRoom.length,
      medianPremiumLkr: median(premiums),
      refundableRate:
        withRoom.length === 0
          ? null
          : withRoom.filter((r) => r.room?.refundable).length / withRoom.length,
      byBoard: [...boardCounts.entries()]
        .map(([board, count]) => ({ board, count }))
        .sort((a, b) => b.count - a.count),
    },
    byScenario,
    participants,
    responses: enrichedResponses,
  });
}
