import { getCurrentHousehold } from "@/server/lib/dal";
import { getActivePersons } from "@/server/db/queries/people";
import { AppHeader } from "@/components/layout/AppHeader";
import { IncomeImportWizard } from "@/components/income/IncomeImportWizard";

export default async function IncomeImportPage() {
  const householdId = await getCurrentHousehold();
  const persons = await getActivePersons(householdId);

  return (
    <div>
      <AppHeader title="Import Income CSV" backHref="/income" />
      <div className="px-4 pb-4">
        <IncomeImportWizard persons={persons.map((p) => ({ id: p.id, name: p.name }))} />
      </div>
    </div>
  );
}
