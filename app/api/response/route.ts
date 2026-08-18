import { NextResponse } from "next/server";
import { insertResponse, storageHint } from "@/lib/db";
import { componentsFor, getRawTask, roomsFor } from "@/lib/material";

/**
 * Record one labelled observation — both stages of it.
 *
 * The client sends the chosen hotel and room plus what it displayed and when;
 * the server re-derives the option set, the component feature vectors and the
 * room attributes from the frozen material, so the browser never sees (or can
 * tamper with) the features the label is attached to.
 *
 * Stage 1 is one ranking group: every candidate hotel, one labelled chosen,
 * each carrying its five components and the position it was shown at.
 * Recording position is what lets the labels be corrected for position bias
 * later — the list is distance-sorted, so rank and proximity are entangled in
 * the raw click.
 *
 * Stage 2 is a second, much smaller group: the 2-5 offers inside the chosen
 * hotel, one labelled chosen. Its attributes are observed rather than latent
 * (price in rupees, board basis, refundability, size, occupancy), which is what
 * lets the stage-1 weights be expressed on a monetary scale.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const {
    participantId,
    taskId,
    chosenHotelId,
    chosenRoomId,
    timing,
    positions,
    interactions,
  } = body ?? {};

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

  // Stage 2. A room id is expected but not demanded: if a client ever posts
  // without one the hotel-level observation is still complete and valid, and
  // discarding it would lose data we cannot collect again. An id that is
  // present but wrong is a different matter — that is a bug or tampering.
  const hotelRooms = roomsFor(chosenHotelId);
  const chosenRoom =
    typeof chosenRoomId === "string"
      ? hotelRooms.find((r) => r.id === chosenRoomId)
      : undefined;
  if (typeof chosenRoomId === "string" && !chosenRoom) {
    return NextResponse.json({ error: "chosen room not in hotel" }, { status: 400 });
  }

  const roomOptions = hotelRooms.map((r) => ({
    room_id: r.id,
    name: r.name,
    price_lkr: r.price_lkr,
    board_type: r.board_type,
    board_name: r.board_name,
    refundable: r.refundable,
    size_sqm: r.size_sqm,
    max_occupancy: r.max_occupancy,
    beds: r.beds,
    displayed_position: hotelRooms.indexOf(r) + 1,
    chosen: chosenRoom ? r.id === chosenRoom.id : false,
  }));

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
      chosenRoomId: chosenRoom?.id ?? null,
      room: chosenRoom ?? null,
      roomOptions,
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
