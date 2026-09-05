"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  MEMBER_ROLES,
  createPersonForMember,
  removeMember as removeMemberQuery,
  setMemberPerson,
  setMemberRole,
} from "@/server/db/queries/members";
import { personTypeEnum } from "@/server/db/schema";
import { requireOwner } from "@/server/lib/dal";

const PATHS = ["/settings/members", "/settings/people", "/more"];
function revalidate() {
  for (const path of PATHS) revalidatePath(path);
}

const uuid = z.string().uuid();

const saveSchema = z.object({
  userId: uuid,
  role: z.enum(MEMBER_ROLES),
  // "" = no person · "__new__" = create one from the fields below · else a person id
  personId: z.string(),
  newPersonName: z.string().trim().max(80).optional(),
  newPersonType: z.enum(personTypeEnum.enumValues).optional(),
});

// One form for admit + link + role, since a pending user always needs all
// three decided at once. Owner-only; an owner can't demote themself past
// the last-owner guard in the query layer.
export async function saveMember(formData: FormData) {
  const { householdId } = await requireOwner();
  const input = saveSchema.parse({
    userId: formData.get("userId"),
    role: formData.get("role"),
    personId: formData.get("personId") ?? "",
    newPersonName: formData.get("newPersonName") ?? undefined,
    newPersonType: formData.get("newPersonType") ?? undefined,
  });

  if (input.personId === "__new__") {
    if (!input.newPersonName) throw new Error("Give the new person a name.");
    await createPersonForMember(
      householdId,
      input.userId,
      { name: input.newPersonName, personType: input.newPersonType ?? "adult" },
      input.role,
    );
  } else {
    const personId = input.personId ? uuid.parse(input.personId) : null;
    await setMemberPerson(householdId, input.userId, personId, input.role);
  }
  // setMemberPerson only sets the role on first admission; an existing
  // member's role change goes through here.
  await setMemberRole(householdId, input.userId, input.role);

  revalidate();
}

export async function removeMember(userId: string) {
  const { householdId, userId: self } = await requireOwner();
  if (userId === self) throw new Error("You can't remove your own access.");
  await removeMemberQuery(householdId, uuid.parse(userId));
  revalidate();
}
