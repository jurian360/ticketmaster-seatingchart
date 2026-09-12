"use client";

import { useMemo, useRef, useState } from "react";
import type { SectionGeometry } from "@/lib/geometry";
import type { VenueGeometry } from "@/lib/geometry";
import { pointsToPath, seatRadius, stageCorners } from "@/lib/geometry";
import type { Bounds, PositionedSeat, VenueLayout } from "@/lib/types";
import { intersects, type PanZoom } from "./usePanZoom";

const SOLD = "#333a45";
const SELECTED = "#34d399";

export interface SeatMapProps {
  layout: VenueLayout;
  geo: VenueGeometry;
  pz: PanZoom;
  mode?: "view" | "edit";
  selected?: ReadonlySet<string>;
  /** Seat id -> why it cannot be picked right now. */
  blocked?: ReadonlyMap<string, string>;
  flagged?: ReadonlySet<string>;
  activeSectionId?: string | null;
  /** Fade everything except the active section, the way a focused view reads. */
  dimOthers?: boolean;
  onSeatClick?: (seat: PositionedSeat) => void;
  onSectionClick?: (section: SectionGeometry) => void;
  onSectionDrag?: (id: string, x: number, y: number) => void;
  children?: React.ReactNode;
}

const EMPTY: ReadonlySet<string> = new Set();
const NO_BLOCKS: ReadonlyMap<string, string> = new Map();

