import { NextResponse } from "next/server";
import { resetLayouts } from "@/lib/store";

export async function POST() {
  const layouts = await resetLayouts();
  return NextResponse.json({ ok: true, count: layouts.length });
}
