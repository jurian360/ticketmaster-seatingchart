"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export interface LayoutSummary {
  id: string;
  name: string;
  eventName: string;
  eventDate: string;
  sections: number;
  seats: number;
  available: number;
  updatedAt: string;
}

export default function AdminList({ layouts }: { layouts: LayoutSummary[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);

  const refresh = () => start(() => router.refresh());

  const create = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/layouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "New venue" }),
      });
      const layout = await res.json();
      if (res.ok) router.push(`/admin/${layout.id}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, label: string) => {
    if (!confirm(`Delete "${label}" and all of its seats?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/layouts/${id}`, { method: "DELETE" });
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!confirm("Restore the two demo venues and discard every change?")) return;
    setBusy(true);
    try {
      await fetch("/api/layouts/reset", { method: "POST" });
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-emerald-400 uppercase">
            Admin
          </p>
          <h1 className="mt-1 text-3xl font-bold text-white">Venue layouts</h1>
          <p className="mt-2 text-sm text-slate-400">
            Build the seating chart fans will buy from: sections, rows, aisles, pricing and rules.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/"
            className="rounded-md border border-line px-4 py-2.5 text-sm text-slate-300 hover:bg-panel hover:text-white"
          >
            ← Store front
          </Link>
          <button
            onClick={reset}
            disabled={busy || pending}
            className="rounded-md border border-line px-4 py-2.5 text-sm text-slate-400 hover:bg-panel hover:text-white disabled:opacity-50"
          >
            Reset demo data
          </button>
        </div>
      </header>

      <div className="mt-8 flex flex-wrap gap-2 rounded-xl border border-line bg-panel p-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="New venue name, e.g. Riverside Amphitheatre"
          className="min-w-[16rem] flex-1 rounded-md border border-line bg-panel-2 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-400"
        />
        <button
          onClick={create}
          disabled={busy}
          className="rounded-md bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          Create venue
        </button>
      </div>

      <ul className="mt-4 space-y-3">
        {layouts.map((l) => (
          <li
            key={l.id}
            className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-panel p-5"
          >
            <div className="min-w-[14rem] flex-1">
              <h2 className="font-semibold text-white">{l.name}</h2>
              <p className="text-sm text-slate-400">{l.eventName}</p>
              <p className="mt-1 text-xs text-slate-500">
                {l.sections} sections · {l.seats.toLocaleString()} seats ·{" "}
                {l.available.toLocaleString()} available · updated{" "}
                {new Date(l.updatedAt).toLocaleString()}
              </p>
            </div>
            <div className="flex gap-2">
              <Link
                href={`/event/${l.id}`}
                className="rounded-md border border-line px-3 py-2 text-sm text-slate-300 hover:bg-panel-2 hover:text-white"
              >
                Preview
              </Link>
              <Link
                href={`/admin/${l.id}`}
                className="rounded-md bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-200"
              >
                Edit layout
              </Link>
              <button
                onClick={() => remove(l.id, l.name)}
                disabled={busy}
                className="rounded-md border border-line px-3 py-2 text-sm text-slate-400 hover:border-rose-500/50 hover:text-rose-400 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
