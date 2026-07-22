"use client";

import { useActionState, useState } from "react";
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
import type {
  accounts,
  budgetLineItems,
  incomeLineItems,
  transactions,
} from "@/server/db/schema";

type Account = typeof accounts.$inferSelect;
type LineItem = typeof budgetLineItems.$inferSelect;
type IncomeItem = typeof incomeLineItems.$inferSelect;
type Transaction = typeof transactions.$inferSelect;

export function TransactionDialog({
  trigger,
  triggerClassName,
  accounts,
  lineItems,
  incomeItems = [],
  transaction,
}: {
  trigger: React.ReactNode;
  triggerClassName?: string;
  accounts: Account[];
  lineItems: LineItem[];
  incomeItems?: IncomeItem[];
  transaction?: Transaction;
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
      } catch {
        return "Couldn't save that transaction. Check the amount.";
      }
    },
    undefined,
  );

  const today = new Date().toISOString().slice(0, 10);
  const defaultType = transaction && transaction.amountCents > 0 ? "income" : "expense";
  const [type, setType] = useState<"expense" | "income">(defaultType);
  const defaultAmount = transaction
    ? (Math.abs(transaction.amountCents) / 100).toFixed(2)
    : "";

  // Current category value on an edit, in the combined encoding.
  const defaultCategory = transaction?.isTransfer
    ? "transfer"
    : transaction?.incomeLineItemId
      ? `income:${transaction.incomeLineItemId}`
      : transaction?.budgetLineItemId
        ? `expense:${transaction.budgetLineItemId}`
        : "none";

  // An edited transaction may be linked to a prior month's instance that
  // isn't in this month's option list - synthesize an entry so the dialog
  // doesn't display it as Uncategorized.
  const categoryOptions: { value: string; label: string }[] =
    type === "income"
      ? incomeItems.map((item) => ({ value: `income:${item.id}`, label: item.name }))
      : lineItems.map((item) => ({ value: `expense:${item.id}`, label: item.name }));
  if (
    defaultCategory !== "none" &&
    defaultCategory.startsWith(type === "income" ? "income:" : "expense:") &&
    !categoryOptions.some((o) => o.value === defaultCategory)
  ) {
    categoryOptions.unshift({ value: defaultCategory, label: "(current category)" });
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
