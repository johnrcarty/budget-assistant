import { ArrowLeftRight } from "lucide-react";
import { money, compactMoney, colors } from "../lib/format.js";
import { Empty } from "../components/ui.jsx";
export default function Sankey({ income, groups, spent = false }) {
  const branches = groups
    .map((g, i) => ({
      name: g.name,
      value: Math.max(0, spent ? g.spent_cents : g.planned_cents),
      color: g.color || colors[i % colors.length],
    }))
    .filter((g) => g.value > 0);
  const allocated = branches.reduce((s, g) => s + g.value, 0);
  const left = Math.max(0, income - allocated);
  if (left > 0)
    branches.push({
      name: spent ? "Not yet spent" : "Unassigned",
      value: left,
      color: "#d4d1c5",
    });
  if (!branches.length)
    return (
      <Empty
        title="A picture of your plan"
        description="Add income and budget items to see your money find its way home."
        icon={ArrowLeftRight}
      />
    );
  const total = Math.max(income, allocated, 1),
    height = 218,
    start = 50,
    bar = 12,
    scale = height / total,
    gap = Math.min(14, 70 / branches.length);
  const sourceY = start + (height * Math.max(0, total - income)) / total;
  const destinationHeight =
    branches.reduce((sum, g) => sum + Math.max(g.value * scale, 38) + gap, 0) -
    gap;
  let current = 0,
    destinationY = start;
  const nodes = branches.map((g) => {
    const h = g.value * scale;
    const slot = Math.max(h, 38);
    const y = destinationY + (slot - h) / 2;
    const sy = start + current * scale;
    current += g.value;
    destinationY += slot + gap;
    return { ...g, y, sy, h };
  });
  return (
    <div className="sankey-container">
      <svg
        viewBox={`0 0 730 ${Math.max(320, destinationHeight + 80)}`}
        role="img"
        aria-label={`Cash flow: ${money(income)} expected income, ${money(allocated)} ${spent ? "spent" : "planned"}, ${money(left)} remaining`}
      >
        <defs>
          <linearGradient id="incomeGradient">
            <stop stopColor="#334b3e" stopOpacity=".36" />
            <stop offset="1" stopColor="#647956" stopOpacity=".65" />
          </linearGradient>
        </defs>
        <text x="15" y="23" className="flow-heading">
          EXPECTED INCOME
        </text>
        <text x="252" y="23" className="flow-heading">
          {spent ? "ACTIVITY" : "YOUR PLAN"}
        </text>
        <text x="536" y="23" className="flow-heading">
          {spent ? "SPENDING" : "PURPOSE"}
        </text>
        {income > 0 && (
          <path
            d={`M 26 ${sourceY} C 138 ${sourceY},142 ${sourceY},254 ${sourceY} L 254 ${start + height} C 142 ${start + height},138 ${start + height},26 ${start + height} Z`}
            fill="url(#incomeGradient)"
          />
        )}
        {allocated > income && (
          <path
            d={`M26 ${start} C138 ${start},142 ${start},254 ${start} L254 ${sourceY} C142 ${sourceY},138 ${sourceY},26 ${sourceY} Z`}
            fill="#bf7154"
            fillOpacity=".36"
          />
        )}
        {nodes.map((g, i) => (
          <path
            key={i}
            d={`M266 ${g.sy} C390 ${g.sy},406 ${g.y},530 ${g.y} L530 ${g.y + g.h} C406 ${g.y + g.h},390 ${g.sy + g.h},266 ${g.sy + g.h} Z`}
            fill={g.color}
            fillOpacity={g.name === "Unassigned" ? 0.38 : 0.53}
          >
            <title>
              {g.name}: {money(g.value)}
            </title>
          </path>
        ))}
        <rect
          x="15"
          y={sourceY}
          width={bar}
          height={Math.max(0, income * scale)}
          rx="4"
          fill="#334b3e"
        />
        {allocated > income && (
          <rect
            x="15"
            y={start}
            width={bar}
            height={(allocated - income) * scale}
            rx="4"
            fill="#bf7154"
          />
        )}
        <rect
          x="254"
          y={start}
          width={bar}
          height={height}
          rx="4"
          fill="#334b3e"
        />
        {nodes.map((g, i) => (
          <g key={i}>
            <rect
              x="530"
              y={g.y}
              width={bar}
              height={Math.max(g.h, 2)}
              rx="3"
              fill={g.color}
            />
            <text x="553" y={g.y + g.h / 2 - 2} className="flow-label">
              {g.name.length > 22 ? `${g.name.slice(0, 20)}…` : g.name}
            </text>
            <text x="553" y={g.y + g.h / 2 + 17} className="flow-amount">
              {money(g.value)}
            </text>
          </g>
        ))}
        <text x="15" y={start + height + 28} className="flow-total">
          {compactMoney(income)}
        </text>
        <text x="254" y={start + height + 28} className="flow-total">
          {compactMoney(total)}
        </text>
        <text x="254" y={start + height + 49} className="flow-amount">
          {compactMoney(allocated)} {spent ? "spent" : "assigned"}
        </text>
        {allocated > income && (
          <text x="15" y={start + height + 47} className="flow-amount">
            +{compactMoney(allocated - income)} unfunded
          </text>
        )}
      </svg>
    </div>
  );
}
