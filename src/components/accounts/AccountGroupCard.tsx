"use client";

import { useActionState, useState } from "react";
import { ChevronRight, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { renameAccountGroup, deleteAccountGroup } from "@/server/actions/account-groups";
import { formatCents } from "@/server/lib/money";
import { EditAccountDialog } from "./EditAccountDialog";
import { TrendDialog } from "./TrendDialog";
import { KIND_LABELS } from "./account-kinds";

export interface GroupMember {
  id: string;
  name: string;
  kind: string;
  isLiability: boolean;
  isManual: boolean;
  currentBalanceCents: number | null;
  originalBalanceCents: number | null;
  accountGroupId: string | null;
}

// One collapsible rollup card per account group: summed balance (tappable
// trend, like every other value on the page), weighted-average APR across
// the members that have terms, and the member rows inside - each keeping
// the standard edit-on-name / trend-on-balance affordances.
export function AccountGroupCard({
  group,
  members,
  points,
  seriesByMember,
  summedSeries,
  aprByAccount,
  isLiability,
  groups,
}: {
  group: { id: string; name: string };
  members: GroupMember[];
  points: string[];
  seriesByMember: Record<string, number[]>;
  summedSeries: number[];
  aprByAccount: Record<string, number | null>;
  isLiability: boolean;
  groups: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);

  const totalCents = members.reduce((sum, m) => sum + (m.currentBalanceCents ?? 0), 0);

  // Weighted-average APR over members with known APR and a positive
  // balance: sum(balance x aprBps) / sum(balance).
  const weighted = members.filter(
    (m) => aprByAccount[m.id] != null && (m.currentBalanceCents ?? 0) > 0,
  );
  const weightedBalance = weighted.reduce((sum, m) => sum + (m.currentBalanceCents ?? 0), 0);
  const avgAprBps =
    weightedBalance > 0
      ? weighted.reduce(
          (sum, m) => sum + (m.currentBalanceCents ?? 0) * (aprByAccount[m.id] ?? 0),
          0,
        ) / weightedBalance
      : null;
  const missingApr = members.length - weighted.length;

  const countNoun = isLiability ? (members.length === 1 ? "loan" : "loans") : "accounts";
  const subtitleParts = [`${members.length} ${countNoun}`];
  if (avgAprBps !== null) {
    subtitleParts.push(`${(avgAprBps / 100).toFixed(2)}% avg APR`);
    if (missingApr > 0) subtitleParts.push(`${missingApr} without APR`);
  }

  return (
    <Card>
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
          >
            <ChevronRight
              className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                open ? "rotate-90" : ""
              }`}
            />
            <div className="min-w-0">
              <div className="truncate font-medium">{group.name}</div>
              <div className="text-sm text-muted-foreground">
                {subtitleParts.join(" · ")}
              </div>
            </div>
          </button>

          <div className="flex shrink-0 items-center gap-3">
            <TrendDialog
              title={group.name}
              points={points}
              series={summedSeries}
              isLiability={isLiability}
              trigger={
                <span
                  className={`font-medium ${isLiability ? "text-destructive" : ""}`}
                >
                  {formatCents(totalCents)}
                </span>
              }
            />
            <GroupSettingsDialog group={group} />
          </div>
        </div>

        {open && (
          <div className="mt-2 flex flex-col pl-2">
            {members.map((member) => {
              const aprBps = aprByAccount[member.id];
              return (
                <div
                  key={member.id}
                  className="flex items-center justify-between gap-3 border-t py-3 last:pb-0"
                >
                  <EditAccountDialog
                    account={member}
                    groups={groups}
                    triggerClassName="min-w-0 flex-1 text-left"
                    trigger={
                      <div>
                        <div className="truncate text-sm font-medium">{member.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {KIND_LABELS[member.kind] ?? member.kind}
                          {aprBps != null && ` · ${(aprBps / 100).toFixed(2)}% APR`}
                        </div>
                      </div>
                    }
                  />
                  <TrendDialog
                    title={member.name}
                    points={points}
                    series={seriesByMember[member.id] ?? points.map(() => 0)}
                    isLiability={member.isLiability}
                    triggerClassName="shrink-0"
                    trigger={
                      <span
                        className={`text-sm font-medium ${
                          member.isLiability ? "text-destructive" : ""
                        }`}
                      >
                        {formatCents(member.currentBalanceCents ?? 0)}
                      </span>
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GroupSettingsDialog({ group }: { group: { id: string; name: string } }) {
  const [open, setOpen] = useState(false);
  const [error, formAction, pending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await renameAccountGroup(group.id, formData);
        setOpen(false);
        return undefined;
      } catch {
        return "Couldn't rename the group.";
      }
    },
    undefined,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger aria-label={`Group settings for ${group.name}`}>
        <Settings2 className="size-4 text-muted-foreground" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Group</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="group-name">Name</Label>
            <Input id="group-name" name="name" defaultValue={group.name} required />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
        <form
          action={deleteAccountGroup.bind(null, group.id)}
          className="border-t pt-3"
        >
          <button
            type="submit"
            className="text-sm text-muted-foreground hover:text-destructive"
          >
            Ungroup — accounts keep their own cards
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
