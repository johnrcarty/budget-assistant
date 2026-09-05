import { Home, KeyRound } from "lucide-react";
import { requireOwner } from "@/server/lib/dal";
import { listMembers } from "@/server/db/queries/members";
import { getActivePersons } from "@/server/db/queries/people";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MemberDialog } from "@/components/members/MemberDialog";

export default async function MembersSettingsPage() {
  const { householdId, userId } = await requireOwner();
  const [members, persons] = await Promise.all([
    listMembers(householdId),
    getActivePersons(householdId),
  ]);

  const pending = members.filter((m) => m.role === null);
  const admitted = members.filter((m) => m.role !== null);

  // A person can be linked to one login; offer each member the unlinked
  // persons plus whichever one is already theirs.
  const choicesFor = (member: (typeof members)[number]) =>
    persons
      .filter((p) => p.userId === null || p.id === member.personId)
      .map((p) => ({ id: p.id, name: p.name }));

  const renderCard = (member: (typeof members)[number]) => (
    <MemberDialog
      key={member.userId}
      member={member}
      persons={choicesFor(member)}
      isSelf={member.userId === userId}
      triggerClassName="block w-full text-left"
      trigger={
        <Card>
          <CardContent className="flex items-center gap-3">
            {member.haUserId ? (
              <Home className="size-5 shrink-0 text-primary" aria-label="Home Assistant login" />
            ) : (
              <KeyRound className="size-5 shrink-0 text-primary" aria-label="Password login" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{member.name ?? member.email}</div>
              <div className="truncate text-sm text-muted-foreground">
                {member.personName ? `Person: ${member.personName}` : "No person linked"}
                {member.userId === userId && " · you"}
              </div>
            </div>
            <Badge variant={member.role === "owner" ? "default" : "secondary"}>
              {member.role === null ? "Pending" : member.role === "owner" ? "Owner" : "Member"}
            </Badge>
          </CardContent>
        </Card>
      }
    />
  );

  return (
    <div>
      <AppHeader title="Members" backHref="/more" />
      <div className="flex flex-col gap-4 p-4 pt-0">
        <p className="text-sm text-muted-foreground">
          Anyone who opens this add-on from Home Assistant shows up here. Link each login to a
          person to let them in; until then they see a waiting screen.
        </p>

        {pending.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground">Waiting to be added</h2>
            {pending.map(renderCard)}
          </section>
        )}

        <section className="flex flex-col gap-3">
          {pending.length > 0 && (
            <h2 className="text-sm font-semibold text-muted-foreground">Household</h2>
          )}
          {admitted.map(renderCard)}
        </section>
      </div>
    </div>
  );
}
