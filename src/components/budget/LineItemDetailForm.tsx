"use client";

import { useActionState } from "react";
import { Check, CircleDollarSign, Calendar, Target, Star, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { updateLineItem, deleteLineItem } from "@/server/actions/budget-line-items";
import { CategoryIcon } from "./category-icons";
import type { budgetLineItems, categoryGroups } from "@/server/db/schema";

async function saveAction(
  lineItemId: string,
  _prevState: string | undefined,
  formData: FormData,
) {
  formData.set("isFavorite", formData.get("isFavorite") === "on" ? "true" : "false");
  try {
    await updateLineItem(lineItemId, formData);
    return undefined;
  } catch {
    return "Couldn't save those changes.";
  }
}

function FieldWithIcon({
  icon: Icon,
  children,
}: {
  icon: typeof CircleDollarSign;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex items-center">
      <Icon className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
      {children}
    </div>
  );
}

export function LineItemDetailForm({
  item,
  categoryGroupList,
}: {
  item: typeof budgetLineItems.$inferSelect;
  categoryGroupList: (typeof categoryGroups.$inferSelect)[];
}) {
  const [error, formAction, pending] = useActionState(
    saveAction.bind(null, item.id),
    undefined,
  );

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={item.name} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="categoryGroupId">Category</Label>
              <Select
                name="categoryGroupId"
                defaultValue={item.categoryGroupId}
                items={Object.fromEntries(
                  categoryGroupList.map((group) => [
                    group.id,
                    <span key={group.id} className="flex items-center gap-1.5">
                      <CategoryIcon
                        name={group.name}
                        storedIcon={group.icon}
                        className="size-4 text-muted-foreground"
                      />
                      {group.name}
                    </span>,
                  ]),
                )}
              >
                <SelectTrigger id="categoryGroupId" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categoryGroupList.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      <CategoryIcon
                        name={group.name}
                        storedIcon={group.icon}
                        className="size-4 text-muted-foreground"
                      />
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="plannedAmount">Planned amount</Label>
              <FieldWithIcon icon={CircleDollarSign}>
                <Input
                  id="plannedAmount"
                  name="plannedAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  className="pl-9"
                  defaultValue={(item.plannedAmountCents / 100).toFixed(2)}
                />
              </FieldWithIcon>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="dueDay">Due day of month</Label>
              <FieldWithIcon icon={Calendar}>
                <Input
                  id="dueDay"
                  name="dueDay"
                  type="number"
                  min="1"
                  max="31"
                  className="pl-9"
                  defaultValue={item.dueDay ?? ""}
                  placeholder="No due date"
                />
              </FieldWithIcon>
              <p className="text-xs text-muted-foreground">
                Repeats {item.recurrenceRule}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fundTarget">Fund goal (optional)</Label>
              <FieldWithIcon icon={Target}>
                <Input
                  id="fundTarget"
                  name="fundTarget"
                  type="number"
                  step="0.01"
                  min="0"
                  className="pl-9"
                  defaultValue={
                    item.fundTargetCents ? (item.fundTargetCents / 100).toFixed(2) : ""
                  }
                  placeholder="No goal set"
                />
              </FieldWithIcon>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="isFavorite" className="flex items-center gap-2">
                <Star className="size-4 text-muted-foreground" />
                Favorite
              </Label>
              <Switch
                id="isFavorite"
                name="isFavorite"
                defaultChecked={item.isFavorite}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-2">
          <Label htmlFor="note">Note</Label>
          <Textarea
            id="note"
            name="note"
            defaultValue={item.note ?? ""}
            placeholder="Add a note"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={pending} className="gap-2">
          <Check className="size-4" />
          {pending ? "Saving…" : "Save"}
        </Button>
      </form>

      <form action={deleteLineItem.bind(null, item.id)}>
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium text-destructive"
        >
          <Trash2 className="size-4" />
          Delete Item
        </button>
      </form>
    </div>
  );
}
