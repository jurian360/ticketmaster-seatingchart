import type { VenueGeometry } from "./geometry";
import { rowKey } from "./geometry";
import type { PositionedSeat, VenueRules } from "./types";

export const DEFAULT_RULES: VenueRules = {
  minLeftover: 2,
  maxPerOrder: 8,
  enforceOrphanRule: true,
};

const isFree = (seat: PositionedSeat, taken: ReadonlySet<string>) =>
  seat.status === "available" && !taken.has(seat.id);

/**
 * Orphans in one row: runs of still-buyable seats shorter than `minLeftover`,
 * bounded by sold/selected seats or by an aisle. A row is split at aisles
 * because seats either side of an aisle are not really "next to" each other.
 */
export function orphansInRow(
  rowSeats: readonly PositionedSeat[],
  taken: ReadonlySet<string>,
  minLeftover: number,
): PositionedSeat[] {
  const orphans: PositionedSeat[] = [];
  let run: PositionedSeat[] = [];

  const closeRun = () => {
    if (run.length > 0 && run.length < minLeftover) orphans.push(...run);
    run = [];
  };

  for (const seat of rowSeats) {
    if (isFree(seat, taken)) run.push(seat);
    else closeRun();
    if (seat.aisleAfter) closeRun();
  }
  closeRun();
  return orphans;
}

export interface RuleVerdict {
  ok: boolean;
  /** Seats that *this* selection would strand. */
  orphans: PositionedSeat[];
  message?: string;
}

const describe = (seat: PositionedSeat) =>
  `${seat.sectionName} row ${seat.rowLabel} seat ${seat.n}`;

const joinList = (parts: string[]) =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

/** "Mezzanine row G seats 11 and 12" — collapsed when they share a row. */
function seatList(seats: PositionedSeat[]) {
  if (!seats.length) return "";
  const first = seats[0];
  const sameRow = seats.every(
    (s) => s.sectionId === first.sectionId && s.rowLabel === first.rowLabel,
  );
  if (!sameRow) return joinList(seats.map(describe));
  const numbers = joinList(seats.map((s) => String(s.n)));
  return `${first.sectionName} row ${first.rowLabel} seat${seats.length > 1 ? "s" : ""} ${numbers}`;
}

function orphanMessage(orphans: PositionedSeat[]) {
  if (orphans.length === 1) return `That would leave ${describe(orphans[0])} stranded on its own.`;
  const rows = new Set(orphans.map((o) => `${o.sectionName} row ${o.rowLabel}`));
  const list = orphans.slice(0, 3).map((o) => `${o.rowLabel}-${o.n}`).join(", ");
  return `That would strand ${orphans.length} single seats (${list}${
    orphans.length > 3 ? ", …" : ""
  }) across ${rows.size} row${rows.size > 1 ? "s" : ""}.`;
}

/**
 * Validate a whole selection. Orphans that already existed before the user
 * touched anything (left behind by earlier orders) never block them — only
 * gaps *this* selection creates do.
 */
export function evaluateSelection(
  geo: VenueGeometry,
  selected: ReadonlySet<string>,
  rules: VenueRules,
): RuleVerdict {
  if (!rules.enforceOrphanRule || selected.size === 0) return { ok: true, orphans: [] };

  const touched = new Set<string>();
  for (const id of selected) {
    const seat = geo.byId.get(id);
    if (seat) touched.add(rowKey(seat.sectionId, seat.rowLabel));
  }

  const empty = new Set<string>();
  const orphans: PositionedSeat[] = [];
  for (const key of touched) {
    const row = geo.rows.get(key);
    if (!row) continue;
    const before = new Set(orphansInRow(row, empty, rules.minLeftover).map((s) => s.id));
    for (const seat of orphansInRow(row, selected, rules.minLeftover)) {
      if (!before.has(seat.id)) orphans.push(seat);
    }
  }

  return orphans.length
    ? { ok: false, orphans, message: orphanMessage(orphans) }
    : { ok: true, orphans: [] };
}

/** Would adding this seat to the current selection be allowed? */
/**
 * Seats that must join the order to make `selected` legal. An orphan can only
 * ever be cured by buying it, so this is the forced completion of a pick —
 * "you may have these seats, but then you have to take that one too".
 */
