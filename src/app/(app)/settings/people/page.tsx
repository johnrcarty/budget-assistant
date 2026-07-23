import { getCurrentHousehold } from "@/server/lib/dal";
import { getActivePersons, getArchivedPersons } from "@/server/db/queries/people";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AddPersonDialog } from "@/components/people/AddPersonDialog";
import { EditPersonDialog } from "@/components/people/EditPersonDialog";

const PERSON_TYPE_LABELS: Record<string, string> = {
  adult: "Adult",
  child: "Child",
};

export default async function PeopleSettingsPage() {
  const householdId = await getCurrentHousehold();
  const [people, archived] = await Promise.all([
    getActivePersons(householdId),
    getArchivedPersons(householdId),
  ]);

  return (
    <div>
      <AppHeader title="People" backHref="/more" rightAction={<AddPersonDialog />} />

      <div className="flex flex-col gap-4 p-4 pt-0">
        <p className="text-sm text-muted-foreground">
          People you add here can be linked to accounts (individual or joint), paycheck
          slots, and annual income entries.
        </p>

        {people.length === 0 && (
          <p className="pt-8 text-center text-muted-foreground">
            No people yet — tap + above to add one.
          </p>
        )}

        <div className="flex flex-col gap-3">
          {people.map((person) => (
            <EditPersonDialog
              key={person.id}
              person={person}
              triggerClassName="block w-full text-left"
              trigger={
                <Card>
                  <CardContent className="flex items-center gap-3">
                    <span
                      className="size-4 shrink-0 rounded-full"
                      style={{
                        backgroundColor: person.color ? `var(--${person.color})` : undefined,
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{person.name}</div>
                    </div>
                    <Badge variant="secondary">
                      {PERSON_TYPE_LABELS[person.personType] ?? person.personType}
                    </Badge>
                  </CardContent>
                </Card>
              }
            />
          ))}
        </div>

        {archived.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">
              Archived ({archived.length})
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              {archived.map((person) => (
                <EditPersonDialog
                  key={person.id}
                  person={person}
                  triggerClassName="block w-full text-left"
                  trigger={
                    <Card className="opacity-70">
                      <CardContent className="flex items-center gap-3">
                        <span
                          className="size-4 shrink-0 rounded-full"
                          style={{
                            backgroundColor: person.color ? `var(--${person.color})` : undefined,
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{person.name}</div>
                        </div>
                        <Badge variant="secondary">
                          {PERSON_TYPE_LABELS[person.personType] ?? person.personType}
                        </Badge>
                      </CardContent>
                    </Card>
                  }
                />
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
