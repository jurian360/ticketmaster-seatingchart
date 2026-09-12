import { NextResponse } from "next/server";
import { buildGeometry } from "@/lib/geometry";
import { evaluateSelection } from "@/lib/rules";
import { getLayout, saveLayout } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The browser already enforces the no-single-seat rule while picking, but the
 * server is the only place that can be trusted — inventory may have moved.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const layout = await getLayout(id);
  if (!layout) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { seatIds } = (await req.json().catch(() => ({}))) as { seatIds?: string[] };
  if (!seatIds?.length) return NextResponse.json({ error: "No seats selected" }, { status: 400 });

  const geo = buildGeometry(layout);
  const seats = seatIds.map((sid) => geo.byId.get(sid));
  const missing = seatIds.filter((sid, i) => !seats[i]);
  if (missing.length) {
    return NextResponse.json({ error: `Unknown seats: ${missing.join(", ")}` }, { status: 400 });
  }

  const taken = seats.filter((s) => s!.status !== "available");
  if (taken.length) {
    return NextResponse.json(
      { error: `Someone just took ${taken.map((s) => `${s!.rowLabel}-${s!.n}`).join(", ")}.` },
      { status: 409 },
    );
  }
  if (seatIds.length > layout.rules.maxPerOrder) {
    return NextResponse.json(
      { error: `Maximum ${layout.rules.maxPerOrder} tickets per order.` },
      { status: 400 },
    );
  }

  const verdict = evaluateSelection(geo, new Set(seatIds), layout.rules);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.message, orphans: verdict.orphans.map((o) => o.id) }, { status: 422 });
  }

  const wanted = new Set(seatIds);
  for (const section of layout.sections) {
    for (const row of section.rows) {
      for (const seat of row.seats) {
        if (wanted.has(`${section.id}:${row.label}:${seat.n}`)) seat.status = "sold";
      }
    }
  }
  await saveLayout(layout);

  const total = seats.reduce((sum, s) => sum + s!.price, 0);
  return NextResponse.json({
    orderId: `ORD-${Date.now().toString(36).toUpperCase()}`,
    seats: seats.map((s) => ({
      id: s!.id,
      section: s!.sectionName,
      row: s!.rowLabel,
      seat: s!.n,
      price: s!.price,
    })),
    total,
  });
}