export function requiredCompanions(
  geo: VenueGeometry,
  selected: ReadonlySet<string>,
  rules: VenueRules,
): { added: PositionedSeat[]; total: number } {
  if (!rules.enforceOrphanRule) return { added: [], total: selected.size };
  const next = new Set(selected);
  const added: PositionedSeat[] = [];
  for (let pass = 0; pass < 8; pass++) {
    const verdict = evaluateSelection(geo, next, rules);
    if (verdict.ok) break;
    let grew = false;
    for (const orphan of verdict.orphans) {
      if (next.has(orphan.id)) continue;
      next.add(orphan.id);
      added.push(orphan);
      grew = true;
    }
    if (!grew) break;
  }
  return { added, total: next.size };
}

export interface SelectionPlan {
  ok: boolean;
  /** The selection to apply. Unchanged when `ok` is false. */
  seats: ReadonlySet<string>;
  /** Seats pulled in alongside the one that was clicked. */
  added: PositionedSeat[];
  /** Seats dropped alongside the one that was removed. */
  removed: PositionedSeat[];
  /** Seats that would be stranded, when the pick is refused. */
  orphans: PositionedSeat[];
  message?: string;
  tone: "info" | "error";
}

/**
 * Add a seat to the order.
 *
 * The rule is checked against the order the buyer is *heading for*, not against
 * the half-finished click. Picking seat 12 next to a sold seat 10 looks illegal
 * on its own — it strands seat 11 — but 11+12 together is fine, so the pick is
 * allowed and seat 11 comes with it. Only when that forced completion will not
 * fit the ticket count is the seat actually refused.
 */
export function planAddSeat(
  geo: VenueGeometry,
  selected: ReadonlySet<string>,
  seat: PositionedSeat,
  rules: VenueRules,
  wanted: number,
): SelectionPlan {
  const refuse = (message: string, orphans: PositionedSeat[] = []): SelectionPlan => ({
    ok: false,
    seats: selected,
    added: [],
    removed: [],
    orphans,
    message,
    tone: "error",
  });

  if (seat.status !== "available") return refuse(`${describe(seat)} is already sold.`);
  if (selected.size + 1 > rules.maxPerOrder) {
    return refuse(`You can buy at most ${rules.maxPerOrder} tickets in one order.`);
  }

  const next = new Set(selected);
  next.add(seat.id);
  const { added, total } = requiredCompanions(geo, next, rules);
  if (total > allowance(selected.size, wanted, rules)) {
    return refuse(
      total > rules.maxPerOrder
        ? `${describe(seat)} only works as part of ${total} tickets, over the ${rules.maxPerOrder}-ticket limit.`
        : `${describe(seat)} means taking ${seatList(added)} as well — ${total} tickets in all. Set the ticket count to ${total} and try again.`,
      added,
    );
  }

  for (const companion of added) next.add(companion.id);
  return {
    ok: true,
    seats: next,
    added,
    removed: [],
    orphans: [],
    message: added.length
      ? `Added ${seatList(added)} too — ${added.length > 1 ? "they" : "it"} cannot be left on ${
          added.length > 1 ? "their" : "its"
        } own.`
      : undefined,
    tone: "info",
  };
}

/**
 * Drop a seat from the order. Releasing a seat can strand its neighbour just as
 * taking one can, so anything left on its own is released too.
 */
export function planRemoveSeat(
  geo: VenueGeometry,
  selected: ReadonlySet<string>,
  seat: PositionedSeat,
  rules: VenueRules,
): SelectionPlan {
  const next = new Set(selected);
  next.delete(seat.id);
  const removed: PositionedSeat[] = [];

  if (rules.enforceOrphanRule) {
    for (let pass = 0; pass < 16; pass++) {
      const verdict = evaluateSelection(geo, next, rules);
      if (verdict.ok) break;
      let shrank = false;
      for (const orphan of verdict.orphans) {
        const neighbour = selectedNeighbour(geo, orphan, next);
        if (!neighbour) continue;
        next.delete(neighbour.id);
        removed.push(neighbour);
        shrank = true;
      }
      if (!shrank) break;
    }
  }

  return {
    ok: true,
    seats: next,
    added: [],
    removed,
    orphans: [],
    message: removed.length
      ? `Released ${seatList(removed)} as well, so no seat is left on its own.`
      : undefined,
    tone: "info",
  };
}

