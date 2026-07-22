// Seeds a group of individual student loan accounts (one liability account
// per loan, each with a manual balance snapshot and an APR-only terms
// version) under a display account group.
//
//   npx tsx --env-file=.env.local scripts/seed-student-loans.ts <householdId> \
//     [--group "Student Loans"] [--file loans.json]
//
// The built-in EXAMPLE_LOANS below is placeholder data for local testing -
// always pass --file with a real statement's loans (see scripts/README.md)
// when seeding an actual household. Loan groups/balances are illustrative
// only. Pass --file with a JSON array of { name, outstandingBalanceCents,
// aprBps, asOfDate } to seed any household's actual loan set.
//
// Terms rows deliberately carry NO payment fields: use this for loans in
// forbearance at $0/month, so the payoff simulator reports "needs terms"
// rather than pretend a payment exists.
import { readFileSync } from "fs";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  accounts,
  accountGroups,
  debtBalanceSnapshots,
  debtTermsVersions,
} from "@/server/db/schema";

interface SeedLoan {
  name: string;
  outstandingBalanceCents: number;
  aprBps: number;
  asOfDate: string; // YYYY-MM-DD
}

// Placeholder data for local dev/testing only - not any real household's
// actual loans. Always pass --file with real statement data in production.
const EXAMPLE_AS_OF = "2026-01-01";
const EXAMPLE_LOANS: SeedLoan[] = [
  { name: "Example A — Stafford Sub", outstandingBalanceCents: 450000, aprBps: 550, asOfDate: EXAMPLE_AS_OF },
  { name: "Example B — Stafford Unsub", outstandingBalanceCents: 375000, aprBps: 650, asOfDate: EXAMPLE_AS_OF },
  { name: "Example C — Direct Sub", outstandingBalanceCents: 390000, aprBps: 400, asOfDate: EXAMPLE_AS_OF },
  { name: "Example D — Direct Unsub", outstandingBalanceCents: 265000, aprBps: 400, asOfDate: EXAMPLE_AS_OF },
];

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const householdId = process.argv[2];
  if (!householdId || householdId.startsWith("--")) {
    console.error(
      'Usage: npx tsx --env-file=.env.local scripts/seed-student-loans.ts <householdId> [--group "Name"] [--file loans.json]',
    );
    process.exit(1);
  }
  const groupName = argValue("--group") ?? "Student Loans";
  const file = argValue("--file");
  const loans: SeedLoan[] = file
    ? JSON.parse(readFileSync(file, "utf8"))
    : EXAMPLE_LOANS;

  // Get-or-create the group; refuse to double-seed a populated group.
  let [group] = await db
    .insert(accountGroups)
    .values({ householdId, name: groupName })
    .onConflictDoNothing()
    .returning();
  if (!group) {
    [group] = await db
      .select()
      .from(accountGroups)
      .where(
        and(eq(accountGroups.householdId, householdId), eq(accountGroups.name, groupName)),
      )
      .limit(1);
  }
  if (!group) throw new Error("could not create or find the account group");

  const existingMembers = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.accountGroupId, group.id));
  if (existingMembers.length > 0) {
    console.error(
      `Group "${groupName}" already has ${existingMembers.length} accounts — aborting (won't double-seed).`,
    );
    process.exit(1);
  }

  for (const loan of loans) {
    const [account] = await db
      .insert(accounts)
      .values({
        householdId,
        name: loan.name,
        kind: "loan",
        subtype: "student_loan",
        isLiability: true,
        currentBalanceCents: loan.outstandingBalanceCents,
        balanceAsOf: new Date(`${loan.asOfDate}T00:00:00`),
        originalBalanceCents: loan.outstandingBalanceCents,
        accountGroupId: group.id,
        isManual: true,
      })
      .returning();

    await db.insert(debtBalanceSnapshots).values({
      accountId: account.id,
      asOfDate: loan.asOfDate,
      balanceCents: loan.outstandingBalanceCents,
      source: "manual",
      note: "Seeded from Nelnet statement",
    });

    await db.insert(debtTermsVersions).values({
      accountId: account.id,
      effectiveDate: loan.asOfDate,
      termsType: "installment",
      aprBps: loan.aprBps,
      paymentFrequency: "monthly",
      servicerName: "Nelnet",
      note: "SAVE forbearance — $0/month",
    });

    console.log(
      `  ${loan.name}  $${(loan.outstandingBalanceCents / 100).toFixed(2)}  ${(loan.aprBps / 100).toFixed(2)}%`,
    );
  }

  const totalCents = loans.reduce((sum, l) => sum + l.outstandingBalanceCents, 0);
  const weightedAprBps =
    loans.reduce((sum, l) => sum + l.outstandingBalanceCents * l.aprBps, 0) / totalCents;
  console.log(
    `\nSeeded ${loans.length} loans into "${groupName}": total $${(totalCents / 100).toFixed(2)}, weighted avg APR ${(weightedAprBps / 100).toFixed(2)}%`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
