"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildGeometry, padBounds, type SectionGeometry } from "@/lib/geometry";
import { blockedSeats, findBestGroup, planAddSeat, planRemoveSeat } from "@/lib/rules";
import type { PositionedSeat, VenueLayout } from "@/lib/types";
import SeatMap from "./SeatMap";
import { usePanZoom } from "./usePanZoom";

interface OrderSeat {
  id: string;
  section: string;
  row: string;
  seat: number;
  price: number;
}
interface Order {
  orderId: string;
  seats: OrderSeat[];
  total: number;
}

const money = (n: number) => `$${n.toFixed(2)}`;

export default function EventClient({ layout: initial }: { layout: VenueLayout }) {
  const [layout, setLayout] = useState(initial);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [qty, setQty] = useState(2);
  const [enforce, setEnforce] = useState(layout.rules.enforceOrphanRule);
  const [focused, setFocused] = useState<SectionGeometry | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string; tone: "info" | "error" } | null>(
    null,
  );
  const [flagged, setFlagged] = useState<ReadonlySet<string>>(new Set());
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const geo = useMemo(() => buildGeometry(layout), [layout]);
  const rules = useMemo(
    () => ({ ...layout.rules, enforceOrphanRule: enforce }),
    [layout.rules, enforce],
  );
  const pz = usePanZoom(geo.bounds);
  const blocked = useMemo(
    () => blockedSeats(geo, selected, rules, qty),
    [geo, selected, rules, qty],
  );

  useEffect(() => {
    const list = timers.current;
    return () => list.forEach(clearTimeout);
  }, []);

  const flash = useCallback(
    (text: string, tone: "info" | "error" = "error", orphans: PositionedSeat[] = []) => {
    setToast({ id: Date.now(), text, tone });
    setFlagged(new Set(orphans.map((o) => o.id)));
      timers.current.push(
        setTimeout(() => setFlagged(new Set()), 2200),
        setTimeout(() => setToast((t) => (t && Date.now() - t.id >= 3400 ? null : t)), 3500),
      );
    },
    [],
  );

  const selectedSeats = useMemo(
    () =>
      [...selected]
        .map((id) => geo.byId.get(id))
        .filter((s): s is PositionedSeat => !!s)
        .sort(
          (a, b) =>
            a.sectionName.localeCompare(b.sectionName) ||
            a.rowLabel.localeCompare(b.rowLabel) ||
            a.n - b.n,
        ),
    [selected, geo],
  );
  const total = selectedSeats.reduce((sum, s) => sum + s.price, 0);
  const fees = total * 0.18;

  const zoomToSection = useCallback(
    (sec: SectionGeometry) => {
      setFocused(sec);
      pz.fitTo(padBounds(sec.bounds, 30), { maxZoom: 3.2 });
    },
    [pz],
  );

  const resetView = useCallback(() => {
    setFocused(null);
    pz.fitTo(geo.bounds);
  }, [pz, geo.bounds]);

  const toggleSeat = useCallback(
    (seat: PositionedSeat) => {
      const plan = selected.has(seat.id)
        ? planRemoveSeat(geo, selected, seat, rules)
        : planAddSeat(geo, selected, seat, rules, qty);
      if (plan.ok) setSelected(plan.seats);
      if (plan.message) flash(plan.message, plan.tone, plan.orphans);
    },
    [geo, selected, rules, qty, flash],
  );

  const pickBest = useCallback(() => {
    const group = findBestGroup(geo, qty, rules, focused?.section.id);
    if (!group) {
      flash(
        focused
          ? `No run of ${qty} seats in ${focused.section.name} works without stranding a seat.`
          : `No run of ${qty} adjacent seats is available under the current rules.`,
      );
      return;
    }
    setSelected(new Set(group.map((s) => s.id)));
    const sec = geo.sections.find((s) => s.section.id === group[0].sectionId);
    if (sec) zoomToSection(sec);
  }, [geo, qty, rules, focused, flash, zoomToSection]);

  const checkout = useCallback(async () => {
    if (!selected.size) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/layouts/${layout.id}/purchase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seatIds: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok) {
        flash(data.error ?? "Checkout failed.");
        return;
      }
      setOrder(data as Order);
      setLayout((prev) => ({
        ...prev,
        sections: prev.sections.map((section) => ({
          ...section,
          rows: section.rows.map((row) => ({
            ...row,
            seats: row.seats.map((seat) =>
              selected.has(`${section.id}:${row.label}:${seat.n}`)
                ? { ...seat, status: "sold" as const }
                : seat,
            ),
          })),
        })),
      }));
      setSelected(new Set());
    } catch {
      flash("Could not reach the box office. Try again.");
    } finally {
      setBusy(false);
    }
  }, [selected, layout.id, flash]);

  const tiers = useMemo(() => {
    const map = new Map<string, { color: string; price: number; available: number }>();
    for (const sec of geo.sections) {
      const key = `${sec.section.color}:${sec.section.price}`;
      const entry = map.get(key) ?? {
        color: sec.section.color,
        price: sec.section.price,
        available: 0,
      };
      entry.available += sec.available;
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.price - a.price);
  }, [geo]);

  const available = geo.seats.filter((s) => s.status === "available").length;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-panel px-4 py-3">
        <Link href="/" className="text-sm text-slate-400 hover:text-white">
          ← Events
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-white">{layout.eventName}</h1>
          <p className="truncate text-xs text-slate-400">
            {layout.name} ·{" "}
            {new Date(layout.eventDate).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          <span className="hidden sm:inline">{available.toLocaleString()} seats available</span>
          <Link
            href={`/admin/${layout.id}`}
            className="rounded-md border border-line px-2.5 py-1.5 hover:bg-panel-2 hover:text-white"
          >
            Edit layout
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-[45vh] flex-1">
          <SeatMap
            layout={layout}
            geo={geo}
            pz={pz}
            selected={selected}
            blocked={blocked}
            flagged={flagged}
            activeSectionId={focused?.section.id ?? null}
            dimOthers
            onSeatClick={toggleSeat}
            onSectionClick={zoomToSection}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
              <div className="pointer-events-auto rounded-lg border border-line bg-panel/90 px-3 py-2 text-xs backdrop-blur">
                {focused ? (
                  <button onClick={resetView} className="text-slate-300 hover:text-white">
                    <span className="text-slate-500">Venue / </span>
                    <span className="font-semibold text-white">{focused.section.name}</span>
                    <span className="ml-2 text-slate-500">(back to full venue)</span>
                  </button>
                ) : (
                  <span className="text-slate-400">
                    Click a section to zoom in · scroll to zoom · drag to pan
                  </span>
                )}
              </div>
              <div className="pointer-events-auto flex flex-col gap-1">
                <button
                  onClick={() => pz.zoomBy(1.5)}
                  className="h-8 w-8 rounded-md border border-line bg-panel/90 text-lg leading-none text-slate-300 backdrop-blur hover:text-white"
                  aria-label="Zoom in"
                >
                  +
                </button>
                <button
                  onClick={() => pz.zoomBy(1 / 1.5)}
                  className="h-8 w-8 rounded-md border border-line bg-panel/90 text-lg leading-none text-slate-300 backdrop-blur hover:text-white"
                  aria-label="Zoom out"
                >
                  −
                </button>
                <button
                  onClick={resetView}
                  className="h-8 w-8 rounded-md border border-line bg-panel/90 text-xs text-slate-300 backdrop-blur hover:text-white"
                  aria-label="Fit venue"
                  title="Fit whole venue"
                >
                  ⤢
                </button>
              </div>
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-2 p-3">
              <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel/90 px-3 py-2 text-[11px] text-slate-300 backdrop-blur">
                {tiers.map((t) => (
                  <span key={`${t.color}${t.price}`} className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: t.color }}
                    />
                    {money(t.price)}
                  </span>
                ))}
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> Selected
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#333a45]" /> Sold
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-blue-500/25" /> Blocked by rule
                </span>
              </div>
            </div>

            {toast && (
              <div
                key={toast.id}
                className={`pointer-events-none absolute bottom-20 left-1/2 z-30 w-[min(30rem,90%)] -translate-x-1/2 rounded-lg border px-4 py-2.5 text-sm shadow-xl backdrop-blur ${
                  toast.tone === "error"
                    ? "animate-shake border-rose-500/40 bg-rose-950/90 text-rose-100"
                    : "animate-rise border-emerald-500/40 bg-emerald-950/90 text-emerald-100"
                }`}
              >
                {toast.text}
              </div>
            )}
          </SeatMap>
        </div>

        <aside className="flex w-full shrink-0 flex-col border-t border-line bg-panel lg:w-[360px] lg:border-t-0 lg:border-l">
          <div className="border-b border-line p-4">
            <label className="text-xs font-medium tracking-wide text-slate-400 uppercase">
              How many tickets?
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Array.from({ length: Math.min(8, layout.rules.maxPerOrder) }, (_, i) => i + 1).map(
                (n) => (
                  <button
                    key={n}
                    onClick={() => setQty(n)}
                    className={`h-9 w-9 rounded-md border text-sm transition ${
                      qty === n
                        ? "border-emerald-400 bg-emerald-400 font-semibold text-slate-900"
                        : "border-line bg-panel-2 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {n}
                  </button>
                ),
              )}
            </div>
            <button
              onClick={pickBest}
              className="mt-3 w-full rounded-md bg-white/95 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-white"
            >
              Find best {qty} together{focused ? ` in ${focused.section.name}` : ""}
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h2 className="text-sm font-semibold text-white">
                Your seats {selectedSeats.length > 0 && `(${selectedSeats.length})`}
              </h2>
              {selectedSeats.length > 0 && (
                <button
                  onClick={() => setSelected(new Set())}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="min-h-[4.5rem] flex-1 overflow-y-auto px-4">
              {selectedSeats.length === 0 ? (
                <p className="py-2 text-sm text-slate-500">
                  Nothing picked yet. Zoom into a section and tap a seat, or use{" "}
                  <span className="text-slate-300">Find best</span>.
                </p>
              ) : (
                <ul className="space-y-1.5 pb-2">
                  {selectedSeats.map((seat) => (
                    <li
                      key={seat.id}
                      className="animate-rise flex items-center gap-3 rounded-md border border-line bg-panel-2 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-white">
                          {seat.sectionName}
                        </span>
                        <span className="text-xs text-slate-400">
                          Row {seat.rowLabel} · Seat {seat.n}
                        </span>
                      </span>
                      <span className="text-sm text-slate-200">{money(seat.price)}</span>
                      <button
                        onClick={() => toggleSeat(seat)}
                        className="text-slate-500 hover:text-rose-400"
                        aria-label={`Remove seat ${seat.n}`}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="border-t border-line p-4">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-line bg-panel-2 p-3">
              <input
                type="checkbox"
                checked={enforce}
                onChange={(e) => setEnforce(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-emerald-400"
              />
              <span className="text-xs leading-relaxed text-slate-300">
                <span className="font-semibold text-white">No single seats left behind</span>
                <br />
                No order may leave a run of fewer than {layout.rules.minLeftover} empty seats between
                sold seats or aisles. A seat that would strand its neighbour is still yours if you
                take the neighbour too and it fits your ticket count — we add it for you. Turn the
                rule off to see the difference.
              </span>
            </label>

            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between text-slate-400">
                <dt>Tickets</dt>
                <dd>{money(total)}</dd>
              </div>
              <div className="flex justify-between text-slate-400">
                <dt>Fees &amp; taxes</dt>
                <dd>{money(fees)}</dd>
              </div>
              <div className="flex justify-between border-t border-line pt-1 font-semibold text-white">
                <dt>Total</dt>
                <dd>{money(total + fees)}</dd>
              </div>
            </dl>

            <button
              onClick={checkout}
              disabled={!selectedSeats.length || busy}
              className="mt-3 w-full rounded-md bg-emerald-500 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {busy ? "Reserving…" : `Checkout${selectedSeats.length ? ` · ${money(total + fees)}` : ""}`}
            </button>
          </div>
        </aside>
      </div>

      {order && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
          <div className="animate-rise w-full max-w-md rounded-xl border border-line bg-panel p-6">
            <h2 className="text-lg font-semibold text-white">You&apos;re going 🎟️</h2>
            <p className="mt-1 text-sm text-slate-400">
              Order {order.orderId} · {layout.eventName}
            </p>
            <ul className="mt-4 space-y-1.5">
              {order.seats.map((s) => (
                <li
                  key={s.id}
                  className="flex justify-between rounded-md bg-panel-2 px-3 py-2 text-sm"
                >
                  <span>
                    {s.section} · Row {s.row} · Seat {s.seat}
                  </span>
                  <span className="text-slate-300">{money(s.price)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-between border-t border-line pt-3 font-semibold text-white">
              <span>Paid</span>
              <span>{money(order.total * 1.18)}</span>
            </div>
            <button
              onClick={() => setOrder(null)}
              className="mt-5 w-full rounded-md bg-white py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-200"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
