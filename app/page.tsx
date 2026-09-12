import Link from "next/link";
import { buildGeometry } from "@/lib/geometry";
import { listLayouts } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const layouts = await listLayouts();
  const events = layouts.map((l) => {
    const geo = buildGeometry(l);
    const available = geo.seats.filter((s) => s.status === "available").length;
    const prices = l.sections.map((s) => s.price);
    return {
      id: l.id,
      name: l.name,
      eventName: l.eventName,
      eventDate: l.eventDate,
      sections: l.sections.length,
      seats: geo.seats.length,
      available,
      from: prices.length ? Math.min(...prices) : 0,
    };
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-emerald-400 uppercase">
            SeatPick
          </p>
          <h1 className="mt-1 text-3xl font-bold text-white">Tonight&apos;s events</h1>
          <p className="mt-2 max-w-xl text-sm text-slate-400">
            An interactive seating chart demo. Zoom into a section, pick your seats, and watch the
            no-single-seat rule stop you from stranding a lonely seat between sold ones.
          </p>
        </div>
        <Link
          href="/admin"
          className="rounded-md border border-line bg-panel px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-panel-2 hover:text-white"
        >
          Admin dashboard →
        </Link>
      </header>

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        {events.map((e) => (
          <Link
            key={e.id}
            href={`/event/${e.id}`}
            className="group rounded-xl border border-line bg-panel p-5 transition hover:border-emerald-400/60 hover:bg-panel-2"
          >
            <p className="text-xs text-slate-400">
              {new Date(e.eventDate).toLocaleString(undefined, {
                dateStyle: "full",
                timeStyle: "short",
              })}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-white group-hover:text-emerald-300">
              {e.eventName}
            </h2>
            <p className="text-sm text-slate-400">{e.name}</p>
            <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs text-slate-400">
              <div>
                <dt>Sections</dt>
                <dd className="text-sm font-medium text-slate-200">{e.sections}</dd>
              </div>
              <div>
                <dt>Available</dt>
                <dd className="text-sm font-medium text-slate-200">
                  {e.available.toLocaleString()} / {e.seats.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt>From</dt>
                <dd className="text-sm font-medium text-slate-200">${e.from}</dd>
              </div>
            </dl>
          </Link>
        ))}
      </section>

      {events.length === 0 && (
        <p className="mt-10 text-sm text-slate-400">
          No venues yet — head to the{" "}
          <Link href="/admin" className="text-emerald-400 underline">
            admin dashboard
          </Link>{" "}
          to build one.
        </p>
      )}
    </main>
  );
}
