# SeatPick — Ticketmaster-style seating chart (MVP)

An interactive seating chart demo: an admin dashboard for building venue layouts, and a fan-facing
ticket picker with pan/zoom, section drill-down, and a rule that refuses any selection which would
strand a single seat.

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # 32 assertions covering the no-single-seat rule
npm run build
```

Two demo venues are seeded on first run: **Skyline Arena** (38 sections, ~10k seats) and
**The Meridian Theatre** (5 sections). `Reset demo data` in the admin dashboard restores them.

## Stack

| Choice | Why |
| --- | --- |
| Next.js 16 (App Router) + React 19 | Required. Server components load layouts, route handlers own the writes. |
| TypeScript | The geometry and rule code is the part worth type-checking. |
| Tailwind v4 | No component library — the UI is small and bespoke. |
| Inline SVG + a custom pan/zoom hook | ~10k seats render fine as SVG, stay crisp at any zoom, and every seat is a real DOM node that can be hit-tested, hovered and focused. No canvas, no map library. |
| JSON file store (`.seatmap-data/`) | Zero-setup persistence for a demo. Swap `lib/store.ts` for a real database without touching anything else. |

## The no-single-seat rule

Lives in [lib/rules.ts](lib/rules.ts) and is the core of the demo.

A **row** is split into segments at aisles, because seats either side of an aisle are not really
adjacent. Within a segment, any maximal run of still-buyable seats shorter than `minLeftover`
(default 2) is an **orphan**. A selection is rejected when it creates an orphan that did not already
exist.

That last clause matters: rows already contain orphans left behind by earlier orders, and those must
never block the next buyer. So the check is always a diff — orphans *after* the selection minus
orphans *before* it.

```
row:  1  2  3  4  5  6  7  8  9  10      . free   x sold   ✓ picked

pick seat 2            →  rejected, seat 1 would sit alone
pick seats 3..10       →  fine, seats 1-2 remain as a pair
x . . . x  pick 2,3    →  rejected, seat 4 would sit alone
x . . . x  pick 2,3,4  →  fine, the gap is filled exactly
. . . . . | . . . . .  pick 1..4 → rejected, seat 5 is alone against the aisle
. x . . . . . . .      pick 5,6  → fine, seat 1 was already orphaned before this order
```

### Judge the order, not the click

The subtle part: the rule applies to the order the buyer ends up with, **not** to each half-finished
click on the way there. Enforcing it click by click makes legal orders unreachable:

```
row:   10  11  12  13  14  15  16          10 sold, 13+14 already held, buyer wants 4
       x   .   .   ✓   ✓   .   .