export default function SeatMap({
  layout,
  geo,
  pz,
  mode = "view",
  selected = EMPTY,
  blocked = NO_BLOCKS,
  flagged = EMPTY,
  activeSectionId = null,
  dimOthers = false,
  onSeatClick,
  onSectionClick,
  onSectionDrag,
  children,
}: SeatMapProps) {
  const { view, size, attach, transform, panning } = pz;
  const [hoverSeat, setHoverSeat] = useState<PositionedSeat | null>(null);
  const [hoverSection, setHoverSection] = useState<SectionGeometry | null>(null);
  const drag = useRef<{ id: string; ox: number; oy: number } | null>(null);

  const visible: Bounds = useMemo(
    () => ({
      minX: -view.x / view.k,
      minY: -view.y / view.k,
      maxX: (size.w - view.x) / view.k,
      maxY: (size.h - view.y) / view.k,
    }),
    [view, size],
  );

  const stagePath = useMemo(() => pointsToPath(stageCorners(layout)), [layout]);
  const toScreen = (x: number, y: number) => ({ x: x * view.k + view.x, y: y * view.k + view.y });

  const startDrag = (e: React.PointerEvent, sec: SectionGeometry) => {
    if (mode !== "edit" || !onSectionDrag) return;
    const p = pz.toWorld(e.clientX, e.clientY);
    drag.current = { id: sec.section.id, ox: p.x - sec.section.x, oy: p.y - sec.section.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const moveDrag = (e: React.PointerEvent) => {
    if (!drag.current || !onSectionDrag) return;
    const p = pz.toWorld(e.clientX, e.clientY);
    onSectionDrag(
      drag.current.id,
      Math.round(p.x - drag.current.ox),
      Math.round(p.y - drag.current.oy),
    );
  };

  const endDrag = () => {
    drag.current = null;
  };

  const tooltip = (() => {
    if (hoverSeat) {
      const p = toScreen(hoverSeat.x, hoverSeat.y);
      const unavailable = hoverSeat.status !== "available";
      return {
        left: p.x,
        top: p.y - 12,
        title: `${hoverSeat.sectionName} / Row ${hoverSeat.rowLabel} / Seat ${hoverSeat.n}`,
        sub: unavailable
          ? "Sold"
          : (blocked.get(hoverSeat.id) ?? `$${hoverSeat.price}`),
        bad: unavailable || blocked.has(hoverSeat.id),
      };
    }
    if (hoverSection) {
      const p = toScreen(hoverSection.centre.x, hoverSection.centre.y);
      return {
        left: p.x,
        top: p.y - 10,
        title: hoverSection.section.name,
        sub: `${hoverSection.available} available · from $${hoverSection.section.price}`,
        bad: hoverSection.available === 0,
      };
    }
    return null;
  })();

  return (
    <div
      ref={attach}
      className="relative h-full w-full touch-none overflow-hidden bg-[#0a0c10] select-none"
      style={{ cursor: panning ? "grabbing" : "grab" }}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
    >
      <svg width={size.w} height={size.h} className="block">
        <defs>
          <radialGradient id="venueGlow" cx="50%" cy="22%" r="78%">
            <stop offset="0%" stopColor="#1b2231" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#0a0c10" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={size.w} height={size.h} fill="url(#venueGlow)" />

        <g transform={transform}>
          <path d={stagePath} fill="#1b2130" stroke="#3b465c" strokeWidth={2 / view.k} />
          <text
            x={layout.stage.x}
            y={layout.stage.y}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#8b97ad"
            pointerEvents="none"
            style={{ fontSize: Math.min(46, 22 / view.k), letterSpacing: 4 / view.k }}
          >
            {layout.stage.label}
          </text>

          {geo.sections.map((sec) => {
            if (!intersects(sec.bounds, visible)) return null;
            const s = sec.section;
            const detail = view.k * s.seatSpacing >= 7.5;
            const isActive = activeSectionId === s.id;
            const dim = dimOthers && !!activeSectionId && !isActive;
            const radius = seatRadius(s);

            if (!detail) {
              const soldOut = sec.available === 0;
              // Shrink the label until it fits the shape, so "Floor A" does not
              // spill out of a narrow block.
              const width = sec.bounds.maxX - sec.bounds.minX;
              const label = Math.min(30, 13 / view.k, (width * 1.5) / Math.max(1, s.name.length));
              return (
                <g key={s.id} opacity={dim ? 0.3 : 1} pointerEvents={dim ? "none" : undefined}>
                  <path
                    d={sec.path}
                    data-nopan={mode === "edit" ? "" : undefined}
                    fill={soldOut ? "#20242c" : s.color}
                    fillOpacity={hoverSection?.section.id === s.id ? 1 : 0.82}
                    stroke={isActive ? "#ffffff" : soldOut ? "#2b3038" : "#0a0c10"}
                    strokeWidth={(isActive ? 3 : 1.5) / view.k}
                    style={{ cursor: mode === "edit" ? "move" : "pointer" }}
                    onPointerDown={(e) => startDrag(e, sec)}
                    onPointerEnter={() => setHoverSection(sec)}
                    onPointerLeave={() =>
                      setHoverSection((h) => (h?.section.id === s.id ? null : h))
                    }
                    onClick={() => {
                      if (!pz.panning) onSectionClick?.(sec);
                    }}
                  />
                  {label * view.k >= 5 && (
                    <text
                      x={sec.centre.x}
                      y={sec.centre.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#0a0c10"
                      pointerEvents="none"
                      style={{ fontSize: label, fontWeight: 700 }}
                    >
                      {s.name}
                    </text>
                  )}
                </g>
              );
            }

            return (
              <g key={s.id} opacity={dim ? 0.3 : 1} pointerEvents={dim ? "none" : undefined}>
                {sec.seats.map((seat) => {
                  const isSel = selected.has(seat.id);
                  const isSold = seat.status !== "available";
                  const isBlocked = !isSel && !isSold && blocked.has(seat.id);
                  const isFlagged = flagged.has(seat.id);
                  const stroke = isFlagged
                    ? "#fb7185"
                    : isSel
                      ? "#ecfdf5"
                      : hoverSeat?.id === seat.id
                        ? "#ffffff"
                        : "transparent";
                  return (
                    <circle
                      key={seat.id}
                      data-seat={seat.id}
                      cx={seat.x}
                      cy={seat.y}
                      r={radius}
                      fill={isSel ? SELECTED : isSold ? SOLD : s.color}
                      fillOpacity={isBlocked ? 0.26 : 1}
                      stroke={stroke}
                      strokeWidth={(isFlagged ? 2.6 : 1.6) / view.k}
                      style={{ cursor: isSold ? "not-allowed" : "pointer" }}
                      onPointerEnter={() => setHoverSeat(seat)}
                      onPointerLeave={() => setHoverSeat((h) => (h?.id === seat.id ? null : h))}
                      onClick={() => {
                        if (!pz.panning) onSeatClick?.(seat);
                      }}
                    />
                  );
                })}

                {view.k * s.seatSpacing >= 13 &&
                  s.rows.map((row, i) => {
                    const first = sec.seats.find((st) => st.rowIndex === i && st.index === 0);
                    if (!first) return null;
                    const angle = (s.rotation * Math.PI) / 180;
                    return (
                      <text
                        key={row.label}
                        x={first.x - Math.cos(angle) * s.seatSpacing * 1.15}
                        y={first.y - Math.sin(angle) * s.seatSpacing * 1.15}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="#6b7688"
                        pointerEvents="none"
                        style={{ fontSize: 9 / view.k }}
                      >
                        {row.label}
                      </text>
                    );
                  })}

                <text
                  x={(sec.bounds.minX + sec.bounds.maxX) / 2}
                  y={sec.bounds.minY - 14 / view.k}
                  textAnchor="middle"
                  fill="#94a3b8"
                  pointerEvents="none"
                  style={{ fontSize: 13 / view.k, fontWeight: 600 }}
                >
                  {s.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-md border border-white/10 bg-[#11151d]/95 px-2.5 py-1.5 text-xs shadow-xl backdrop-blur"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          <div className="font-semibold whitespace-nowrap text-white">{tooltip.title}</div>
          <div className={tooltip.bad ? "text-rose-400" : "text-emerald-400"}>{tooltip.sub}</div>
        </div>
      )}

      {children}
    </div>
  );
}
