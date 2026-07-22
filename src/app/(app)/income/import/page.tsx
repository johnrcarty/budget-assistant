import { AppHeader } from "@/components/layout/AppHeader";
import { IncomeImportWizard } from "@/components/income/IncomeImportWizard";

export default function IncomeImportPage() {
  return (
    <div>
      <AppHeader title="Import Income CSV" backHref="/income" />
      <div className="px-4 pb-4">
        <IncomeImportWizard />
      </div>
    </div>
  );
}
