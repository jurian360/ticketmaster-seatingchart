"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildGeometry, padBounds } from "@/lib/geometry";
import { detectAisleEvery, makeRows, resizeRows, rowLabel, setRowSeatCount } from "@/lib/rows";
import type { RowDef, Section, VenueLayout } from "@/lib/types";
import SeatMap from "./SeatMap";
import { usePanZoom } from "./usePanZoom";

const PALETTE = [
  "#2563eb",
  "#0f9d7a",
  "#b0327a",
  "#d97706",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
  "#65a30d",
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 py-1 text-xs text-slate-400">
      <span className="shrink-0">{label}</span>
      {children}
    </label>
  );
}

function Num({
  value,
  onChange,
  min,
  max,
  step = 1,
  width = "w-20",
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  width?: string;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (!Number.isNaN(n)) onChange(min != null || max != null ? clamp(n, min, max) : n);
      }}
      className={`${width} rounded border border-line bg-panel-2 px-2 py-1 text-right text-xs text-white outline-none focus:border-emerald-400`}
    />
  );
}

function clamp(n: number, min?: number, max?: number) {
  if (min != null) n = Math.max(min, n);
  if (max != null) n = Math.min(max, n);
  return n;
}

function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <span className="flex flex-1 items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-emerald-400"
      />
      <span className="w-10 text-right text-xs text-slate-300">{Math.round(value)}</span>
    </span>
  );
}

function Panel({
  title,
  children,
  open = false,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details open={open} className="border-b border-line">
      <summary className="cursor-pointer px-4 py-3 text-xs font-semibold tracking-wide text-slate-300 uppercase select-none hover:text-white">
        {title}
      </summary>
      <div className="px-4 pt-1 pb-4">{children}</div>
    </details>
  );
}

