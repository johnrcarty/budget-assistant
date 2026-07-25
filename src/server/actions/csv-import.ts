"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db/client";
import { accounts, transactions, transactionExclusions } from "@/server/db/schema";
import { getCurrentHousehold } from "@/server/lib/dal";
import { adjustAccountBalance } from "@/server/lib/account-balance";
import { applyRulesToUncategorized } from "@/server/lib/categorize";

const rowSchema = z.object({
  postedDate: z.iso.date(),
  description: z.string().trim().min(1).max(300),
  amountCents: z.number().int(),
});

const importSchema = z.object({
  accountId: z.uuid(),
  rows: z.array(rowSchema).min(1).max(5000),
});

// Bank CSVs don't carry a stable id the way SimpleFin does, so one is
// derived from the row's own content (date + description + amount). Two
// genuinely different transactions that happen to share all three - same
// day, same merchant string, same amount - will collide and the second is
// silently skipped as a "duplicate". That's a real limitation of
// content-based dedup, not a bug, and is what makes re-importing the same
// file (or an overlapping date range) safe by default.
function contentHash(postedDate: string, description: string, amountCents: number): string {
  return createHash("sha256")
    .update(`${postedDate}|${description}|${amountCents}`)
    .digest("hex");
}

export interface ImportResult {
  imported: number;
  skippedDuplicates: number;
}

export async function importTransactionsCsv(
  accountId: string,
  rows: { postedDate: string; description: string; amountCents: number }[],
): Promise<ImportResult> {
  const householdId = await getCurrentHousehold();
  const input = importSchema.parse({ accountId, rows });

  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, input.accountId))
    .limit(1);
  if (!account || account.householdId !== householdId) {
    throw new Error("Account not found");
  }

  // Content hashes the user has deleted before - re-importing an overlapping
  // file must not resurrect them (see transactionExclusions). They count as
  // duplicates in the result, same as rows already present.
  const exclusionRows = await db
    .select({ externalId: transactionExclusions.externalId })
    .from(transactionExclusions)
    .where(
      and(
        eq(transactionExclusions.accountId, input.accountId),
        eq(transactionExclusions.source, "csv_import"),
      ),
    );
  const excludedHashes = new Set(exclusionRows.map((row) => row.externalId));

  let imported = 0;
  let netDelta = 0;

  await db.transaction(async (tx) => {
    for (const row of input.rows) {
      const externalId = contentHash(row.postedDate, row.description, row.amountCents);
      if (excludedHashes.has(externalId)) continue;

      const inserted = await tx
        .insert(transactions)
        .values({
          householdId,
          accountId: input.accountId,
          amountCents: row.amountCents,
          description: row.description,
          postedDate: row.postedDate,
          source: "csv_import",
          externalId,
        })
        .onConflictDoNothing({
          target: [transactions.accountId, transactions.source, transactions.externalId],
        })
        .returning({ id: transactions.id });

      if (inserted.length > 0) {
        imported += 1;
        netDelta += row.amountCents;
      }
    }

    await adjustAccountBalance(tx, input.accountId, netDelta);
  });

  // Categorization rules run over the fresh rows (and any backlog).
  await applyRulesToUncategorized(householdId);

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/accounts");

  return { imported, skippedDuplicates: input.rows.length - imported };
}
