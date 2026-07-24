import { AppHeader } from "@/components/layout/AppHeader";
import { RestoreBackupCard } from "@/components/more/RestoreBackupCard";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { verifySession } from "@/server/lib/dal";

export default async function BackupPage() {
  await verifySession();

  return (
    <div>
      <AppHeader title="Backup & Restore" backHref="/more" />
      <div className="flex flex-col gap-4 p-4">
        <Card>
          <CardContent>
            <h2 className="pb-2 font-bold">Download a backup</h2>
            <p className="pb-4 text-sm text-muted-foreground">
              Creates a fresh full backup of the database — accounts, transactions,
              budgets, debts, everything — and downloads it as a <code>.dump</code> file.
              Server secrets (encryption keys, passwords) are not included. The
              server&apos;s scheduled daily backups keep running regardless.
            </p>
            {/* Plain anchor, not <Link>: this is a file download served by a
                Route Handler, not a client-side navigation. */}
            <a
              href="/api/backup/download"
              download
              className={buttonVariants({ className: "w-fit" })}
            >
              Download backup
            </a>
          </CardContent>
        </Card>
        <RestoreBackupCard />
      </div>
    </div>
  );
}