click 12  ->  on its own this strands seat 11 ... but 11+12+13+14 is a perfectly legal order
```

So instead of asking *"is this click legal?"*, the code asks *"can this click still become a legal
order?"*. Since an orphan can only ever be cured by buying it, the answer is cheap to compute:
`requiredCompanions` walks the orphans a selection creates and pulls them in until the selection is
legal. That closure is the **forced completion** of the pick.

- If the forced completion fits the ticket count, the pick is allowed and the companions come with
  it — *"Added row G seat 14 too — it cannot be left on its own."*
- If it does not fit, the seat is refused, and the message says what would make it work — *"seat 15
  means taking seat 14 as well — 4 tickets in all. Set the ticket count to 4 and try again."*

Releasing seats needs the same treatment, because dropping a seat can strand its neighbour just as
taking one can. `planRemoveSeat` releases whatever is left alone along with it.

### Where it is applied

- **`blockedSeats`** greys out only the seats that *no* order of this size could reach, and maps each
  to a reason for the tooltip ("Only works as 4 tickets together"). Change the ticket count and the
  greyed-out seats change with it.
- **`planAddSeat` / `planRemoveSeat`** run on click and return the whole resulting selection, the
  seats that came along, and the explanation.
- **`evaluateSelection` on the server** re-checks the finished order at checkout in
  [app/api/layouts/[id]/purchase/route.ts](app/api/layouts/[id]/purchase/route.ts). The browser is
  never the authority; inventory may have moved since the page loaded.

`findBestGroup` uses the same predicate for *Find best N together*, so a suggestion can never be
something the rule would reject.

Admins can tune `minLeftover` and `maxPerOrder` per venue, or switch the rule off. The fan view also
has a demo toggle so you can watch the blocked seats light up and go away.

## Layout model and geometry

Seat coordinates are never stored — only the parameters that generate them
([lib/geometry.ts](lib/geometry.ts)):

- A **section** has a position, rotation, seat/row spacing and a `curve` in degrees. `curve: 0` is a
  straight block; anything else lays the rows out as concentric arcs whose centre sits on the stage
  side, which is what makes an arena bowl look like an arena bowl.
- A **row** is a list of seats with an optional `offset` (to stagger rows) and `aisleAfter` flags.
- `buildGeometry` turns a layout into positioned seats, per-section outline polygons, a row index for
  the rule, and overall bounds.

Because positions are derived, dragging a section or dragging the *curve* slider re-lays out
thousands of seats instantly, and the stored JSON stays small.

## Zoom behaviour

[components/usePanZoom.ts](components/usePanZoom.ts) is a small wheel/drag/pinch controller with an
animated `fitTo(bounds)`. [components/SeatMap.tsx](components/SeatMap.tsx) renders with
level-of-detail: below ~7.5 px per seat a section draws as a single coloured polygon with its name;
above that it draws individual seats with row labels. Sections outside the viewport are culled, and
when a section is focused the rest of the venue dims out.

One non-obvious detail worth keeping: the pan controller only calls `setPointerCapture` *after* the
pointer has actually moved. Capturing on `pointerdown` retargets the follow-up `click` to the
container, and seats silently stop being clickable.

## Admin dashboard

`/admin` lists venues; `/admin/[id]` is the editor.

- Add straight or curved blocks; drag them on the canvas; fine-tune X/Y, rotation, curve and spacing
  with sliders and watch the map update live.
- Set rows, seats per row and "aisle every N seats" for the whole section, or edit rows individually
  (label, seat count, horizontal shift). Resizing preserves which seats are already sold.
- Zoom in and click any seat to toggle it sold — the quickest way to set up a scenario and then check
  it in the fan view.
- Per-venue pricing, colours, stage box, and the selling rules.
- `Ctrl/Cmd+S` saves. Unsaved changes are flagged in the header.

## Layout of the code

```
app/
  page.tsx                         event list
  event/[id]/page.tsx              fan-facing picker  -> components/EventClient.tsx
  admin/page.tsx                   venue list         -> components/AdminList.tsx
  admin/[id]/page.tsx              layout editor      -> components/Editor.tsx
  api/layouts/...                  CRUD, purchase, reset-demo-data
components/
  SeatMap.tsx                      shared renderer (view + edit modes)
  usePanZoom.ts                    wheel / drag / pinch / fit-to-bounds
lib/
  types.ts  geometry.ts  rules.ts  rows.ts  sample.ts  store.ts
tests/rules.test.js                the rule, in table form
```

## Deploying

It runs on Vercel (or any Node host) with no configuration. One thing to know before you show it to
anyone: **where the inventory lives**.

`lib/store.ts` keeps the venues in a JSON file. Serverless bundles are read-only apart from the temp
directory, so the store picks its location at runtime:

| Environment | Inventory lives in |
| --- | --- |
| Local `npm run dev` | `.seatmap-data/` in the project |
| Vercel / Lambda | `os.tmpdir()`, i.e. `/tmp/.seatmap-data` |
| Nothing writable | Memory, for the lifetime of that server instance |
| `SEATMAP_DATA_DIR` set | That directory — point it at a mounted volume on a VPS or in Docker |

On serverless that means seats sold in one request may not be visible to the next: every instance has
its own `/tmp`, and a cold start begins again from the seeded venues. Fine for a demo someone clicks
through; not fine for anything real.

To make it durable, replace the two private functions in [lib/store.ts](lib/store.ts) — the file read
in `listLayouts` and `writeAll` — with a database (Vercel Postgres, Vercel KV, Upstash, whatever you
already run). Nothing else in the app touches storage: the rest of the code only ever calls
`listLayouts`, `getLayout`, `saveLayout` and `deleteLayout`. A real deployment also wants the seat
holds described below, which belong in the same layer.

## What an MVP leaves out

- No auth — the admin dashboard is open, and orders are anonymous.
- No seat holds or expiry: checkout marks seats sold immediately. A real system needs a time-limited
  reservation, and the rule should then treat held seats as taken.
- Writes are last-write-wins against a JSON file; there is no transaction around concurrent orders
  beyond the availability re-check in the purchase route. See **Deploying** for what that means once
  more than one server instance is running.
- No payment, no ticket delivery, no accessible-seating or companion-seat rules (which in a real
  venue interact with the orphan rule).
- Keyboard navigation of the map itself is not implemented; everything else is standard focusable
  controls.
