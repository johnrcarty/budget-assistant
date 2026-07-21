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
import type { accounts, budgetLineItems, transactions } from "@/server/db/schema";

type Account = typeof accounts.$inferSelect;
type LineItem = typeof budgetLineItems.$inferSelect;
type Transaction = typeof transactions.$inferSelect;

export function TransactionDialog({
  trigger,
  triggerClassName,
  accounts,
  lineItems,
  transaction,
}: {
  trigger: React.ReactNode;
  triggerClassName?: string;
  accounts: Account[];
  lineItems: LineItem[];
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
  const defaultAmount = transaction
    ? (Math.abs(transaction.amountCents) / 100).toFixed(2)
    : "";

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
              <Select name="accountId" defaultValue={accounts[0]?.id} required>
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
            <Select name="type" defaultValue={defaultType}>
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
            <Label htmlFor="txn-category">Category</Label>
            <Select
              name="budgetLineItemId"
              defaultValue={transaction?.budgetLineItemId ?? "none"}
            >
              <SelectTrigger id="txn-category" className="w-full">
                <SelectValue placeholder="Uncategorized" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Uncategorized</SelectItem>
                {lineItems.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
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
