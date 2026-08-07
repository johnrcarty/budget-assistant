import { describe, expect, it } from "vitest";

import {
  layoutSankey,
  LABEL_BLOCK_HEIGHT,
  type SankeyGraphLink,
  type SankeyGraphNode,
} from "./sankey-layout";

const node = (
  id: string,
  tier: number,
  valueCents: number,
): SankeyGraphNode => ({ id, tier, label: id, valueCents, color: "var(--primary)" });

const link = (sourceId: string, targetId: string, valueCents: number): SankeyGraphLink => ({
  sourceId,
  targetId,
  valueCents,
  color: "var(--primary)",
});

// One big node plus a long tail of tiny ones - the shape that used to break
// the layout, because each tiny node is floored to MIN_NODE_HEIGHT and the
// column ends up taller than the scale assumed.
function graphWithTinyTail(tinyCount: number) {
  const nodes: SankeyGraphNode[] = [node("in", 0, 1_000_000), node("cash", 1, 1_000_000)];
  const links: SankeyGraphLink[] = [link("in", "cash", 1_000_000)];
  nodes.push(node("big", 2, 900_000));
  links.push(link("cash", "big", 900_000));
  for (let i = 0; i < tinyCount; i += 1) {
    nodes.push(node(`tiny-${i}`, 2, 1));
    links.push(link("cash", `tiny-${i}`, 1));
  }
  return { nodes, links };
}

describe("sankey layout", () => {
  it("keeps every node inside the canvas even with a long tail of tiny nodes", () => {
    const { nodes, links } = graphWithTinyTail(40);

    const layout = layoutSankey(nodes, links, 361);

    for (const positioned of layout.nodes) {
      expect(positioned.y).toBeGreaterThanOrEqual(0);
      expect(positioned.y + positioned.height).toBeLessThanOrEqual(layout.height);
    }
  });

  // Labels hang downward from a node's top edge, so a node at y < 0 loses its
  // NAME line first and renders as an orphaned amount.
  it("reserves room above the first node for its label", () => {
    const { nodes, links } = graphWithTinyTail(40);

    const layout = layoutSankey(nodes, links, 361);

    const topY = Math.min(...layout.nodes.map((n) => n.y));
    expect(topY).toBeGreaterThanOrEqual(LABEL_BLOCK_HEIGHT);
  });

  it("reserves room below the last node for its label", () => {
    const { nodes, links } = graphWithTinyTail(40);

    const layout = layoutSankey(nodes, links, 361);

    const bottom = Math.max(...layout.nodes.map((n) => n.y + n.height));
    expect(layout.height - bottom).toBeGreaterThanOrEqual(LABEL_BLOCK_HEIGHT);
  });

  it("grows the canvas to fit the tallest column rather than overflowing it", () => {
    const few = graphWithTinyTail(4);
    const many = graphWithTinyTail(60);

    const short = layoutSankey(few.nodes, few.links, 361);
    const tall = layoutSankey(many.nodes, many.links, 361);

    expect(tall.height).toBeGreaterThan(short.height);
  });

  it("centers a column that fits, so short graphs still look balanced", () => {
    const nodes = [node("in", 0, 100), node("cash", 1, 100), node("out", 2, 100)];
    const links = [link("in", "cash", 100), link("cash", "out", 100)];

    const layout = layoutSankey(nodes, links, 361);

    for (const positioned of layout.nodes) {
      const above = positioned.y;
      const below = layout.height - (positioned.y + positioned.height);
      expect(Math.abs(above - below)).toBeLessThan(1);
    }
  });

  it("returns an empty layout for an empty graph", () => {
    expect(layoutSankey([], [], 361)).toEqual({ nodes: [], links: [], height: 0 });
  });
});
