import type { CashflowData } from "@/server/db/queries/cashflow";

// Pure layout math for the cashflow Sankey - no React, no DOM - so it stays
// importable from both the client chart component and verification scripts.
//
// The graph is a fixed left-to-right DAG: tier 0 income sources feed a single
// tier 1 "Cash Flow" node, which fans out to tier 2 category groups (plus
// Uncategorized and Surplus), and each group fans out to its tier 3 line
// items. Surplus and Uncategorized are terminal at tier 2.

export interface SankeyGraphNode {
  id: string;
  tier: number;
  label: string;
  valueCents: number;
  color: string;
  // Set by the server before the graph crosses to the client, so the client
  // never imports server money helpers.
  valueFormatted?: string;
  shareLabel?: string;
}

export interface SankeyGraphLink {
  sourceId: string;
  targetId: string;
  valueCents: number;
  color: string;
}

export interface PositionedNode extends SankeyGraphNode {
  x: number;
  y: number;
  height: number;
}

export interface PositionedLink extends SankeyGraphLink {
  path: string;
}

export const NODE_WIDTH = 8;
const NODE_PAD = 8;
const H_PAD = 4;
const MIN_NODE_HEIGHT = 2;
// Labels hang DOWNWARD from a node's top edge (see SankeyChart): a name line
// plus a value line. The canvas reserves this much above the first node and
// below the last so neither end's label is cut off.
export const LABEL_BLOCK_HEIGHT = 28;

export const CASHFLOW_NODE_ID = "cashflow";

export function buildSankeyGraph(
  data: CashflowData,
  groupColors: Record<string, string>,
): { nodes: SankeyGraphNode[]; links: SankeyGraphLink[] } {
  const nodes: SankeyGraphNode[] = [];
  const links: SankeyGraphLink[] = [];

  const deficitCents = Math.max(0, -data.surplusCents);
  const surplusCents = Math.max(0, data.surplusCents);

  // Tier 0: income sources (already sorted desc), then uncategorized income,
  // then a Deficit source so both sides of Cash Flow balance in a bad month.
  for (const source of data.incomeSources) {
    nodes.push({
      id: `src:${source.key}`,
      tier: 0,
      label: source.name,
      valueCents: source.totalCents,
      color: "var(--primary)",
    });
  }
  if (data.uncategorizedIncomeCents > 0) {
    nodes.push({
      id: "src:uncategorized",
      tier: 0,
      label: "Other income",
      valueCents: data.uncategorizedIncomeCents,
      color: "var(--muted-foreground)",
    });
  }
  if (deficitCents > 0) {
    nodes.push({
      id: "deficit",
      tier: 0,
      label: "Deficit",
      valueCents: deficitCents,
      color: "var(--destructive)",
    });
  }

  // Both sides are equal by construction: income + deficit = expense + surplus.
  const cashflowCents = data.totalIncomeCents + deficitCents;
  nodes.push({
    id: CASHFLOW_NODE_ID,
    tier: 1,
    label: "Cash Flow",
    valueCents: cashflowCents,
    color: "var(--foreground)",
  });

  // Links into Cash Flow carry the source's color (green income reads as
  // green); links out of it carry the target's.
  for (const node of nodes) {
    if (node.tier === 0) {
      links.push({
        sourceId: node.id,
        targetId: CASHFLOW_NODE_ID,
        valueCents: node.valueCents,
        color: node.color,
      });
    }
  }

  // Tier 2: groups desc by total (color still follows the entity via
  // groupColors), then Uncategorized, then Surplus at the bottom.
  const orderedGroups = [...data.groups].sort((a, b) => b.totalCents - a.totalCents);
  for (const group of orderedGroups) {
    const color = groupColors[group.groupId] ?? "var(--muted-foreground)";
    nodes.push({
      id: `grp:${group.groupId}`,
      tier: 2,
      label: group.name,
      valueCents: group.totalCents,
      color,
    });
    links.push({
      sourceId: CASHFLOW_NODE_ID,
      targetId: `grp:${group.groupId}`,
      valueCents: group.totalCents,
      color,
    });
    for (const item of group.items) {
      const itemId = `item:${group.groupId}:${item.key}`;
      nodes.push({
        id: itemId,
        tier: 3,
        label: item.name,
        valueCents: item.totalCents,
        color,
      });
      links.push({
        sourceId: `grp:${group.groupId}`,
        targetId: itemId,
        valueCents: item.totalCents,
        color,
      });
    }
  }
  if (data.uncategorizedExpenseCents > 0) {
    nodes.push({
      id: "grp:uncategorized",
      tier: 2,
      label: "Uncategorized",
      valueCents: data.uncategorizedExpenseCents,
      color: "var(--muted-foreground)",
    });
    links.push({
      sourceId: CASHFLOW_NODE_ID,
      targetId: "grp:uncategorized",
      valueCents: data.uncategorizedExpenseCents,
      color: "var(--muted-foreground)",
    });
  }
  if (surplusCents > 0) {
    nodes.push({
      id: "surplus",
      tier: 2,
      label: "Surplus",
      valueCents: surplusCents,
      color: "var(--primary)",
    });
    links.push({
      sourceId: CASHFLOW_NODE_ID,
      targetId: "surplus",
      valueCents: surplusCents,
      color: "var(--primary)",
    });
  }

  return { nodes, links };
}

