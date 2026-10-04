import { Archive, ArchiveRestore, Check, AlertCircle } from "lucide-react";
import { Button, Field, Modal } from "./ui.jsx";
import { colors } from "../lib/format.js";

const colorNames = ["Forest", "Terracotta", "Ochre", "Sage", "Slate", "Walnut"];
export default function CategoryDialog({
  modal,
  categories,
  busy,
  error,
  onSave,
  onSetActive,
  onClose,
}) {
  const category = modal.item;
  const archiving = modal.type === "category-archive";
  const restoring = modal.type === "category-restore";
  const confirmation = archiving || restoring;
  const currentColor =
    category?.color || colors[categories.length % colors.length];
  const palette = colors.includes(currentColor)
    ? colors
    : [currentColor, ...colors];
  const title = confirmation
    ? `${archiving ? "Archive" : "Reactivate"} ${category.name}?`
    : category
      ? "Edit category"
      : "Add category";
  return (
    <Modal
      title={title}
      description={
        confirmation
          ? archiving
            ? "New items will wait until you reactivate this category. Existing items, transactions, and budget totals stay in place."
            : "Use this category for new items again. Its existing items and history stay in place."
          : "Category names and colors apply across this budget’s months."
      }
      onClose={() => !busy && onClose()}
    >
      {confirmation ? (
        <>
          {(category.items?.length || 0) > 0 && (
            <p className="category-confirm-note">
              {category.items.length} item
              {category.items.length === 1 ? "" : "s"} in this month’s plan will
              be kept.
            </p>
          )}
          {error && (
            <p className="inline-error" role="alert">
              <AlertCircle size={16} />
              {error}
            </p>
          )}
          <div className="modal-actions">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              busy={busy}
              icon={archiving ? Archive : ArchiveRestore}
              onClick={onSetActive}
            >
              {archiving ? "Archive category" : "Reactivate category"}
            </Button>
          </div>
        </>
      ) : (
        <form onSubmit={onSave}>
          <Field label="Category name">
            <input
              name="name"
              required
              maxLength={80}
              defaultValue={category?.name || ""}
              placeholder="Housing, food, a future adventure…"
            />
          </Field>
          <Field label="Color">
            <select name="color" defaultValue={currentColor}>
              {palette.map((color) => (
                <option key={color} value={color}>
                  {colorNames[colors.indexOf(color)] || "Current color"}
                </option>
              ))}
            </select>
          </Field>
          {category?.active === false && (
            <p className="category-confirm-note">
              This category is archived. Editing its name or color keeps it
              archived.
            </p>
          )}
          {error && (
            <p className="inline-error" role="alert">
              <AlertCircle size={16} />
              {error}
            </p>
          )}
          <div className="modal-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" busy={busy} icon={Check}>
              {category ? "Save category" : "Add category"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
