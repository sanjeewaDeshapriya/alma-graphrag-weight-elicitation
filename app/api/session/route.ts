import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createParticipant, updateDemographics } from "@/lib/db";
import { loadMaterial } from "@/lib/material";

/** Create a participant after consent. Returns the anonymous participant id. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!body?.consent) {
    return NextResponse.json({ error: "consent required" }, { status: 400 });
  }
  const id = randomUUID();
  const material = loadMaterial();
  await createParticipant({
    id,
    consent: true,
    materialVersion: material.version,
    userAgent: request.headers.get("user-agent") ?? "",
  });
  return NextResponse.json({ participantId: id, version: material.version });
}

/** Attach optional demographics to an existing participant. */
export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!body?.participantId) {
    return NextResponse.json({ error: "participantId required" }, { status: 400 });
  }
  await updateDemographics(body.participantId, body.demographics ?? {});
  return NextResponse.json({ ok: true });
}
