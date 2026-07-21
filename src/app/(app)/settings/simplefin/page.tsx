import { getCurrentHousehold } from "@/server/lib/dal";
import {
  getSimplefinConnection,
  getConnectionAccounts,
  getLastSyncRun,
} from "@/server/db/queries/simplefin";
import { getAccounts } from "@/server/db/queries/accounts";
import { formatCents } from "@/server/lib/money";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConnectSimplefinForm } from "@/components/accounts/ConnectSimplefinForm";
import { MapAccountForm } from "@/components/accounts/MapAccountForm";
import { triggerSync, disconnectSimplefin } from "@/server/actions/simplefin";

export default async function SimplefinSettingsPage() {
  const householdId = await getCurrentHousehold();
  const connection = await getSimplefinConnection(householdId);

  return (
    <div>
      <AppHeader title="Bank Sync" backHref="/accounts" />

      <div className="flex flex-col gap-4 p-4">
        {!connection ? (
          <ConnectSimplefinForm />
        ) : (
          <ConnectedView householdId={householdId} connection={connection} />
        )}
      </div>
    </div>
  );
}

async function ConnectedView({
  householdId,
  connection,
}: {
  householdId: string;
  connection: NonNullable<Awaited<ReturnType<typeof getSimplefinConnection>>>;
}) {
  const [connectionAccounts, lastRun, localAccounts] = await Promise.all([
    getConnectionAccounts(connection.id),
    getLastSyncRun(connection.id),
    getAccounts(householdId),
  ]);

  const manualAccounts = localAccounts.filter((a) => a.isManual);

  return (
    <>
      <Card>
        <CardContent className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 font-medium">
              Connection status
              <Badge variant={connection.status === "active" ? "default" : "destructive"}>
                {connection.status}
              </Badge>
            </div>
            {lastRun && (
              <div className="text-sm text-muted-foreground">
                Last synced {new Date(lastRun.startedAt).toLocaleString()} ·{" "}
                {lastRun.status}
              </div>
            )}
            {connection.lastError && (
              <div className="text-sm text-destructive">{connection.lastError}</div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <form action={triggerSync.bind(null, connection.id)}>
              <button type="submit" className="text-sm font-medium text-primary">
                Sync now
              </button>
            </form>
            <form action={disconnectSimplefin.bind(null, connection.id)}>
              <button
                type="submit"
                className="text-sm text-muted-foreground hover:text-destructive"
              >
                Disconnect
              </button>
            </form>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <h2 className="pb-2 font-bold">Accounts</h2>
          {connectionAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No accounts found yet — try Sync now above.
            </p>
          ) : (
            connectionAccounts.map(({ connectionAccount, linkedAccountName }) =>
              linkedAccountName ? (
                <div
                  key={connectionAccount.id}
                  className="flex items-center justify-between border-b py-3 last:border-b-0"
                >
                  <span className="font-medium">{linkedAccountName}</span>
                  <span className="text-sm text-muted-foreground">
                    {connectionAccount.lastSyncedBalanceCents !== null
                      ? formatCents(connectionAccount.lastSyncedBalanceCents)
                      : "—"}
                  </span>
                </div>
              ) : (
                <MapAccountForm
                  key={connectionAccount.id}
                  connectionAccountId={connectionAccount.id}
                  simplefinAccountName={
                    connectionAccount.simplefinAccountName ??
                    connectionAccount.simplefinAccountId
                  }
                  balanceCents={connectionAccount.lastSyncedBalanceCents}
                  existingAccounts={manualAccounts}
                />
              ),
            )
          )}
        </CardContent>
      </Card>
    </>
  );
}
