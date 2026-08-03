import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createParticipant, updateDemographics, storageHint } from "@/lib/db";
import { loadMaterial } from "@/lib/material";

/** Create a participant after consent. Returns the anonymous participant id. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!body?.consent) {
    return NextResponse.json({ error: "consent required" }, { status: 400 });
  }
  const id = randomUUID();
  const material = loadMaterial();
  try {
    await createParticipant({
      id,
      consent: true,
      materialVersion: material.version,
      userAgent: request.headers.get("user-agent") ?? "",
    });
  } catch (err) {
    console.error("createParticipant failed:", err);
    return NextResponse.json(
      { error: "storage_failed", hint: storageHint() },
      { status: 500 },
    );
  }
  return NextResponse.json({ participantId: id, version: material.version });
}

/** Attach optional demographics to an existing participant. */
export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!body?.participantId) {
    return NextResponse.json({ error: "participantId required" }, { status: 400 });
  }
  try {
    await updateDemographics(body.participantId, body.demographics ?? {});
  } catch (err) {
    console.error("updateDemographics failed:", err);
    return NextResponse.json(
      { error: "storage_failed", hint: storageHint() },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
