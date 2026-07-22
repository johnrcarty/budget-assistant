// Seeds a group of individual student loan accounts (one liability account
// per loan, each with a manual balance snapshot and an APR-only terms
// version) under a display account group.
//
//   npx tsx --env-file=.env.local scripts/seed-student-loans.ts <householdId> \
//     [--group "Student Loans — John"] [--file loans.json]
//
// The default data set is the owner's Nelnet statement as of 2026-07-21
// (loan groups AA–AN; outstanding balance = principal + accrued interest).
// Pass --file with a JSON array of { name, outstandingBalanceCents, aprBps,
// asOfDate } to seed a different set (e.g. the second spouse's loans).
//
// Terms rows deliberately carry NO payment fields: these loans are in SAVE
// forbearance at $0/month, so the payoff simulator should report
// "needs terms" rather than pretend a payment exists.
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

const NELNET_AS_OF = "2026-07-21";
const NELNET_LOANS: SeedLoan[] = [
  { name: "Nelnet AA — Stafford Sub", outstandingBalanceCents: 449342, aprBps: 560, asOfDate: NELNET_AS_OF },
  { name: "Nelnet AB — Stafford Unsub", outstandingBalanceCents: 375840, aprBps: 680, asOfDate: NELNET_AS_OF },
  { name: "Nelnet AC — Direct Sub", outstandingBalanceCents: 392918, aprBps: 386, asOfDate: NELNET_AS_OF },
  { name: "Nelnet AD — Direct Unsub", outstandingBalanceCents: 265525, aprBps: 386, asOfDate: NELNET_AS_OF },
  { name: "Nelnet AE — Direct Sub", outstandingBalanceCents: 196371, aprBps: 466, asOfDate: NELNET_AS_OF },
  { name: "Nelnet AF — Direct Unsub", outstandingBalanceCents: 135970, aprBps: 466, asOfDate: NELNET_AS_OF },
  { name: "Nelnet AG — Direct Sub", outstandingBalanceCents: 308587, aprBps: 466, asOfDate: NELNET_AS_OF },
  { name: "Nelnet AH — Direct Unsub", outstandingBalanceCents: 666892, aprBps: 466, asOfDate: NELNET_AS_OF },
  { name: "Nelnet AI — Direct Sub", outstandingBalanceCents: 500652, aprBps: 429, asOfDate: NELNET_AS_OF },
  { name: "Nelnet AJ — Direct Unsub", outstandingBalanceCents: 762309, aprBps: 429, asOfDate: NELNET_AS_OF },
  { name: "Nelnet AK — Direct Sub", outstandingBalanceCents: 604369, aprBps: 376, asOfDate: NELNET_AS_OF },
  { name: "Nelnet AL — Direct Unsub", outstandingBalanceCents: 836390, aprBps: 376, asOfDate: NELNET_AS_OF },
  { name: "Nelnet AM — Direct Sub", outstandingBalanceCents: 167498, aprBps: 445, asOfDate: NELNET_AS_OF },
  { name: "Nelnet AN — Direct Unsub", outstandingBalanceCents: 1304531, aprBps: 445, asOfDate: NELNET_AS_OF },
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
  const groupName = argValue("--group") ?? "Student Loans — John";
  const file = argValue("--file");
  const loans: SeedLoan[] = file
    ? JSON.parse(readFileSync(file, "utf8"))
    : NELNET_LOANS;

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
