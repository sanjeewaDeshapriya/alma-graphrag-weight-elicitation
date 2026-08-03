import { NextResponse } from "next/server";
import { insertResponse } from "@/lib/db";
import { getResolvedTask } from "@/lib/material";

/**
 * Record one choice. The client sends only the chosen hotel id + timing; the
 * server re-derives the full option set and the hidden component vectors from
 * the frozen material, so the browser never sees (or can tamper with) the
 * feature vectors used by the choice model.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { participantId, taskId, chosenHotelId, timing } = body ?? {};

  if (!participantId || !taskId || !chosenHotelId) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const task = getResolvedTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "unknown task" }, { status: 400 });
  }
  const chosen = task.options.find((o) => o.hotel_id === chosenHotelId);
  if (!chosen) {
    return NextResponse.json(
      { error: "chosen hotel not in task" },
      { status: 400 },
    );
  }

  const attentionPass = task.is_attention_check
    ? chosenHotelId === task.attention_answer_hotel_id
    : null;

  await insertResponse({
    participantId,
    taskId,
    scenarioId: task.scenario.id,
    chosenHotelId,
    options: task.options.map((o) => ({
      hotel_id: o.hotel_id,
      components: o.components,
    })),
    isAttentionCheck: task.is_attention_check,
    attentionPass,
    timing: timing ?? {},
  });

  return NextResponse.json({ ok: true });
}
