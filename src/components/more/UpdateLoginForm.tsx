"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateLoginCredentials } from "@/server/actions/user";

type FormState = { error?: string; success?: boolean };

export function UpdateLoginForm({
  currentEmail,
  hasPassword,
}: {
  currentEmail: string;
  // False for a login provisioned from Home Assistant that hasn't set a
  // password yet - no "current password" to ask for.
  hasPassword: boolean;
}) {
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
        <h2 className="pb-2 font-bold">Email &amp; password</h2>
        <p className="pb-4 text-sm text-muted-foreground">
          {hasPassword
            ? "For signing in outside Home Assistant. Changes take effect on the next sign-in — devices already signed in stay signed in."
            : "You sign in through Home Assistant. Set an email and password here if you also want to sign in directly, outside Home Assistant."}
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
          {hasPassword && (
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
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required={!hasPassword}
              placeholder={hasPassword ? "Leave blank to keep current password" : undefined}
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
