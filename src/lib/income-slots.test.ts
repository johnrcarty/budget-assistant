import { describe, expect, it } from "vitest";

import {
  buildSlotGroups,
  planSlotAssignments,
  type SlotTemplate,
} from "@/lib/income-slots";

describe("buildSlotGroups", () => {
  const templates: SlotTemplate[] = [
    { id: "a1", personId: "person-a", slotNumber: 1, sortOrder: 1 },
    { id: "a2", personId: "person-a", slotNumber: 2, sortOrder: 2 },
    { id: "b1", personId: "person-b", slotNumber: 1, sortOrder: 3 },
    { id: "b2", personId: "person-b", slotNumber: 2, sortOrder: 4 },
    { id: "bonus", personId: null, slotNumber: 1, sortOrder: 5 },
  ];
  const groups = buildSlotGroups(templates);

  it("orders a person's slots by slotNumber", () => {
    expect(groups.get("person-a")?.map((m) => m.id)).toEqual(["a1", "a2"]);
  });

  it("treats a personless template as its own singleton group", () => {
    expect(groups.get("orphan:bonus")).toHaveLength(1);
  });

  it("orders by slotNumber even when input order is reversed", () => {
    const reversed = buildSlotGroups([
      { id: "a2", personId: "person-a", slotNumber: 2, sortOrder: 0 },
      { id: "a1", personId: "person-a", slotNumber: 1, sortOrder: 0 },
    ]);
    expect(reversed.get("person-a")?.map((m) => m.id)).toEqual(["a1", "a2"]);
  });

  it("keeps two personless templates in separate singleton groups", () => {
    const two = buildSlotGroups([
      { id: "bonus", personId: null, slotNumber: 1, sortOrder: 0 },
      { id: "interest", personId: null, slotNumber: 1, sortOrder: 0 },
    ]);
    expect(two.get("orphan:bonus")).toHaveLength(1);
    expect(two.get("orphan:interest")).toHaveLength(1);
  });
});

describe("planSlotAssignments", () => {
  const templates: SlotTemplate[] = [
    { id: "a1", personId: "person-a", slotNumber: 1, sortOrder: 1 },
    { id: "a2", personId: "person-a", slotNumber: 2, sortOrder: 2 },
    { id: "b1", personId: "person-b", slotNumber: 1, sortOrder: 3 },
    { id: "b2", personId: "person-b", slotNumber: 2, sortOrder: 4 },
    { id: "bonus", personId: null, slotNumber: 1, sortOrder: 5 },
  ];
  const groups = buildSlotGroups(templates);
  const JULY = "2026-07-01";
  const AUG = "2026-08-01";
  const none = new Map<string, ReadonlySet<string>>();

  it("fills slots 1 then 2 for two deposits in order", () => {
    const plan = planSlotAssignments(
      [
        { txId: "t1", month: JULY, personId: "person-a" },
        { txId: "t2", month: JULY, personId: "person-a" },
      ],
      groups,
      none,
    );
    expect(plan.map((a) => a.templateId)).toEqual(["a1", "a2"]);
  });

  it("overflows a third deposit to the last slot", () => {
    const plan = planSlotAssignments(
      [
        { txId: "t1", month: JULY, personId: "person-a" },
        { txId: "t2", month: JULY, personId: "person-a" },
        { txId: "t3", month: JULY, personId: "person-a" },
      ],
      groups,
      none,
    );
    expect(plan.map((a) => a.templateId)).toEqual(["a1", "a2", "a2"]);
  });

  it("fills each month's slots independently", () => {
    const plan = planSlotAssignments(
      [
        { txId: "t1", month: JULY, personId: "person-a" },
        { txId: "t2", month: AUG, personId: "person-a" },
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
      [{ txId: "t1", month: JULY, personId: "person-a" }],
      groups,
      new Map([[`person-a|${JULY}`, new Set(["a1"])]]),
    );
    expect(plan[0]?.templateId).toBe("a2");
  });

  it("overflows to the last slot when all slots are pre-occupied", () => {
    const plan = planSlotAssignments(
      [{ txId: "t1", month: JULY, personId: "person-a" }],
      groups,
      new Map([[`person-a|${JULY}`, new Set(["a1", "a2"])]]),
    );
    expect(plan[0]?.templateId).toBe("a2");
  });

  it("skips deposits whose group has no matching templates", () => {
    const plan = planSlotAssignments(
      [{ txId: "t1", month: JULY, personId: "nonexistent" }],
      groups,
      none,
    );
    expect(plan).toHaveLength(0);
  });

  it("is idempotent: re-running with everything assigned plans nothing", () => {
    const plan = planSlotAssignments(
      [],
      groups,
      new Map([[`person-a|${JULY}`, new Set(["a1", "a2"])]]),
    );
    expect(plan).toHaveLength(0);
  });

  it("plans a personless (orphan) singleton like any other single-slot group", () => {
    const plan = planSlotAssignments(
      [{ txId: "t1", month: JULY, personId: "orphan:bonus" }],
      groups,
      none,
    );
    expect(plan[0]?.templateId).toBe("bonus");
  });
});
