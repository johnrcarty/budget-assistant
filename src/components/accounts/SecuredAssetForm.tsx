"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { linkSecuredAsset } from "@/server/actions/debt";

export function SecuredAssetForm({
  accountId,
  assetOptions,
}: {
  accountId: string;
  assetOptions: { id: string; name: string }[];
}) {
  const [error, formAction, pending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await linkSecuredAsset(accountId, formData);
        return undefined;
      } catch {
        return "Couldn't link that account.";
      }
    },
    undefined,
  );

  if (assetOptions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Add a Property or Vehicle account first.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Select
          name="assetAccountId"
          items={Object.fromEntries(assetOptions.map((a) => [a.id, a.name]))}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choose an asset account" />
          </SelectTrigger>
          <SelectContent>
            {assetOptions.map((asset) => (
              <SelectItem key={asset.id} value={asset.id}>
                {asset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Linking…" : "Link"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
