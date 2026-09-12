const assert = require("assert");
const { buildGeometry } = require("../.test-build/geometry");
const {
  evaluateSelection,
  blockedSeats,
  findBestGroup,
  orphansInRow,
  planAddSeat,
  planRemoveSeat,
  requiredCompanions,
} = require("../.test-build/rules");

const RULES = { minLeftover: 2, maxPerOrder: 8, enforceOrphanRule: true };

/** One section, one row of `spec` — "." free, "x" sold, "|" aisle after. */
function layoutFrom(spec) {
  const seats = [];
  let n = 0;
  for (const ch of spec) {
    if (ch === "|") {
      seats[seats.length - 1].aisleAfter = true;
      continue;
    }
    n += 1;
    seats.push({ n, status: ch === "x" ? "sold" : "available" });
  }
  return {
    id: "t",
    name: "Test",
    eventName: "e",
    eventDate: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stage: { x: 0, y: -100, width: 10, height: 10, rotation: 0, label: "S" },
    rules: RULES,
    sections: [
      {
        id: "S",
        name: "S",
        color: "#fff",
        price: 10,
        x: 0,
        y: 0,
        rotation: 0,
        curve: 0,
        seatSpacing: 10,
        rowSpacing: 10,
        rows: [{ label: "A", offset: 0, seats }],
      },
    ],
  };
}

const ids = (ns) => new Set(ns.map((n) => `S:A:${n}`));
const nums = (set) => [...set].map((id) => Number(id.split(":")[2])).sort((a, b) => a - b);
const seatOf = (geo, n) => geo.byId.get(`S:A:${n}`);
const ok = (spec, picks) => evaluateSelection(buildGeometry(layoutFrom(spec)), ids(picks), RULES).ok;

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log("  ok  " + name);
}

console.log("\nthe rule itself");

check("a pair at the end of an open row is fine", () => assert.equal(ok("..........", [1, 2]), true));
check("seat 2 alone would strand seat 1", () => assert.equal(ok("..........", [2]), false));
check("seats 2-3 would strand seat 1", () => assert.equal(ok("..........", [2, 3]), false));
check("seat 9 alone would strand seat 10", () => assert.equal(ok("..........", [9]), false));
check("taking 3..10 leaves a healthy pair", () =>
  assert.equal(ok("..........", [3, 4, 5, 6, 7, 8, 9, 10]), true));
check("taking the whole row is fine", () =>
  assert.equal(ok("..........", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), true));

check("a gap of exactly one next to sold seats is rejected", () =>
  assert.equal(ok("x...x", [2, 3]), false));
check("filling the whole gap is fine", () => assert.equal(ok("x...x", [2, 3, 4]), true));
check("leaving a pair inside a gap is fine", () => assert.equal(ok("x....x", [2, 3]), true));

check("an aisle splits the row", () => assert.equal(ok(".....|.....", [1, 2, 3, 4]), false));
check("a pick that ends on the aisle is fine", () =>
  assert.equal(ok(".....|.....", [1, 2, 3, 4, 5]), true));

check("a pre-existing lone seat never blocks the buyer", () =>
  assert.equal(ok(".x.......", [5, 6]), true));
check("but the buyer may not create a second one", () =>
  assert.equal(ok(".x.......", [4, 5, 6]), false));

check("rule off means anything goes", () => {
  const geo = buildGeometry(layoutFrom(".........."));
  assert.equal(evaluateSelection(geo, ids([2]), { ...RULES, enforceOrphanRule: false }).ok, true);
});

check("orphansInRow reports every stranded seat", () => {
  const geo = buildGeometry(layoutFrom(".x....x."));
  const orphans = orphansInRow(geo.rows.get("S:A"), new Set(), 2);
  assert.deepEqual(
    orphans.map((o) => o.n),
    [1, 8],
  );
});

check("minLeftover of 3 rejects a leftover pair", () => {
  const geo = buildGeometry(layoutFrom("x.....x"));
  const strict = { ...RULES, minLeftover: 3 };
  assert.equal(evaluateSelection(geo, ids([2, 3, 4]), strict).ok, false);
  assert.equal(evaluateSelection(geo, ids([2, 3]), strict).ok, true);
});

console.log("\nreaching a legal order (the rule must not block the way there)");

check("the seat a buyer must also take is worked out", () => {
  // holding seats 2,3,4 in an open row leaves seat 1 on its own at the end
  const geo = buildGeometry(layoutFrom("......"));
  const { added, total } = requiredCompanions(geo, ids([2, 3, 4]), RULES);
  assert.deepEqual(
    added.map((s) => s.n),
    [1],
  );
  assert.equal(total, 4);
});

check("a 4-seat block is reachable one click at a time", () => {
  // The reported bug: seats 13,14 held, seat 10 sold, buyer wants 4.
  // Clicking 12 looks illegal alone (strands 11) but 11..14 is a legal order.
  const geo = buildGeometry(layoutFrom(".........x......")); // seat 10 sold
  const plan = planAddSeat(geo, ids([13, 14]), seatOf(geo, 12), RULES, 4);
  assert.equal(plan.ok, true);
  assert.deepEqual(nums(plan.seats), [11, 12, 13, 14]);
  assert.deepEqual(
    plan.added.map((s) => s.n),
    [11],
  );
  assert.match(plan.message, /row A seat 11/);
  assert.equal(evaluateSelection(geo, plan.seats, RULES).ok, true);
});

