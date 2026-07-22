// Deterministic checks for income slot grouping + planning. No DB, no DAL.
// Run: npx tsx scripts/verify-income-slots.ts

import {
  incomeSlotGroupKey,
  incomeSlotGroupLabel,
  buildSlotGroups,
  planSlotAssignments,
  type SlotTemplate,
} from "@/lib/income-slots";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` :: ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

// Group keys
check("Natasha 1 ≡ Natasha 2", incomeSlotGroupKey("Natasha 1") === incomeSlotGroupKey("Natasha 2"));
check("case/space-insensitive", incomeSlotGroupKey("John PGR 1") === incomeSlotGroupKey("  john   pgr 2 "));
check("no trailing number = own group", incomeSlotGroupKey("Bonus") === "bonus");
check("bare name joins its numbered group", incomeSlotGroupKey("Natasha") === incomeSlotGroupKey("Natasha 1"));
check("all-number name keeps non-empty key", incomeSlotGroupKey("2") === "2");
check("label strips number", incomeSlotGroupLabel("John PGR 2") === "John PGR");
check("label keeps casing", incomeSlotGroupLabel("Natasha 1") === "Natasha");

// Groups + ordering
const templates: SlotTemplate[] = [
  { id: "n1", name: "Natasha 1", sortOrder: 1 },
  { id: "n2", name: "Natasha 2", sortOrder: 2 },
  { id: "j1", name: "John PGR 1", sortOrder: 3 },
  { id: "j2", name: "John PGR 2", sortOrder: 4 },
  { id: "bonus", name: "Bonus", sortOrder: 5 },
];
const groups = buildSlotGroups(templates);
check("natasha group has 2 slots in order",
  groups.get("natasha")?.map((m) => m.id).join(",") === "n1,n2");
check("bonus is a singleton", groups.get("bonus")?.length === 1);
{
  const numeric = buildSlotGroups([
    { id: "a10", name: "Pay 10", sortOrder: 0 },
    { id: "a2", name: "Pay 2", sortOrder: 0 },
  ]);
  check("numeric-aware ordering (2 before 10)",
    numeric.get("pay")?.map((m) => m.id).join(",") === "a2,a10");
}
{
  const dup = buildSlotGroups([
    { id: "x1", name: "Natasha 1", sortOrder: 1 },
    { id: "x1b", name: "natasha 1", sortOrder: 2 },
  ]);
  check("duplicate names dedupe to first", dup.get("natasha")?.length === 1 && dup.get("natasha")?.[0].id === "x1");
}

// Planner
const JULY = "2026-07-01";
const AUG = "2026-08-01";
const none = new Map<string, ReadonlySet<string>>();

{
  const plan = planSlotAssignments(
    [
      { txId: "t1", month: JULY, groupKey: "natasha" },
      { txId: "t2", month: JULY, groupKey: "natasha" },
    ],
    groups, none,
  );
  check("two deposits fill slots 1 then 2",
    plan.map((a) => a.templateId).join(",") === "n1,n2", plan);
}
{
  const plan = planSlotAssignments(
    [
      { txId: "t1", month: JULY, groupKey: "natasha" },
      { txId: "t2", month: JULY, groupKey: "natasha" },
      { txId: "t3", month: JULY, groupKey: "natasha" },
    ],
    groups, none,
  );
  check("third deposit overflows to last slot",
    plan.map((a) => a.templateId).join(",") === "n1,n2,n2", plan);
}
{
  const plan = planSlotAssignments(
    [
      { txId: "t1", month: JULY, groupKey: "natasha" },
      { txId: "t2", month: AUG, groupKey: "natasha" },
    ],
    groups, none,
  );
  check("months fill independently",
    plan.map((a) => `${a.month.slice(5, 7)}:${a.templateId}`).join(",") === "07:n1,08:n1", plan);
}
{
  const plan = planSlotAssignments(
    [{ txId: "t1", month: JULY, groupKey: "natasha" }],
    groups,
    new Map([[`natasha|${JULY}`, new Set(["n1"])]]),
  );
  check("pre-occupied slot 1 (e.g. manual assign) -> deposit lands slot 2",
    plan[0]?.templateId === "n2", plan);
}
{
  const plan = planSlotAssignments(
    [{ txId: "t1", month: JULY, groupKey: "natasha" }],
    groups,
    new Map([[`natasha|${JULY}`, new Set(["n1", "n2"])]]),
  );
  check("all slots pre-occupied -> overflow to last", plan[0]?.templateId === "n2", plan);
}
{
  const plan = planSlotAssignments(
    [{ txId: "t1", month: JULY, groupKey: "nonexistent" }],
    groups, none,
  );
  check("unknown group -> skipped", plan.length === 0, plan);
}
{
  // Idempotent re-run: after run 1, both txs are categorized (not scanned
  // again) and occupancy reflects them - an empty tx list plans nothing.
  const plan = planSlotAssignments(
    [],
    groups,
    new Map([[`natasha|${JULY}`, new Set(["n1", "n2"])]]),
  );
  check("re-run with everything assigned plans nothing", plan.length === 0);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
