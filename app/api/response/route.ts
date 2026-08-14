import { NextResponse } from "next/server";
import { insertResponse, storageHint } from "@/lib/db";
import { componentsFor, getRawTask } from "@/lib/material";

/**
 * Record one labelled observation.
 *
 * The client sends the chosen hotel plus what it displayed and when; the server
 * re-derives the option set and the component feature vectors from the frozen
 * material, so the browser never sees (or can tamper with) the features the
 * label is attached to.
 *
 * Each stored row is one ranking group: 35 candidates, one of them labelled
 * chosen, each carrying its five components and the position it was shown at.
 * Recording position is what lets the labels be corrected for position bias
 * later — the list is distance-sorted, so rank and proximity are entangled in
 * the raw click.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { participantId, taskId, chosenHotelId, timing, positions, interactions } =
    body ?? {};

  if (!participantId || !taskId || !chosenHotelId) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const task = getRawTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "unknown task" }, { status: 400 });
  }
  if (!task.option_ids.includes(chosenHotelId)) {
    return NextResponse.json({ error: "chosen hotel not in task" }, { status: 400 });
  }

  const attentionPass = task.is_attention_check
    ? chosenHotelId === task.attention_answer_hotel_id
    : null;

  // position map is advisory (the client reports what it rendered); fall back to
  // null so a malformed payload cannot drop the observation.
  const posMap: Record<string, number> =
    positions && typeof positions === "object" ? positions : {};

  const options = task.option_ids.map((id) => ({
    hotel_id: id,
    components: componentsFor(id, task.anchor_id) ?? null,
    displayed_position: typeof posMap[id] === "number" ? posMap[id] : null,
    chosen: id === chosenHotelId,
  }));

  try {
    await insertResponse({
      participantId,
      taskId,
      scenarioId: task.id,
      anchorId: task.anchor_id,
      primaryDimension: task.primary_dimension ?? null,
      secondaryDimension: task.secondary_dimension ?? null,
      repeatOf: task.repeat_of ?? null,
      chosenHotelId,
      options,
      isAttentionCheck: task.is_attention_check,
      attentionPass,
      timing: timing ?? {},
      interactions: Array.isArray(interactions) ? interactions : [],
    });
  } catch (err) {
    console.error("insertResponse failed:", err);
    return NextResponse.json(
      { error: "storage_failed", hint: storageHint() },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
