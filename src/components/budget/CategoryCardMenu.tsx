"use client";

import { useActionState, useState, useTransition } from "react";
import { Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  archiveCategoryGroup,
  renameCategoryGroup,
} from "@/server/actions/category-groups";

// Overflow menu for a category's secondary actions. The rename dialog is a
// sibling of the menu (not nested in its popup) so it survives the menu
// closing when an item is picked.
export function CategoryCardMenu({
  groupId,
  groupName,
}: {
  groupId: string;
  groupName: string;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [archiving, startArchive] = useTransition();
  const [error, renameAction, renaming] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await renameCategoryGroup(groupId, formData);
        setRenameOpen(false);
        return undefined;
      } catch {
        return "Couldn't rename that group. Try a different name.";
      }
    },
    undefined,
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${groupName} options`}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => setRenameOpen(true)}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={archiving}
            onClick={() => startArchive(() => archiveCategoryGroup(groupId))}
          >
            {archiving ? "Archiving…" : "Archive"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Group</DialogTitle>
          </DialogHeader>
          <form action={renameAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`rename-${groupId}`}>Name</Label>
              <Input
                id={`rename-${groupId}`}
                name="name"
                defaultValue={groupName}
                required
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={renaming}>
                {renaming ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
