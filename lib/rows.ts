import type { RowDef, SeatDef, SeatStatus } from "./types";

/** Row letters, skipping I and O the way real venues do. */
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export function rowLabel(i: number) {
  if (i < LETTERS.length) return LETTERS[i];
  const first = Math.floor(i / LETTERS.length) - 1;
  return LETTERS[first] + LETTERS[i % LETTERS.length];
}

export function makeSeats(count: number, aisleEvery = 0): SeatDef[] {
  return Array.from({ length: count }, (_, i) => {
    const seat: SeatDef = { n: i + 1, status: "available" };
    if (aisleEvery > 0 && (i + 1) % aisleEvery === 0 && i + 1 < count) seat.aisleAfter = true;
    return seat;
  });
}

export function makeRows(rowCount: number, seatCount: number, aisleEvery = 0): RowDef[] {
  return Array.from({ length: rowCount }, (_, r) => ({
    label: rowLabel(r),
    offset: 0,
    seats: makeSeats(seatCount, aisleEvery),
  }));
}

/**
 * Resize a section's grid while keeping whatever has already been sold, so an
 * admin can tweak a layout without wiping the inventory.
 */
export function resizeRows(
  rows: RowDef[],
  rowCount: number,
  seatCount: number,
  aisleEvery: number,
): RowDef[] {
  const statuses = new Map<string, SeatStatus>();
  rows.forEach((row) => row.seats.forEach((s) => statuses.set(`${row.label}:${s.n}`, s.status)));

  return Array.from({ length: rowCount }, (_, r) => {
    const label = rows[r]?.label ?? rowLabel(r);
    return {
      label,
      offset: rows[r]?.offset ?? 0,
      seats: makeSeats(seatCount, aisleEvery).map((seat) => ({
        ...seat,
        status: statuses.get(`${label}:${seat.n}`) ?? "available",
      })),
    };
  });
}

export function setRowSeatCount(row: RowDef, count: number, aisleEvery: number): RowDef {
  const statuses = new Map(row.seats.map((s) => [s.n, s.status]));
  return {
    ...row,
    seats: makeSeats(count, aisleEvery).map((seat) => ({
      ...seat,
      status: statuses.get(seat.n) ?? "available",
    })),
  };
}

/** Aisle spacing currently applied to a row, or 0 when it has no aisles. */
export function detectAisleEvery(row: RowDef | undefined) {
  if (!row) return 0;
  const first = row.seats.findIndex((s) => s.aisleAfter);
  return first === -1 ? 0 : first + 1;
}
