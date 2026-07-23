// Pure slot-group logic for income categorization - no server imports, so
// it's shared by the rules engine, UI labels, and verification scripts.
//
// The household budgets one income line item per expected paycheck. A
// person's paychecks are indistinguishable to description rules (same text,
// account, amount), so the engine treats a person's numbered templates as
// SLOTS of one group and fills them in deposit order. Grouping is a real
// personId FK + an explicit slotNumber column - a template with no personId
// (a bonus, interest, a tax return, ...) is its own singleton "orphan" group.

export interface SlotTemplate {
  id: string;
  personId: string | null;
  slotNumber: number;
  sortOrder: number;
}

// Groups templates by personId (a template with no person is its own
// singleton group, keyed by its own id so it never collides with another
// personless template). Members ordered by slotNumber. Generic so callers
// that select extra display columns (name, a joined person's name, ...) get
// them back on the grouped members instead of being narrowed away.
export function buildSlotGroups<T extends SlotTemplate>(templates: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const template of templates) {
    const key = template.personId ?? `orphan:${template.id}`;
    const members = groups.get(key) ?? [];
    members.push(template);
    groups.set(key, members);
  }
  for (const members of groups.values()) {
    members.sort((a, b) => a.slotNumber - b.slotNumber);
  }
  return groups;
}

// The identifier embedded in a Sankey source node id ("src:slot:<id>") -
// a person's slots all merge into one node; a personless template is its
// own node, keyed by template id so two differently-named personless
// templates never merge just because of a naming coincidence.
export function incomeSlotIdentifier(personId: string | null, templateId: string): string {
  return personId ? `person:${personId}` : `tpl:${templateId}`;
}

export type ParsedIncomeSlotIdentifier =
  | { kind: "person"; personId: string }
  | { kind: "template"; templateId: string }
  | null;

export function parseIncomeSlotIdentifier(identifier: string): ParsedIncomeSlotIdentifier {
  if (identifier.startsWith("person:")) {
    return { kind: "person", personId: identifier.slice("person:".length) };
  }
  if (identifier.startsWith("tpl:")) {
    return { kind: "template", templateId: identifier.slice("tpl:".length) };
  }
  return null;
}

export interface SlotPlanInput {
  txId: string;
  month: string; // YYYY-MM-01
  personId: string; // a real person id, or the buildSlotGroups orphan key
}

export interface SlotPlanAssignment {
  txId: string;
  month: string;
  templateId: string;
}

// Core planner. `txs` MUST already be ordered (postedDate, createdAt, id)
// ascending - the Nth deposit of a month fills the Nth open slot. Occupancy
// is per (personId, month): a slot is occupied when its month-instance
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
    const members = groups.get(tx.personId);
    if (!members || members.length === 0) continue;

    const key = `${tx.personId}|${tx.month}`;
    const occupied = occupiedFor(key);
    const target = members.find((m) => !occupied.has(m.id)) ?? members[members.length - 1];
    occupied.add(target.id);
    assignments.push({ txId: tx.txId, month: tx.month, templateId: target.id });
  }
  return assignments;
}
