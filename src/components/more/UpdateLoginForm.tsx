"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateLoginCredentials } from "@/server/actions/user";

type FormState = { error?: string; success?: boolean };

export function UpdateLoginForm({ currentEmail }: { currentEmail: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      try {
        await updateLoginCredentials(formData);
        return { success: true };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Couldn't update the login." };
      }
    },
    {},
  );

  return (
    <Card>
      <CardContent>
        <h2 className="pb-2 font-bold">Household login</h2>
        <p className="pb-4 text-sm text-muted-foreground">
          One shared login for the household. Changes take effect on the next
          sign-in — devices already signed in stay signed in.
        </p>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Login email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              defaultValue={currentEmail}
              autoComplete="username"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              placeholder="Leave blank to keep current password"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
            />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          {state.success && !pending && (
            <p className="text-sm text-primary">Login updated.</p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
