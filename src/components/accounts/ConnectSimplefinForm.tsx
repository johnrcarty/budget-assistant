"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { connectSimplefin } from "@/server/actions/simplefin";

export function ConnectSimplefinForm() {
  const [error, formAction, pending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await connectSimplefin(formData);
        return undefined;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't connect to SimpleFin.";
      }
    },
    undefined,
  );

  return (
    <Card>
      <CardContent>
        <h2 className="pb-2 font-bold">Connect a bank via SimpleFin</h2>
        <p className="pb-4 text-sm text-muted-foreground">
          Get a Setup Token from your bank&rsquo;s SimpleFin connection page and
          paste it below. It&rsquo;s used once to establish the connection, then
          discarded.
        </p>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="setup-token">Setup Token</Label>
            <Input id="setup-token" name="setupToken" required autoFocus />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Connecting…" : "Connect"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