/** The still-selected seat bounding an orphan's run, which is what strands it. */
function selectedNeighbour(
  geo: VenueGeometry,
  orphan: PositionedSeat,
  selected: ReadonlySet<string>,
): PositionedSeat | null {
  const row = geo.rows.get(rowKey(orphan.sectionId, orphan.rowLabel));
  if (!row) return null;
  const at = row.findIndex((s) => s.id === orphan.id);
  if (at === -1) return null;

  for (let i = at - 1; i >= 0; i--) {
    if (row[i].aisleAfter) break; // different side of an aisle
    if (selected.has(row[i].id)) return row[i];
    if (row[i].status !== "available") break;
  }
  for (let i = at + 1; i < row.length; i++) {
    if (row[i - 1].aisleAfter) break;
    if (selected.has(row[i].id)) return row[i];
    if (row[i].status !== "available") break;
  }
  return null;
}

/** How many tickets this order may grow to on the next click. */
function allowance(selectedSize: number, wanted: number, rules: VenueRules) {
  return Math.min(rules.maxPerOrder, Math.max(wanted, selectedSize + 1));
}

/**
 * Seats the buyer cannot take right now, mapped to a short reason for the
 * tooltip. A seat is only blocked when no completion of it fits the order.
 */
export function blockedSeats(
  geo: VenueGeometry,
  selected: ReadonlySet<string>,
  rules: VenueRules,
  wanted: number,
): Map<string, string> {
  const blocked = new Map<string, string>();
  if (selected.size + 1 > rules.maxPerOrder) {
    for (const seat of geo.seats) {
      if (seat.status === "available" && !selected.has(seat.id)) {
        blocked.set(seat.id, `Order limit is ${rules.maxPerOrder} tickets`);
      }
    }
    return blocked;
  }
  if (!rules.enforceOrphanRule) return blocked;

  const cap = allowance(selected.size, wanted, rules);
  const empty = new Set<string>();
  // A seat only ever strands seats in its own row, and the live selection is
  // always kept legal, so the forced completion can be counted row by row.
  for (const [, row] of geo.rows) {
    const before = new Set(orphansInRow(row, empty, rules.minLeftover).map((s) => s.id));
    for (const seat of row) {
      if (seat.status !== "available" || selected.has(seat.id)) continue;
      const next = new Set(selected);
      next.add(seat.id);
      const forced = orphansInRow(row, next, rules.minLeftover).filter((s) => !before.has(s.id));
      const total = selected.size + 1 + forced.length;
      if (total > cap) blocked.set(seat.id, `Only works as ${total} tickets together`);
    }
  }
  return blocked;
}

export interface GroupSuggestion {
  seats: PositionedSeat[];
  score: number;
}

/**
 * "Best available": the closest-to-stage run of `qty` adjacent seats that does
 * not break the orphan rule.
 */
export function findBestGroup(
  geo: VenueGeometry,
  qty: number,
  rules: VenueRules,
  sectionId?: string,
): PositionedSeat[] | null {
  let best: GroupSuggestion | null = null;
  const empty = new Set<string>();

  for (const [, row] of geo.rows) {
    if (sectionId && row[0]?.sectionId !== sectionId) continue;
    const before = new Set(orphansInRow(row, empty, rules.minLeftover).map((s) => s.id));

    for (let start = 0; start + qty <= row.length; start++) {
      const run = row.slice(start, start + qty);
      if (run.some((s) => s.status !== "available")) continue;
      // No aisle may cut through the group (the last seat may sit on one).
      if (run.slice(0, -1).some((s) => s.aisleAfter)) continue;

      if (rules.enforceOrphanRule) {
        const taken = new Set(run.map((s) => s.id));
        const after = orphansInRow(row, taken, rules.minLeftover);
        if (after.some((s) => !before.has(s.id))) continue;
      }

      const centre = (row.length - 1) / 2;
      const offCentre =
        run.reduce((sum, s) => sum + Math.abs(s.index - centre), 0) / qty;
      const score = run[0].rowIndex * 6 + offCentre * 1.5 - run[0].price / 200;
      if (!best || score < best.score) best = { seats: run, score };
    }
  }
  return best ? best.seats : null;
}