export function layoutSankey(
  graphNodes: SankeyGraphNode[],
  graphLinks: SankeyGraphLink[],
  width: number,
): { nodes: PositionedNode[]; links: PositionedLink[]; height: number } {
  if (graphNodes.length === 0) return { nodes: [], links: [], height: 0 };

  const maxTier = Math.max(...graphNodes.map((n) => n.tier));
  const byTier = new Map<number, SankeyGraphNode[]>();
  for (const node of graphNodes) {
    const tierNodes = byTier.get(node.tier) ?? [];
    tierNodes.push(node);
    byTier.set(node.tier, tierNodes);
  }

  const maxTierCount = Math.max(...[...byTier.values()].map((t) => t.length));
  const baseHeight = Math.max(360, Math.min(560, maxTierCount * 22));

  // One shared value->px scale so ribbon widths mean the same thing in every
  // column: the tightest tier sets it.
  let scale = Infinity;
  for (const tierNodes of byTier.values()) {
    const total = tierNodes.reduce((sum, n) => sum + n.valueCents, 0);
    if (total <= 0) continue;
    const available = baseHeight - (tierNodes.length - 1) * NODE_PAD;
    scale = Math.min(scale, available / total);
  }
  if (!Number.isFinite(scale)) scale = 0;

  const columnSpan = maxTier > 0 ? (width - 2 * H_PAD - NODE_WIDTH) / maxTier : 0;

  // MIN_NODE_HEIGHT floors nodes too small to see, so a column of many tiny
  // items lays out TALLER than the scale assumed - which used to push the
  // column past both canvas edges, and with it the topmost node's label
  // (labels hang downward, so a negative y clips the name line first, leaving
  // an orphaned amount). Measure each column first, then size the canvas to
  // the tallest one instead of centering into a canvas that can't hold it.
  const heightsByTier = new Map<number, number[]>();
  let contentHeight = baseHeight;
  for (const [tier, tierNodes] of byTier) {
    const heights = tierNodes.map((n) => Math.max(MIN_NODE_HEIGHT, n.valueCents * scale));
    heightsByTier.set(tier, heights);
    contentHeight = Math.max(
      contentHeight,
      heights.reduce((sum, h) => sum + h, 0) + (tierNodes.length - 1) * NODE_PAD,
    );
  }
  const height = Math.ceil(contentHeight) + 2 * LABEL_BLOCK_HEIGHT;

  const nodes: PositionedNode[] = [];
  const nodeById = new Map<string, PositionedNode>();
  for (const [tier, tierNodes] of byTier) {
    const heights = heightsByTier.get(tier)!;
    const totalHeight =
      heights.reduce((sum, h) => sum + h, 0) + (tierNodes.length - 1) * NODE_PAD;
    // contentHeight >= totalHeight by construction, so y can't go negative.
    let y = LABEL_BLOCK_HEIGHT + (contentHeight - totalHeight) / 2;
    tierNodes.forEach((node, index) => {
      const positioned: PositionedNode = {
        ...node,
        x: H_PAD + tier * columnSpan,
        y,
        height: heights[index],
      };
      nodes.push(positioned);
      nodeById.set(node.id, positioned);
      y += heights[index] + NODE_PAD;
    });
  }

  // Slice each node's edge among its links: outgoing offsets in target-y
  // order, incoming in source-y order, which keeps ribbons from crossing
  // given the tier sort above.
  const sourceOffsets = new Map<string, number>();
  const targetOffsets = new Map<string, number>();
  const orderedLinks = [...graphLinks].sort((a, b) => {
    const aSource = nodeById.get(a.sourceId)!;
    const bSource = nodeById.get(b.sourceId)!;
    if (aSource.y !== bSource.y) return aSource.y - bSource.y;
    return nodeById.get(a.targetId)!.y - nodeById.get(b.targetId)!.y;
  });

  const links: PositionedLink[] = orderedLinks.map((link) => {
    const source = nodeById.get(link.sourceId)!;
    const target = nodeById.get(link.targetId)!;
    const thickness = Math.max(1, link.valueCents * scale);

    const sy = source.y + (sourceOffsets.get(link.sourceId) ?? 0);
    sourceOffsets.set(link.sourceId, (sourceOffsets.get(link.sourceId) ?? 0) + thickness);
    const ty = target.y + (targetOffsets.get(link.targetId) ?? 0);
    targetOffsets.set(link.targetId, (targetOffsets.get(link.targetId) ?? 0) + thickness);

    const x0 = source.x + NODE_WIDTH;
    const x1 = target.x;
    const mx = (x0 + x1) / 2;
    const path =
      `M ${x0},${sy}` +
      ` C ${mx},${sy} ${mx},${ty} ${x1},${ty}` +
      ` L ${x1},${ty + thickness}` +
      ` C ${mx},${ty + thickness} ${mx},${sy + thickness} ${x0},${sy + thickness} Z`;

    return { ...link, path };
  });

  return { nodes, links, height };
}
