import type { Bounds, PositionedSeat, RowDef, Section, VenueLayout } from "./types";

export const seatId = (sectionId: string, rowLabel: string, n: number) =>
  `${sectionId}:${rowLabel}:${n}`;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Seat-unit x for a seat index within a row (0 is the row's centre). */
function seatUnit(row: RowDef, index: number) {
  return index - (row.seats.length - 1) / 2 + row.offset;
}

function maxRowWidth(section: Section) {
  const widest = section.rows.reduce((m, r) => Math.max(m, r.seats.length), 1);
  return widest * section.seatSpacing;
}

/**
 * Local-space position inside a section.
 * `u` is a (possibly fractional) seat-unit offset from the row centre and
 * `radial` pushes the point away from the stage in px — both let us trace
 * an outline that hugs the seats without duplicating the maths.
 */
function localPos(section: Section, rowIndex: number, u: number, radial = 0) {
  const back = rowIndex * section.rowSpacing + radial;
  if (section.curve <= 0.01) {
    return { x: u * section.seatSpacing, y: back };
  }
  // Rows are concentric arcs; the arc centre sits on the stage side of row 0.
  const r0 = maxRowWidth(section) / rad(section.curve);
  const angle = (u * section.seatSpacing) / r0;
  const r = r0 + back;
  return { x: r * Math.sin(angle), y: -r0 + r * Math.cos(angle) };
}

function toVenue(section: Section, p: { x: number; y: number }) {
  const a = rad(section.rotation);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return {
    x: section.x + p.x * cos - p.y * sin,
    y: section.y + p.x * sin + p.y * cos,
  };
}

export function layoutSection(section: Section): PositionedSeat[] {
  const out: PositionedSeat[] = [];
  section.rows.forEach((row, rowIndex) => {
    row.seats.forEach((seat, index) => {
      const p = toVenue(section, localPos(section, rowIndex, seatUnit(row, index)));
      out.push({
        id: seatId(section.id, row.label, seat.n),
        sectionId: section.id,
        sectionName: section.name,
        rowLabel: row.label,
        rowIndex,
        index,
        n: seat.n,
        status: seat.status,
        price: section.price,
        x: p.x,
        y: p.y,
        aisleAfter: !!seat.aisleAfter,
      });
    });
  });
  return out;
}

export const seatRadius = (section: Section) => section.seatSpacing * 0.36;

/** Polygon hugging the seats, used as the zoomed-out representation. */
export function sectionOutline(section: Section): { x: number; y: number }[] {
  if (!section.rows.length) return [];
  const pad = seatRadius(section) + section.seatSpacing * 0.22;
  const padU = pad / section.seatSpacing;
  const last = section.rows.length - 1;
  const pts: { x: number; y: number }[] = [];
  const push = (rowIndex: number, u: number, radial: number) =>
    pts.push(toVenue(section, localPos(section, rowIndex, u, radial)));

  const left = (r: RowDef) => seatUnit(r, 0) - padU;
  const right = (r: RowDef) => seatUnit(r, r.seats.length - 1) + padU;

  // front edge, left to right
  const front = section.rows[0];
  const steps = Math.max(2, Math.min(24, front.seats.length));
  for (let i = 0; i <= steps; i++) {
    push(0, left(front) + ((right(front) - left(front)) * i) / steps, -pad);
  }
  // right edge, front to back
  section.rows.forEach((r, i) => push(i, right(r), 0));
  // back edge, right to left
  const back = section.rows[last];
  for (let i = 0; i <= steps; i++) {
    push(last, right(back) - ((right(back) - left(back)) * i) / steps, pad);
  }
  // left edge, back to front
  for (let i = last; i >= 0; i--) push(i, left(section.rows[i]), 0);
  return pts;
}

export function pointsToPath(pts: { x: number; y: number }[]) {
  if (!pts.length) return "";
  return `M ${pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" L ")} Z`;
}

export function boundsOf(pts: { x: number; y: number }[]): Bounds {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    b.minX = Math.min(b.minX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x);
    b.maxY = Math.max(b.maxY, p.y);
  }
  if (!pts.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return b;
}

export function padBounds(b: Bounds, pad: number): Bounds {
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

export function mergeBounds(list: Bounds[]): Bounds {
  return boundsOf(
    list.flatMap((b) => [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.maxY },
    ]),
  );
}

export function stageCorners(layout: VenueLayout) {
  const s = layout.stage;
  const a = rad(s.rotation);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const hw = s.width / 2;
  const hh = s.height / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => ({ x: s.x + x * cos - y * sin, y: s.y + x * sin + y * cos }));
}

export interface SectionGeometry {
  section: Section;
  seats: PositionedSeat[];
  outline: { x: number; y: number }[];
  path: string;
  bounds: Bounds;
  centre: { x: number; y: number };
  available: number;
}

export interface VenueGeometry {
  sections: SectionGeometry[];
  seats: PositionedSeat[];
  byId: Map<string, PositionedSeat>;
  /** Seats of one row, in seating order — the unit the orphan rule works on. */
  rows: Map<string, PositionedSeat[]>;
  bounds: Bounds;
}

export const rowKey = (sectionId: string, rowLabel: string) => `${sectionId}:${rowLabel}`;

export function buildGeometry(layout: VenueLayout): VenueGeometry {
  const sections: SectionGeometry[] = layout.sections.map((section) => {
    const seats = layoutSection(section);
    const outline = sectionOutline(section);
    const bounds = boundsOf(outline.length ? outline : seats);
    return {
      section,
      seats,
      outline,
      path: pointsToPath(outline),
      bounds,
      centre: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
      available: seats.filter((s) => s.status === "available").length,
    };
  });

  const seats = sections.flatMap((s) => s.seats);
  const byId = new Map(seats.map((s) => [s.id, s]));
  const rows = new Map<string, PositionedSeat[]>();
  for (const seat of seats) {
    const key = rowKey(seat.sectionId, seat.rowLabel);
    const list = rows.get(key);
    if (list) list.push(seat);
    else rows.set(key, [seat]);
  }
  for (const list of rows.values()) list.sort((a, b) => a.index - b.index);

  const bounds = mergeBounds([
    ...sections.map((s) => s.bounds),
    boundsOf(stageCorners(layout)),
  ]);
  return { sections, seats, byId, rows, bounds };
}