export default function Editor({ layout: initial }: { layout: VenueLayout }) {
  const [layout, setLayout] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(initial.sections[0]?.id ?? null);

  const geo = useMemo(() => buildGeometry(layout), [layout]);
  const pz = usePanZoom(geo.bounds);
  const active = layout.sections.find((s) => s.id === activeId) ?? null;
  const activeGeo = geo.sections.find((s) => s.section.id === activeId) ?? null;

  const edit = useCallback((fn: (draft: VenueLayout) => VenueLayout) => {
    setLayout((prev) => fn(prev));
    setDirty(true);
  }, []);

  const patchSection = useCallback(
    (id: string, patch: Partial<Section> | ((s: Section) => Partial<Section>)) =>
      edit((l) => ({
        ...l,
        sections: l.sections.map((s) =>
          s.id === id ? { ...s, ...(typeof patch === "function" ? patch(s) : patch) } : s,
        ),
      })),
    [edit],
  );

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/layouts/${layout.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(layout),
      });
      if (res.ok) {
        setDirty(false);
        setSavedAt(new Date().toLocaleTimeString());
      }
    } finally {
      setSaving(false);
    }
  }, [layout]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const addSection = (curved: boolean) => {
    const n = layout.sections.length + 1;
    const section: Section = {
      id: `sec-${Math.random().toString(36).slice(2, 8)}`,
      name: `Section ${n}`,
      color: PALETTE[layout.sections.length % PALETTE.length],
      price: 95,
      x: 0,
      y: 120 + layout.sections.length * 20,
      rotation: 0,
      curve: curved ? 24 : 0,
      seatSpacing: 15,
      rowSpacing: 18,
      rows: makeRows(8, 14, 0),
    };
    edit((l) => ({ ...l, sections: [...l.sections, section] }));
    setActiveId(section.id);
  };

  const duplicate = (id: string) => {
    const src = layout.sections.find((s) => s.id === id);
    if (!src) return;
    const copy: Section = {
      ...structuredClone(src),
      id: `sec-${Math.random().toString(36).slice(2, 8)}`,
      name: `${src.name} copy`,
      x: src.x + 80,
      y: src.y + 60,
    };
    edit((l) => ({ ...l, sections: [...l.sections, copy] }));
    setActiveId(copy.id);
  };

  const removeSection = (id: string) => {
    edit((l) => ({ ...l, sections: l.sections.filter((s) => s.id !== id) }));
    setActiveId((cur) => (cur === id ? null : cur));
  };

  const setInventory = (id: string, mode: "clear" | "random") =>
    patchSection(id, (s) => ({
      rows: s.rows.map((row) => ({
        ...row,
        seats: row.seats.map((seat) => ({
          ...seat,
          status:
            mode === "clear" ? ("available" as const) : Math.random() < 0.35 ? ("sold" as const) : ("available" as const),
        })),
      })),
    }));

  const grid = active
    ? {
        rows: active.rows.length,
        seats: active.rows[0]?.seats.length ?? 0,
        aisle: detectAisleEvery(active.rows[0]),
      }
    : null;

  const resize = (rows: number, seats: number, aisle: number) => {
    if (!active) return;
    patchSection(active.id, (s) => ({ rows: resizeRows(s.rows, rows, seats, aisle) }));
  };

  const patchRow = (index: number, patch: Partial<RowDef>) =>
    active &&
    patchSection(active.id, (s) => ({
      rows: s.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }));

  const totalSeats = geo.seats.length;
  const soldSeats = geo.seats.filter((s) => s.status !== "available").length;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-panel px-4 py-2.5">
        <Link href="/admin" className="text-sm text-slate-400 hover:text-white">
          ← Layouts
        </Link>
        <input
          value={layout.name}
          onChange={(e) => edit((l) => ({ ...l, name: e.target.value }))}
          className="w-56 rounded-md border border-transparent bg-transparent px-2 py-1 text-base font-semibold text-white outline-none hover:border-line focus:border-emerald-400"
        />
        <span className="text-xs text-slate-500">
          {layout.sections.length} sections · {totalSeats.toLocaleString()} seats · {soldSeats} sold
        </span>
        <div className="ml-auto flex items-center gap-2">
          {dirty ? (
            <span className="text-xs text-amber-400">Unsaved changes</span>
          ) : savedAt ? (
            <span className="text-xs text-slate-500">Saved {savedAt}</span>
          ) : null}
          <Link
            href={`/event/${layout.id}`}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-slate-300 hover:bg-panel-2 hover:text-white"
          >
            Preview as fan
          </Link>
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="rounded-md bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-400"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[340px] shrink-0 overflow-y-auto border-r border-line bg-panel">
          <Panel title="Event" open>
            <Row label="Event name">
              <input
                value={layout.eventName}
                onChange={(e) => edit((l) => ({ ...l, eventName: e.target.value }))}
                className="w-48 rounded border border-line bg-panel-2 px-2 py-1 text-xs text-white outline-none focus:border-emerald-400"
              />
            </Row>
            <Row label="Date & time">
              <input
                type="datetime-local"
                value={new Date(layout.eventDate).toISOString().slice(0, 16)}
                onChange={(e) =>
                  edit((l) => ({ ...l, eventDate: new Date(e.target.value).toISOString() }))
                }
                className="w-48 rounded border border-line bg-panel-2 px-2 py-1 text-xs text-white outline-none focus:border-emerald-400"
              />
            </Row>
          </Panel>

          <Panel title="Selling rules" open>
            <label className="flex items-start gap-2 py-1 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={layout.rules.enforceOrphanRule}
                onChange={(e) =>
                  edit((l) => ({
                    ...l,
                    rules: { ...l.rules, enforceOrphanRule: e.target.checked },
                  }))
                }
                className="mt-0.5 h-4 w-4 accent-emerald-400"
              />
              <span>
                <span className="font-semibold text-white">No single seats left behind</span>
                <br />
                <span className="text-slate-400">
                  Reject picks that strand a run shorter than the minimum below.
                </span>
              </span>
            </label>
            <Row label="Minimum seats left in a gap">
              <Num
                value={layout.rules.minLeftover}
                min={1}
                max={4}
                onChange={(n) => edit((l) => ({ ...l, rules: { ...l.rules, minLeftover: n } }))}
              />
            </Row>
            <Row label="Max tickets per order">
              <Num
                value={layout.rules.maxPerOrder}
                min={1}
                max={20}
                onChange={(n) => edit((l) => ({ ...l, rules: { ...l.rules, maxPerOrder: n } }))}
              />
            </Row>
          </Panel>

          <Panel title="Stage">
            <Row label="Label">
              <input
                value={layout.stage.label}
                onChange={(e) => edit((l) => ({ ...l, stage: { ...l.stage, label: e.target.value } }))}
                className="w-32 rounded border border-line bg-panel-2 px-2 py-1 text-xs text-white outline-none focus:border-emerald-400"
              />
            </Row>
            {(
              [
                ["X", "x", -2000, 2000],
                ["Y", "y", -2000, 2000],
                ["Width", "width", 20, 2000],
                ["Height", "height", 20, 2000],
                ["Rotation", "rotation", -180, 180],
              ] as const
            ).map(([label, key, min, max]) => (
              <Row key={key} label={label}>
                <Num
                  value={layout.stage[key]}
                  min={min}
                  max={max}
                  onChange={(n) => edit((l) => ({ ...l, stage: { ...l.stage, [key]: n } }))}
                />
              </Row>
            ))}
          </Panel>

          <Panel title={`Sections (${layout.sections.length})`} open>
            <div className="mb-2 flex gap-2">
              <button
                onClick={() => addSection(false)}
                className="flex-1 rounded border border-line bg-panel-2 py-1.5 text-xs text-slate-200 hover:border-emerald-400"
              >
                + Straight block
              </button>
              <button
                onClick={() => addSection(true)}
                className="flex-1 rounded border border-line bg-panel-2 py-1.5 text-xs text-slate-200 hover:border-emerald-400"
              >
                + Curved block
              </button>
            </div>
            <ul className="max-h-52 space-y-1 overflow-y-auto">
              {layout.sections.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => setActiveId(s.id)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
                      activeId === s.id ? "bg-panel-2 text-white" : "text-slate-400 hover:bg-panel-2"
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: s.color }}
                    />
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="text-slate-500">${s.price}</span>
                  </button>
                </li>
              ))}
              {layout.sections.length === 0 && (
                <li className="py-2 text-xs text-slate-500">
                  No sections yet — add a block to start.
                </li>
              )}
            </ul>
          </Panel>

          {active && grid && (
            <>
              <Panel title="Section properties" open>
                <Row label="Name">
                  <input
                    value={active.name}
                    onChange={(e) => patchSection(active.id, { name: e.target.value })}
                    className="w-40 rounded border border-line bg-panel-2 px-2 py-1 text-xs text-white outline-none focus:border-emerald-400"
                  />
                </Row>
                <Row label="Price ($)">
                  <Num
                    value={active.price}
                    min={0}
                    max={9999}
                    onChange={(n) => patchSection(active.id, { price: n })}
                  />
                </Row>
                <div className="flex flex-wrap gap-1.5 py-2">
                  {PALETTE.map((c) => (
                    <button
                      key={c}
                      onClick={() => patchSection(active.id, { color: c })}
                      className={`h-6 w-6 rounded-full border-2 ${
                        active.color === c ? "border-white" : "border-transparent"
                      }`}
                      style={{ background: c }}
                      aria-label={`Colour ${c}`}
                    />
                  ))}
                </div>
                <Row label="X">
                  <Num
                    value={active.x}
                    min={-4000}
                    max={4000}
                    onChange={(n) => patchSection(active.id, { x: n })}
                  />
                </Row>
                <Row label="Y">
                  <Num
                    value={active.y}
                    min={-4000}
                    max={4000}
                    onChange={(n) => patchSection(active.id, { y: n })}
                  />
                </Row>
                <Row label="Rotation">
                  <Slider
                    value={active.rotation}
                    min={-180}
                    max={180}
                    onChange={(n) => patchSection(active.id, { rotation: n })}
                  />
                </Row>
                <Row label="Curve">
                  <Slider
                    value={active.curve}
                    min={0}
                    max={90}
                    onChange={(n) => patchSection(active.id, { curve: n })}
                  />
                </Row>
                <Row label="Seat spacing">
                  <Slider
                    value={active.seatSpacing}
                    min={9}
                    max={32}
                    onChange={(n) => patchSection(active.id, { seatSpacing: n })}
                  />
                </Row>
                <Row label="Row spacing">
                  <Slider
                    value={active.rowSpacing}
                    min={10}
                    max={44}
                    onChange={(n) => patchSection(active.id, { rowSpacing: n })}
                  />
                </Row>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() =>
                      activeGeo && pz.fitTo(padBounds(activeGeo.bounds, 30), { maxZoom: 3.2 })
                    }
                    className="rounded border border-line bg-panel-2 py-1.5 text-xs text-slate-200 hover:border-emerald-400"
                  >
                    Zoom to section
                  </button>
                  <button
                    onClick={() => duplicate(active.id)}
                    className="rounded border border-line bg-panel-2 py-1.5 text-xs text-slate-200 hover:border-emerald-400"
                  >
                    Duplicate
                  </button>
                  <button
                    onClick={() => setInventory(active.id, "random")}
                    className="rounded border border-line bg-panel-2 py-1.5 text-xs text-slate-200 hover:border-emerald-400"
                  >
                    Randomise sold
                  </button>
                  <button
                    onClick={() => setInventory(active.id, "clear")}
                    className="rounded border border-line bg-panel-2 py-1.5 text-xs text-slate-200 hover:border-emerald-400"
                  >
                    Mark all free
                  </button>
                  <button
                    onClick={() => removeSection(active.id)}
                    className="col-span-2 rounded border border-line py-1.5 text-xs text-rose-400 hover:border-rose-500/60"
                  >
                    Delete section
                  </button>
                </div>
              </Panel>

              <Panel title="Rows & seats" open>
                <Row label="Rows">
                  <Num
                    value={grid.rows}
                    min={1}
                    max={40}
                    onChange={(n) => resize(n, grid.seats, grid.aisle)}
                  />
                </Row>
                <Row label="Seats per row">
                  <Num
                    value={grid.seats}
                    min={1}
                    max={60}
                    onChange={(n) => resize(grid.rows, n, grid.aisle)}
                  />
                </Row>
                <Row label="Aisle every N seats">
                  <Num
                    value={grid.aisle}
                    min={0}
                    max={40}
                    onChange={(n) => resize(grid.rows, grid.seats, n)}
                  />
                </Row>
                <p className="py-1 text-[11px] text-slate-500">
                  Aisles split a row, so the no-single-seat rule treats each side separately.
                </p>

                <div className="mt-2 max-h-64 overflow-y-auto rounded border border-line">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-panel-2 text-slate-400">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium">Row</th>
                        <th className="px-2 py-1 text-right font-medium">Seats</th>
                        <th className="px-2 py-1 text-right font-medium">Shift</th>
                        <th className="px-1 py-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.rows.map((row, i) => (
                        <tr key={i} className="border-t border-line">
                          <td className="px-2 py-1">
                            <input
                              value={row.label}
                              onChange={(e) => patchRow(i, { label: e.target.value })}
                              className="w-12 rounded border border-line bg-panel-2 px-1 py-0.5 text-white outline-none focus:border-emerald-400"
                            />
                          </td>
                          <td className="px-2 py-1 text-right">
                            <input
                              type="number"
                              min={1}
                              max={80}
                              value={row.seats.length}
                              onChange={(e) =>
                                patchRow(
                                  i,
                                  setRowSeatCount(
                                    row,
                                    clamp(Number(e.target.value) || 1, 1, 80),
                                    grid.aisle,
                                  ),
                                )
                              }
                              className="w-14 rounded border border-line bg-panel-2 px-1 py-0.5 text-right text-white outline-none focus:border-emerald-400"
                            />
                          </td>
                          <td className="px-2 py-1 text-right">
                            <input
                              type="number"
                              step={0.5}
                              value={row.offset}
                              onChange={(e) => patchRow(i, { offset: Number(e.target.value) || 0 })}
                              className="w-14 rounded border border-line bg-panel-2 px-1 py-0.5 text-right text-white outline-none focus:border-emerald-400"
                            />
                          </td>
                          <td className="px-1 py-1 text-right">
                            <button
                              onClick={() =>
                                patchSection(active.id, (s) => ({
                                  rows: s.rows.filter((_, j) => j !== i),
                                }))
                              }
                              className="text-slate-500 hover:text-rose-400"
                              aria-label={`Delete row ${row.label}`}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  onClick={() =>
                    patchSection(active.id, (s) => ({
                      rows: [
                        ...s.rows,
                        {
                          label: rowLabel(s.rows.length),
                          offset: 0,
                          seats: makeRows(1, s.rows[0]?.seats.length ?? 12, grid.aisle)[0].seats,
                        },
                      ],
                    }))
                  }
                  className="mt-2 w-full rounded border border-line bg-panel-2 py-1.5 text-xs text-slate-200 hover:border-emerald-400"
                >
                  + Add row
                </button>
              </Panel>
            </>
          )}
        </aside>

        <div className="relative min-w-0 flex-1">
          <SeatMap
            layout={layout}
            geo={geo}
            pz={pz}
            mode="edit"
            activeSectionId={activeId}
            onSectionClick={(sec) => setActiveId(sec.section.id)}
            onSectionDrag={(id, x, y) => patchSection(id, { x, y })}
            onSeatClick={(seat) =>
              patchSection(seat.sectionId, (s) => ({
                rows: s.rows.map((row) =>
                  row.label === seat.rowLabel
                    ? {
                        ...row,
                        seats: row.seats.map((st) =>
                          st.n === seat.n
                            ? { ...st, status: st.status === "available" ? "sold" : "available" }
                            : st,
                        ),
                      }
                    : row,
                ),
              }))
            }
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
              <div className="rounded-lg border border-line bg-panel/90 px-3 py-2 text-xs text-slate-400 backdrop-blur">
                Drag a section to move it · click to select · zoom in and click a seat to mark it
                sold
              </div>
              <div className="pointer-events-auto flex flex-col gap-1">
                <button
                  onClick={() => pz.zoomBy(1.5)}
                  className="h-8 w-8 rounded-md border border-line bg-panel/90 text-lg leading-none text-slate-300 hover:text-white"
                >
                  +
                </button>
                <button
                  onClick={() => pz.zoomBy(1 / 1.5)}
                  className="h-8 w-8 rounded-md border border-line bg-panel/90 text-lg leading-none text-slate-300 hover:text-white"
                >
                  −
                </button>
                <button
                  onClick={() => pz.fitTo(geo.bounds)}
                  className="h-8 w-8 rounded-md border border-line bg-panel/90 text-xs text-slate-300 hover:text-white"
                  title="Fit whole venue"
                >
                  ⤢
                </button>
              </div>
            </div>
          </SeatMap>
        </div>
      </div>
    </div>
  );
}
