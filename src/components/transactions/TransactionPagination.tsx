"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PAGE_SIZES = [10, 20, 50] as const;

export function TransactionPagination({
  page,
  pageSize,
  totalCount,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  function goToPage(nextPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(nextPage));
    router.push(`${pathname}?${params.toString()}`);
  }

  function changePageSize(nextSize: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("pageSize", nextSize);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  if (totalCount === 0) return null;

  const rangeStart = (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, totalCount);

  return (
    <div className="flex items-center justify-between gap-3 py-4 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span>Show</span>
        <Select
          value={String(pageSize)}
          onValueChange={(v) => v && changePageSize(v)}
          items={Object.fromEntries(PAGE_SIZES.map((size) => [String(size), String(size)]))}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <span className="text-muted-foreground">
        {rangeStart}–{rangeEnd} of {totalCount}
      </span>

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => goToPage(page - 1)}
          className="flex size-8 items-center justify-center rounded-md border disabled:opacity-40"
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= totalPages}
          onClick={() => goToPage(page + 1)}
          className="flex size-8 items-center justify-center rounded-md border disabled:opacity-40"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
