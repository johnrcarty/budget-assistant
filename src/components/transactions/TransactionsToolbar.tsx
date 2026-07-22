"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { DATE_RANGE_LABELS, isDateRangePreset, type DateRangePreset } from "@/lib/date-range";
import type { accounts } from "@/server/db/schema";

export function TransactionsToolbar({
  accountList,
}: {
  accountList: (typeof accounts.$inferSelect)[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [searchValue, setSearchValue] = useState(searchParams.get("search") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [filterOpen, setFilterOpen] = useState(false);
  const rangeParam = searchParams.get("range") ?? undefined;
  const [range, setRange] = useState<DateRangePreset | "custom">(
    rangeParam === "custom" ? "custom" : isDateRangePreset(rangeParam) ? rangeParam : "30d",
  );
  const [customFrom, setCustomFrom] = useState(searchParams.get("from") ?? "");
  const [customTo, setCustomTo] = useState(searchParams.get("to") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "all");
  const [type, setType] = useState(searchParams.get("type") ?? "all");
  const [categorized, setCategorized] = useState(
    searchParams.get("categorized") === "1"
      ? "yes"
      : searchParams.get("categorized") === "0" || searchParams.get("uncategorized") === "1"
        ? "no"
        : "all",
  );
  const [minAmount, setMinAmount] = useState(searchParams.get("min") ?? "");
  const [maxAmount, setMaxAmount] = useState(searchParams.get("max") ?? "");
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(
    new Set(searchParams.get("accounts")?.split(",").filter(Boolean) ?? []),
  );

  function pushParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    params.delete("page"); // any filter change resets to page 1
    router.push(`${pathname}?${params.toString()}`);
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (searchValue !== (searchParams.get("search") ?? "")) {
        pushParams({ search: searchValue || null });
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue]);

  function applyFilters() {
    pushParams({
      range: range === "30d" ? null : range,
      from: range === "custom" ? customFrom || null : null,
      to: range === "custom" ? customTo || null : null,
      status: status === "all" ? null : status,
      type: type === "all" ? null : type,
      categorized: categorized === "yes" ? "1" : categorized === "no" ? "0" : null,
      uncategorized: null, // legacy spelling of categorized=0; superseded on apply
      min: minAmount || null,
      max: maxAmount || null,
      accounts: selectedAccounts.size > 0 ? [...selectedAccounts].join(",") : null,
    });
    setFilterOpen(false);
  }

  const activeFilterCount =
    (range !== "30d" ? 1 : 0) +
    (status !== "all" ? 1 : 0) +
    (type !== "all" ? 1 : 0) +
    (categorized !== "all" ? 1 : 0) +
    (minAmount || maxAmount ? 1 : 0) +
    (selectedAccounts.size > 0 ? 1 : 0);

  return (
    <div className="flex items-center gap-2 px-4 pb-3">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="Search transactions…"
          className="pl-9"
        />
      </div>

      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogTrigger className="relative flex size-10 shrink-0 items-center justify-center rounded-lg border">
          <SlidersHorizontal className="size-4" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Filter Transactions</DialogTitle>
          </DialogHeader>
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Date range</span>
              <Select
                value={range}
                onValueChange={(v) => v && setRange(v as DateRangePreset | "custom")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DATE_RANGE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom range</SelectItem>
                </SelectContent>
              </Select>
              {range === "custom" && (
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    aria-label="From date"
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <Input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    aria-label="To date"
                  />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Type</span>
              <Select value={type} onValueChange={(v) => v && setType(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="expense">Expenses</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Category</span>
              <Select value={categorized} onValueChange={(v) => v && setCategorized(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="yes">Categorized</SelectItem>
                  <SelectItem value="no">Uncategorized</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Amount</span>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="Min $"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                  aria-label="Minimum amount"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="Max $"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                  aria-label="Maximum amount"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Status</span>
              <Select value={status} onValueChange={(v) => v && setStatus(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="cleared">Cleared</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {accountList.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Accounts</span>
                <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
                  {accountList.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedAccounts.has(a.id)}
                        onCheckedChange={(checked) => {
                          setSelectedAccounts((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(a.id);
                            else next.delete(a.id);
                            return next;
                          });
                        }}
                      />
                      {a.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFilterOpen(false)}>
              Cancel
            </Button>
            <Button onClick={applyFilters}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
