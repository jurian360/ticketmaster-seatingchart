import { NextResponse } from "next/server";
import { deleteLayout, getLayout, saveLayout } from "@/lib/store";
import type { VenueLayout } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const layout = await getLayout(id);
  if (!layout) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(layout);
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json()) as VenueLayout;
  if (!body || typeof body !== "object" || !Array.isArray(body.sections)) {
    return NextResponse.json({ error: "Invalid layout" }, { status: 400 });
  }
  const saved = await saveLayout({ ...body, id });
  return NextResponse.json(saved);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await deleteLayout(id);
  return NextResponse.json({ ok: true });
}
