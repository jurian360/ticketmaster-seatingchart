import { NextResponse } from "next/server";
import { emptyLayout, listLayouts, saveLayout } from "@/lib/store";

export async function GET() {
  const layouts = await listLayouts();
  return NextResponse.json(
    layouts.map((l) => ({
      id: l.id,
      name: l.name,
      eventName: l.eventName,
      eventDate: l.eventDate,
      updatedAt: l.updatedAt,
      sections: l.sections.length,
    })),
  );
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = body.name?.trim() || "New venue";
  const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const layout = await saveLayout(emptyLayout(id, name));
  return NextResponse.json(layout, { status: 201 });
}
