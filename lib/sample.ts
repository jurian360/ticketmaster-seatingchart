import { DEFAULT_RULES } from "./rules";
import { rowLabel } from "./rows";
import type { RowDef, SeatDef, Section, VenueLayout } from "./types";

/** Deterministic PRNG so the demo venue looks the same on every fresh start. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RowSpec {
  rows: number;
  seats: number;
  aisleEvery?: number;
  grow?: number;
  sold: number;
  rand: () => number;
}

function makeRows({ rows, seats, aisleEvery, grow = 0, sold, rand }: RowSpec): RowDef[] {
  return Array.from({ length: rows }, (_, r) => {
    const count = seats + Math.round(r * grow);
    const list: SeatDef[] = Array.from({ length: count }, (_, i) => {
      const seat: SeatDef = { n: i + 1, status: rand() < sold ? "sold" : "available" };
      if (aisleEvery && (i + 1) % aisleEvery === 0 && i + 1 < count) seat.aisleAfter = true;
      return seat;
    });
    // Guarantee a few teachable moments: rows where one more pick strands a seat.
    if (rand() < 0.3 && count > 6) {
      const at = 1 + Math.floor(rand() * (count - 4));
      list[at].status = "available";
      list[at + 1].status = "available";
      list[at + 2].status = "available";
      if (at - 1 >= 0) list[at - 1].status = "sold";
      if (at + 3 < count) list[at + 3].status = "sold";
    }
    return { label: rowLabel(r), offset: 0, seats: list };
  });
}

const deg = (rad: number) => (rad * 180) / Math.PI;

interface RingSpec {
  prefix: string;
  count: number;
  radius: number;
  from: number;
  to: number;
  rows: number;
  seats: number;
  price: number;
  color: string;
  rowSpacing: number;
  seatSpacing: number;
  sold: number;
  rand: () => number;
  startNumber: number;
}

function ring(spec: RingSpec): Section[] {
  const span = (spec.to - spec.from) / spec.count;
  return Array.from({ length: spec.count }, (_, i) => {
    const theta = spec.from + span * (i + 0.5);
    const x = spec.radius * Math.sin((theta * Math.PI) / 180);
    const y = -spec.radius * Math.cos((theta * Math.PI) / 180);
    const width = spec.seats * spec.seatSpacing;
    return {
      id: `${spec.prefix}${spec.startNumber + i}`,
      name: `${spec.startNumber + i}`,
      color: spec.color,
      price: spec.price,
      x,
      y,
      // Rotating by 180 + theta makes the section's front row face the stage.
      rotation: 180 + theta,
      curve: deg(width / spec.radius),
      seatSpacing: spec.seatSpacing,
      rowSpacing: spec.rowSpacing,
      rows: makeRows({
        rows: spec.rows,
        seats: spec.seats,
        aisleEvery: spec.seats > 16 ? Math.ceil(spec.seats / 2) : undefined,
        grow: 0,
        sold: spec.sold,
        rand: spec.rand,
      }),
    } satisfies Section;
  });
}

export function buildArenaLayout(id = "arena-demo"): VenueLayout {
  const rand = mulberry32(20260912);
  const floor: Section[] = [
    { key: "A", x: -150, y: -330, seats: 16, price: 395 },
    { key: "B", x: 0, y: -330, seats: 16, price: 425 },
    { key: "C", x: 150, y: -330, seats: 16, price: 395 },
    { key: "D", x: -150, y: -140, seats: 16, price: 310 },
    { key: "E", x: 0, y: -140, seats: 16, price: 330 },
    { key: "F", x: 150, y: -140, seats: 16, price: 310 },
    { key: "G", x: -150, y: 50, seats: 16, price: 245 },
    { key: "H", x: 0, y: 50, seats: 16, price: 265 },
    { key: "J", x: 150, y: 50, seats: 16, price: 245 },
  ].map(
    (f) =>
      ({
        id: `floor-${f.key}`,
        name: `Floor ${f.key}`,
        color: "#b0327a",
        price: f.price,
        x: f.x,
        y: f.y,
        rotation: 0,
        curve: 0,
        seatSpacing: 15,
        rowSpacing: 17,
        rows: makeRows({
          rows: 9,
          seats: f.seats,
          aisleEvery: 8,
          sold: 0.42,
          rand,
        }),
      }) satisfies Section,
  );

  const lower = ring({
    prefix: "sec-",
    count: 14,
    radius: 480,
    from: 34,
    to: 326,
    rows: 12,
    seats: 20,
    price: 189,
    color: "#2563eb",
    rowSpacing: 18,
    seatSpacing: 15,
    sold: 0.34,
    rand,
    startNumber: 101,
  });

  const upper = ring({
    prefix: "sec-",
    count: 18,
    radius: 780,
    from: 24,
    to: 336,
    rows: 14,
    seats: 22,
    price: 79,
    color: "#0f9d7a",
    rowSpacing: 19,
    seatSpacing: 15,
    sold: 0.28,
    rand,
    startNumber: 201,
  });

  return {
    id,
    name: "Skyline Arena",
    eventName: "Aurora Vale — The Longest Night Tour",
    eventDate: "2026-11-14T20:00:00.000Z",
    updatedAt: new Date(0).toISOString(),
    stage: { x: 0, y: -480, width: 400, height: 120, rotation: 0, label: "STAGE" },
    sections: [...floor, ...lower, ...upper],
    rules: { ...DEFAULT_RULES },
  };
}

export function buildTheatreLayout(id = "theatre-demo"): VenueLayout {
  const rand = mulberry32(7717);
  const mk = (
    key: string,
    name: string,
    x: number,
    y: number,
    rotation: number,
    rows: number,
    seats: number,
    price: number,
    color: string,
    curve: number,
  ): Section => ({
    id: key,
    name,
    color,
    price,
    x,
    y,
    rotation,
    curve,
    seatSpacing: 17,
    rowSpacing: 21,
    rows: makeRows({ rows, seats, aisleEvery: seats > 14 ? 10 : undefined, sold: 0.3, rand }),
  });

  return {
    id,
    name: "The Meridian Theatre",
    eventName: "A Night at the Meridian",
    eventDate: "2026-10-03T19:30:00.000Z",
    updatedAt: new Date(0).toISOString(),
    stage: { x: 0, y: -170, width: 360, height: 90, rotation: 0, label: "STAGE" },
    sections: [
      mk("orch-c", "Orchestra Centre", 0, -60, 0, 12, 20, 145, "#b0327a", 26),
      mk("orch-l", "Orchestra Left", -345, -10, 16, 10, 8, 110, "#2563eb", 14),
      mk("orch-r", "Orchestra Right", 345, -10, -16, 10, 8, 110, "#2563eb", 14),
      mk("mezz", "Mezzanine", 0, 360, 0, 8, 26, 95, "#0f9d7a", 30),
      mk("balc", "Balcony", 0, 640, 0, 6, 30, 55, "#d97706", 32),
    ],
    rules: { ...DEFAULT_RULES, maxPerOrder: 6 },
  };
}