check("and that seat is not greyed out on the map", () => {
  const geo = buildGeometry(layoutFrom(".........x......"));
  const blocked = blockedSeats(geo, ids([13, 14]), RULES, 4);
  assert.equal(blocked.has("S:A:12"), false);
  assert.equal(blocked.has("S:A:11"), false);
});

check("wanting only 2 tickets does block it, with a reason", () => {
  const geo = buildGeometry(layoutFrom(".........x......"));
  const plan = planAddSeat(geo, ids([13, 14]), seatOf(geo, 12), RULES, 2);
  assert.equal(plan.ok, false);
  assert.match(plan.message, /4 tickets in all/);
  assert.deepEqual(nums(plan.seats), [13, 14], "a refused pick changes nothing");
  assert.equal(blockedSeats(geo, ids([13, 14]), RULES, 2).get("S:A:12"), "Only works as 4 tickets together");
});

check("a single click can pull in more than one companion", () => {
  // . . . x : clicking seat 2 strands both seat 1 and seat 3
  const geo = buildGeometry(layoutFrom("...x"));
  const plan = planAddSeat(geo, new Set(), seatOf(geo, 2), RULES, 3);
  assert.equal(plan.ok, true);
  assert.deepEqual(nums(plan.seats), [1, 2, 3]);
});

check("the order limit still wins over a forced completion", () => {
  const geo = buildGeometry(layoutFrom("...x"));
  const plan = planAddSeat(geo, new Set(), seatOf(geo, 2), { ...RULES, maxPerOrder: 2 }, 2);
  assert.equal(plan.ok, false);
  assert.match(plan.message, /over the 2-ticket limit/);
});

check("a sold seat is still refused", () => {
  const geo = buildGeometry(layoutFrom("..x..."));
  const plan = planAddSeat(geo, new Set(), seatOf(geo, 3), RULES, 4);
  assert.equal(plan.ok, false);
  assert.match(plan.message, /already sold/);
});

check("picking one more seat than wanted is allowed when nothing is stranded", () => {
  const geo = buildGeometry(layoutFrom(".........."));
  const plan = planAddSeat(geo, ids([1, 2]), seatOf(geo, 3), RULES, 2);
  assert.equal(plan.ok, true);
  assert.deepEqual(nums(plan.seats), [1, 2, 3]);
});

console.log("\ngiving seats back");

check("releasing a seat releases whatever it would strand", () => {
  // seat 10 sold, holding 11..14: dropping 11 would leave 11 alone, so 12 goes too
  const geo = buildGeometry(layoutFrom(".........x......"));
  const plan = planRemoveSeat(geo, ids([11, 12, 13, 14]), seatOf(geo, 11), RULES);
  assert.deepEqual(nums(plan.seats), [13, 14]);
  assert.deepEqual(
    plan.removed.map((s) => s.n),
    [12],
  );
  assert.equal(evaluateSelection(geo, plan.seats, RULES).ok, true);
});

check("releasing from the middle of a block strands nobody", () => {
  const geo = buildGeometry(layoutFrom(".........."));
  const plan = planRemoveSeat(geo, ids([5, 6, 7, 8]), seatOf(geo, 8), RULES);
  assert.deepEqual(nums(plan.seats), [5, 6, 7]);
  assert.equal(plan.removed.length, 0);
});

check("giving back a seat that was already an orphan keeps it an orphan", () => {
  // seat 2 is boxed in by sold seats; buying then releasing it changes nothing else
  const geo = buildGeometry(layoutFrom("x.x......."));
  const plan = planRemoveSeat(geo, ids([2]), seatOf(geo, 2), RULES);
  assert.deepEqual(nums(plan.seats), []);
  assert.equal(plan.removed.length, 0);
});

console.log("\nthe map overlay and best-available");

check("blocked set marks the seats no order can reach", () => {
  // wanting 1 ticket, seat 2 can never work: it always strands seat 1
  const geo = buildGeometry(layoutFrom(".........."));
  const blocked = blockedSeats(geo, new Set(), RULES, 1);
  assert.deepEqual([...blocked.keys()].sort(), ["S:A:2", "S:A:9"]);
});

check("wanting 2 tickets unlocks those same seats", () => {
  const geo = buildGeometry(layoutFrom(".........."));
  assert.equal(blockedSeats(geo, new Set(), RULES, 2).size, 0);
});

check("a full order greys out everything else", () => {
  const geo = buildGeometry(layoutFrom(".........."));
  const blocked = blockedSeats(geo, ids([1, 2, 3, 4, 5, 6, 7, 8]), RULES, 8);
  assert.equal(blocked.get("S:A:9"), "Order limit is 8 tickets");
});

check("best available never returns a rule-breaking group", () => {
  const geo = buildGeometry(layoutFrom("x..x....x...."));
  const group = findBestGroup(geo, 2, RULES);
  assert.ok(group, "expected a suggestion");
  assert.equal(evaluateSelection(geo, new Set(group.map((s) => s.id)), RULES).ok, true);
});

check("best available refuses when nothing fits", () => {
  const geo = buildGeometry(layoutFrom("x.x.x.x."));
  assert.equal(findBestGroup(geo, 2, RULES), null);
});

console.log(`\n${passed} assertions passed`);
