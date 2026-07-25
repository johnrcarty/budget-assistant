"use client";

import { useActionState, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createTransaction, updateTransaction, deleteTransaction } from "@/server/actions/transactions";
import { currentDateString } from "@/lib/month";
import type { accounts, transactions } from "@/server/db/schema";

type Account = typeof accounts.$inferSelect;
type Transaction = typeof transactions.$inferSelect;

export interface ExpenseTarget {
  id: string;
  name: string;
  groupName: string;
}

export interface IncomeTarget {
  id: string;
  name: string;
  slotCount: number;
  memberIds: string[];
}

export function TransactionDialog({
  trigger,
  triggerClassName,
  accounts,
  expenseTargets,
  incomeTargets = [],
  transaction,
  currentExpenseTemplateId,
  currentIncomeTemplateId,
  currentCategoryName,
}: {
  trigger: React.ReactNode;
  triggerClassName?: string;
  accounts: Account[];
  expenseTargets: ExpenseTarget[];
  incomeTargets?: IncomeTarget[];
  transaction?: Transaction;
  // The transaction's CURRENT instance resolves back to one of these
  // templates - needed to default the picker, since a category choice is
  // always a template, not the specific month's instance the transaction
  // happens to be linked to.
  currentExpenseTemplateId?: string | null;
  currentIncomeTemplateId?: string | null;
  currentCategoryName?: string | null;
}) {
  const isEdit = !!transaction;
  const [open, setOpen] = useState(false);
  const [error, formAction, pending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        if (isEdit) {
          await updateTransaction(transaction.id, formData);
        } else {
          await createTransaction(formData);
        }
        setOpen(false);
        return undefined;
      } catch (error) {
        // A redirect() from inside the action (e.g. dal.ts's stale-session
        // self-heal) also lands here as a throw - hand it back to Next
        // instead of misreporting it as a save failure.
        unstable_rethrow(error);
        return "Couldn't save that transaction. Check the amount.";
      }
    },
    undefined,
  );

  const today = currentDateString();
  const defaultType = transaction && transaction.amountCents > 0 ? "income" : "expense";
  const [type, setType] = useState<"expense" | "income">(defaultType);
  const defaultAmount = transaction
    ? (Math.abs(transaction.amountCents) / 100).toFixed(2)
    : "";

  // Income options are one-per-slot-GROUP (keyed by the head template), but
  // a transaction can be linked to any member slot's template - resolve the
  // linked template to its group head so the picker selects the group
  // instead of synthesizing a bogus "(archived)" entry for a live slot.
  const incomeGroupId = currentIncomeTemplateId
    ? (incomeTargets.find((t) => t.memberIds.includes(currentIncomeTemplateId))?.id ??
      currentIncomeTemplateId)
    : null;

  // Current category value on an edit, in the combined encoding - always a
  // TEMPLATE id, resolved from whichever instance the transaction is
  // currently linked to.
  const defaultCategory = transaction?.isTransfer
    ? "transfer"
    : incomeGroupId
      ? `income:${incomeGroupId}`
      : currentExpenseTemplateId
        ? `expense:${currentExpenseTemplateId}`
        : "none";

  // Templates are stable across months, so the only way a "current
  // category" can be missing from the options list is a since-deactivated
  // template - synthesize an entry so the dialog doesn't display it as
  // Uncategorized.
  const categoryOptions: { value: string; label: string }[] =
    type === "income"
      ? incomeTargets.map((t) => ({ value: `income:${t.id}`, label: t.name }))
      : expenseTargets.map((t) => ({ value: `expense:${t.id}`, label: `${t.groupName} › ${t.name}` }));
  if (
    defaultCategory !== "none" &&
    defaultCategory.startsWith(type === "income" ? "income:" : "expense:") &&
    !categoryOptions.some((o) => o.value === defaultCategory)
  ) {
    categoryOptions.unshift({
      value: defaultCategory,
      label: currentCategoryName ? `${currentCategoryName} (archived)` : "(current category)",
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={triggerClassName}>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Transaction" : "Add Transaction"}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {!isEdit && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="txn-account">Account</Label>
              <Select
                name="accountId"
                defaultValue={accounts[0]?.id}
                items={Object.fromEntries(accounts.map((a) => [a.id, a.name]))}
                required
              >
                <SelectTrigger id="txn-account" className="w-full">
                  <SelectValue placeholder="Select an account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="txn-type">Type</Label>
            <Select
              name="type"
              value={type}
              onValueChange={(v) => setType(v === "income" ? "income" : "expense")}
              items={{ expense: "Expense", income: "Income" }}
            >
              <SelectTrigger id="txn-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="income">Income</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="txn-amount">Amount</Label>
            <Input
              id="txn-amount"
              name="amount"
              type="number"
              step="0.01"
              min="0"
              required
              defaultValue={defaultAmount}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="txn-description">Description</Label>
            <Input
              id="txn-description"
              name="description"
              required
              defaultValue={transaction?.description}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="txn-date">Date</Label>
            <Input
              id="txn-date"
              name="postedDate"
              type="date"
              required
              defaultValue={transaction?.postedDate ?? today}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="txn-category">
              {type === "income" ? "Income source" : "Category"}
            </Label>
            {/* key={type} remounts the select when the type flips, so it
                falls back to a valid default instead of holding a value
                from the other kind. */}
            <Select
              key={type}
              name="category"
              defaultValue={
                defaultCategory === "transfer" ||
                categoryOptions.some((o) => o.value === defaultCategory)
                  ? defaultCategory
                  : "none"
              }
              items={{
                none: "Uncategorized",
                transfer: "Transfer between accounts",
                ...Object.fromEntries(categoryOptions.map((o) => [o.value, o.label])),
              }}
            >
              <SelectTrigger id="txn-category" className="w-full">
                <SelectValue placeholder="Uncategorized" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Uncategorized</SelectItem>
                <SelectItem value="transfer">Transfer between accounts</SelectItem>
                {categoryOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="txn-note">Note</Label>
            <Textarea id="txn-note" name="note" defaultValue={transaction?.note ?? ""} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            {isEdit && (
              <button
                type="button"
                className="mr-auto text-sm text-destructive"
                onClick={async () => {
                  await deleteTransaction(transaction.id);
                  setOpen(false);
                }}
              >
                Delete
              </button>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
