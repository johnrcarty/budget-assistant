import { Ellipsis } from "lucide-react";

export const mobilePageIds = ["overview", "budget", "transactions", "accounts"];

export default function MobileNav({
  items,
  currentPage,
  onNavigate,
  moreOpen,
  onOpenMore,
}) {
  const moreSelected = !mobilePageIds.includes(currentPage);
  return (
    <nav
      className="mobile-bottom-nav"
      aria-label="Main navigation"
      inert={moreOpen ? "" : undefined}
      aria-hidden={moreOpen ? true : undefined}
    >
      {mobilePageIds.map((id) => {
        const { label, icon: Icon } = items.find((item) => item.id === id);
        const selected = currentPage === id;
        return (
          <button
            type="button"
            key={id}
            className={`mobile-bottom-link ${selected ? "active" : ""}`}
            aria-current={selected ? "page" : undefined}
            onClick={() => onNavigate(id)}
          >
            <Icon size={21} strokeWidth={1.8} aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
      <button
        type="button"
        className={`mobile-bottom-link ${moreSelected || moreOpen ? "active" : ""}`}
        aria-label="More navigation"
        aria-expanded={moreOpen}
        aria-controls="app-sidebar"
        onClick={onOpenMore}
      >
        <Ellipsis size={23} strokeWidth={1.8} aria-hidden="true" />
        <span>More</span>
      </button>
    </nav>
  );
}
