// Pure slot-group logic for income categorization - no server imports, so
// it's shared by the rules engine, UI labels, and verification scripts.
//
// The household budgets one income line item per expected paycheck
// ("Natasha 1", "Natasha 2"). A person's paychecks are indistinguishable to
// description rules (same text, account, amount), so the engine treats
// numbered templates as SLOTS of one group and fills them in deposit order.
// Grouping is derived from the template name by convention: one trailing
// integer is stripped ("Natasha 1" and "Natasha 2" -> group "natasha").
// Names without a trailing number are their own group.

export function incomeSlotGroupKey(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
  const stripped = normalized.replace(/\s*\d+$/, "").trim();
  return stripped || normalized;
}

// Display form: original casing minus the trailing number ("Natasha").
export function incomeSlotGroupLabel(name: string): string {
  const collapsed = name.trim().replace(/\s+/g, " ");
  const stripped = collapsed.replace(/\s*\d+$/, "").trim();
  return stripped || collapsed;
}

export interface SlotTemplate {
  id: string;
  name: string;
  sortOrder: number;
}

// Groups active templates by slot-group key; members ordered by sortOrder,
// then numeric-aware name compare ("Natasha 2" before "Natasha 10").
// Duplicate normalized full names dedupe to the first member - an artifact
// of the income "Add" action always minting a new template.
export function buildSlotGroups(templates: SlotTemplate[]): Map<string, SlotTemplate[]> {
  const groups = new Map<string, SlotTemplate[]>();
  const sorted = [...templates].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
  );

  const seenNames = new Set<string>();
  for (const template of sorted) {
    const normalizedName = template.name.trim().toLowerCase().replace(/\s+/g, " ");
    if (seenNames.has(normalizedName)) continue;
    seenNames.add(normalizedName);

    const key = incomeSlotGroupKey(template.name);
    const members = groups.get(key) ?? [];
    members.push(template);
    groups.set(key, members);
  }
  return groups;
}

export interface SlotPlanInput {
  txId: string;
  month: string; // YYYY-MM-01
  groupKey: string;
}

export interface SlotPlanAssignment {
  txId: string;
  month: string;
  templateId: string;
}

// Core planner. `txs` MUST already be ordered (postedDate, createdAt, id)
// ascending - the Nth deposit of a month fills the Nth open slot. Occupancy
// is per (groupKey, month): a slot is occupied when its month-instance
// already has at least one linked transaction (engine or manual). When
// every slot is taken, further deposits overflow onto the LAST slot - a
// three-paycheck month shows received > planned, which downstream sums
// handle honestly.
export function planSlotAssignments(
  txs: SlotPlanInput[],
  groups: Map<string, SlotTemplate[]>,
  initialOccupancy: Map<string, ReadonlySet<string>>,
): SlotPlanAssignment[] {
  const occupancy = new Map<string, Set<string>>();
  const occupiedFor = (key: string): Set<string> => {
    let set = occupancy.get(key);
    if (!set) {
      set = new Set(initialOccupancy.get(key) ?? []);
      occupancy.set(key, set);
    }
    return set;
  };

  const assignments: SlotPlanAssignment[] = [];
  for (const tx of txs) {
    const members = groups.get(tx.groupKey);
    if (!members || members.length === 0) continue;

    const key = `${tx.groupKey}|${tx.month}`;
    const occupied = occupiedFor(key);
    const target = members.find((m) => !occupied.has(m.id)) ?? members[members.length - 1];
    occupied.add(target.id);
    assignments.push({ txId: tx.txId, month: tx.month, templateId: target.id });
  }
  return assignments;
}
