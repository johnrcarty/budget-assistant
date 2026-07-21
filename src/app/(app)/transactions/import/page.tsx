import { getCurrentHousehold } from "@/server/lib/dal";
import { getAccounts } from "@/server/db/queries/accounts";
import { AppHeader } from "@/components/layout/AppHeader";
import { ImportCsvWizard } from "@/components/transactions/ImportCsvWizard";

export default async function ImportTransactionsPage() {
  const householdId = await getCurrentHousehold();
  const accountList = await getAccounts(householdId);

  return (
    <div>
      <AppHeader title="Import CSV" backHref="/transactions" />
      <div className="px-4 pb-4">
        {accountList.length === 0 ? (
          <p className="pt-8 text-center text-muted-foreground">
            Add an account first (Accounts tab) before importing transactions.
          </p>
        ) : (
          <ImportCsvWizard accountList={accountList} />
        )}
      </div>
    </div>
  );
}
