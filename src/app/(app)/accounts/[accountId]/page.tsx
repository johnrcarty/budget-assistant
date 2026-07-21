import { notFound } from "next/navigation";
import { getCurrentHousehold } from "@/server/lib/dal";
import { getDebtDetail } from "@/server/db/queries/debt";
import { formatCents } from "@/server/lib/money";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card, CardContent } from "@/components/ui/card";
import { DebtInfoForm } from "@/components/accounts/DebtInfoForm";
import { DebtBalanceForm } from "@/components/accounts/DebtBalanceForm";
import { DebtTermsForm } from "@/components/accounts/DebtTermsForm";

const STALE_BALANCE_DAYS = 30;

export default async function DebtAccountPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  const householdId = await getCurrentHousehold();
  const detail = await getDebtDetail(householdId, accountId);

  if (!detail) notFound();

  const { account, terms, latestBalance, balanceHistory, termsHistory, projection } = detail;

  const balanceAgeDays = latestBalance
    ? Math.floor(
        (new Date().getTime() - new Date(latestBalance.asOfDate).getTime()) / 86_400_000,
      )
    : null;
  const isStale = balanceAgeDays !== null && balanceAgeDays > STALE_BALANCE_DAYS;

  const paidOffCents =
    account.originalBalanceCents && latestBalance
      ? account.originalBalanceCents - latestBalance.balanceCents
      : null;

  return (
    <div>
      <AppHeader title="Debt Details" backHref="/accounts" />

      <div className="flex flex-col gap-4 p-4">
        {isStale && (
          <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            The balance may be out of date (last updated {balanceAgeDays} days ago). Update
            the current balance to account for any fees and interest, or save it below if
            it&rsquo;s still correct.
          </div>
        )}

        <DebtInfoForm account={account} />

        <Card>
          <CardContent>
            <h2 className="pb-1 font-bold">Current Balance</h2>
            {paidOffCents !== null && (
              <p className="pb-3 text-sm text-muted-foreground">
                {formatCents(paidOffCents)} paid off so far
              </p>
            )}
            <DebtBalanceForm accountId={account.id} latestBalance={latestBalance} />
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h2 className="pb-3 font-bold">Terms</h2>
            <DebtTermsForm accountId={account.id} currentTerms={terms} />
          </CardContent>
        </Card>

        {projection && (
          <Card>
            <CardContent>
              <h2 className="pb-2 font-bold">Payoff Projection</h2>
              {projection.monthsToPayoff !== null ? (
                <p className="text-sm">
                  Paid off in <span className="font-medium">{projection.monthsToPayoff} months</span>
                  {projection.payoffDate && (
                    <> (around {new Date(projection.payoffDate).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })})</>
                  )}
                  {projection.totalInterestCents !== null && (
                    <> — about {formatCents(projection.totalInterestCents)} in interest</>
                  )}
                  .
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {projection.note ?? "Not enough information to project a payoff date yet."}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {balanceHistory.length > 0 && (
          <Card>
            <CardContent>
              <h2 className="pb-2 font-bold">Balance History</h2>
              {balanceHistory.map((snapshot) => (
                <div
                  key={snapshot.id}
                  className="flex items-center justify-between border-b py-2 text-sm last:border-b-0"
                >
                  <span className="text-muted-foreground">
                    {new Date(snapshot.asOfDate).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                    {snapshot.source === "manual" ? " · manual" : ""}
                  </span>
                  <span className="font-medium">{formatCents(snapshot.balanceCents)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {termsHistory.length > 1 && (
          <Card>
            <CardContent>
              <h2 className="pb-2 font-bold">Terms History</h2>
              {termsHistory.map((t) => (
                <div key={t.id} className="border-b py-2 text-sm last:border-b-0">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Effective{" "}
                      {new Date(t.effectiveDate).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        timeZone: "UTC",
                      })}
                    </span>
                    <span>{t.termsType}</span>
                  </div>
                  {t.servicerName && (
                    <div className="text-muted-foreground">{t.servicerName}</div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
