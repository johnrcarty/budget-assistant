import { describe, expect, it } from "vitest";

import {
  incomeSlotGroupKey,
  incomeSlotGroupLabel,
  buildSlotGroups,
  planSlotAssignments,
  type SlotTemplate,
} from "@/lib/income-slots";

describe("incomeSlotGroupKey / incomeSlotGroupLabel", () => {
  it("groups numbered slots of the same name together", () => {
    expect(incomeSlotGroupKey("Person A 1")).toBe(incomeSlotGroupKey("Person A 2"));
  });

  it("is case- and space-insensitive", () => {
    expect(incomeSlotGroupKey("Person B 1")).toBe(incomeSlotGroupKey("  person   b 2 "));
  });

  it("gives an unnumbered name its own group", () => {
    expect(incomeSlotGroupKey("Bonus")).toBe("bonus");
  });

  it("joins a bare name to its numbered group", () => {
    expect(incomeSlotGroupKey("Person A")).toBe(incomeSlotGroupKey("Person A 1"));
  });

  it("keeps a non-empty key for an all-number name", () => {
    expect(incomeSlotGroupKey("2")).toBe("2");
  });

  it("strips the trailing number from the label", () => {
    expect(incomeSlotGroupLabel("Person B 2")).toBe("Person B");
  });

  it("preserves casing in the label", () => {
    expect(incomeSlotGroupLabel("Person A 1")).toBe("Person A");
  });
});

describe("buildSlotGroups", () => {
  const templates: SlotTemplate[] = [
    { id: "a1", name: "Person A 1", sortOrder: 1 },
    { id: "a2", name: "Person A 2", sortOrder: 2 },
    { id: "b1", name: "Person B 1", sortOrder: 3 },
    { id: "b2", name: "Person B 2", sortOrder: 4 },
    { id: "bonus", name: "Bonus", sortOrder: 5 },
  ];
  const groups = buildSlotGroups(templates);

  it("orders the person a group's 2 slots by sortOrder", () => {
    expect(groups.get("person a")?.map((m) => m.id)).toEqual(["a1", "a2"]);
  });

  it("treats an unnumbered name as a singleton group", () => {
    expect(groups.get("bonus")).toHaveLength(1);
  });

  it("orders numerically, not lexically (2 before 10)", () => {
    const numeric = buildSlotGroups([
      { id: "a10", name: "Pay 10", sortOrder: 0 },
      { id: "a2", name: "Pay 2", sortOrder: 0 },
    ]);
    expect(numeric.get("pay")?.map((m) => m.id)).toEqual(["a2", "a10"]);
  });

  it("dedupes duplicate names to the first occurrence", () => {
    const dup = buildSlotGroups([
      { id: "x1", name: "Person A 1", sortOrder: 1 },
      { id: "x1b", name: "person a 1", sortOrder: 2 },
    ]);
    expect(dup.get("person a")).toHaveLength(1);
    expect(dup.get("person a")?.[0].id).toBe("x1");
  });
});

describe("planSlotAssignments", () => {
  const templates: SlotTemplate[] = [
    { id: "a1", name: "Person A 1", sortOrder: 1 },
    { id: "a2", name: "Person A 2", sortOrder: 2 },
    { id: "b1", name: "Person B 1", sortOrder: 3 },
    { id: "b2", name: "Person B 2", sortOrder: 4 },
    { id: "bonus", name: "Bonus", sortOrder: 5 },
  ];
  const groups = buildSlotGroups(templates);
  const JULY = "2026-07-01";
  const AUG = "2026-08-01";
  const none = new Map<string, ReadonlySet<string>>();

  it("fills slots 1 then 2 for two deposits in order", () => {
    const plan = planSlotAssignments(
      [
        { txId: "t1", month: JULY, groupKey: "person a" },
        { txId: "t2", month: JULY, groupKey: "person a" },
      ],
      groups,
      none,
    );
    expect(plan.map((a) => a.templateId)).toEqual(["a1", "a2"]);
  });

  it("overflows a third deposit to the last slot", () => {
    const plan = planSlotAssignments(
      [
        { txId: "t1", month: JULY, groupKey: "person a" },
        { txId: "t2", month: JULY, groupKey: "person a" },
        { txId: "t3", month: JULY, groupKey: "person a" },
      ],
      groups,
      none,
    );
    expect(plan.map((a) => a.templateId)).toEqual(["a1", "a2", "a2"]);
  });

  it("fills each month's slots independently", () => {
    const plan = planSlotAssignments(
      [
        { txId: "t1", month: JULY, groupKey: "person a" },
        { txId: "t2", month: AUG, groupKey: "person a" },
      ],
      groups,
      none,
    );
    expect(plan.map((a) => `${a.month.slice(5, 7)}:${a.templateId}`)).toEqual([
      "07:a1",
      "08:a1",
    ]);
  });

  it("skips a pre-occupied slot 1 (e.g. a manual assignment)", () => {
    const plan = planSlotAssignments(
      [{ txId: "t1", month: JULY, groupKey: "person a" }],
      groups,
      new Map([[`person a|${JULY}`, new Set(["a1"])]]),
    );
    expect(plan[0]?.templateId).toBe("a2");
  });

  it("overflows to the last slot when all slots are pre-occupied", () => {
    const plan = planSlotAssignments(
      [{ txId: "t1", month: JULY, groupKey: "person a" }],
      groups,
      new Map([[`person a|${JULY}`, new Set(["a1", "a2"])]]),
    );
    expect(plan[0]?.templateId).toBe("a2");
  });

  it("skips deposits whose group has no matching templates", () => {
    const plan = planSlotAssignments(
      [{ txId: "t1", month: JULY, groupKey: "nonexistent" }],
      groups,
      none,
    );
    expect(plan).toHaveLength(0);
  });

  it("is idempotent: re-running with everything assigned plans nothing", () => {
    const plan = planSlotAssignments(
      [],
      groups,
      new Map([[`person a|${JULY}`, new Set(["a1", "a2"])]]),
    );
    expect(plan).toHaveLength(0);
  });
});
