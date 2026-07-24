"use server";

import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { signIn } from "@/server/lib/auth";

export async function loginAction(
  _prevState: string | undefined,
  formData: FormData,
) {
  // Same ingress-path prefixing as src/proxy.ts's redirects, and for the
  // same reason: under Home Assistant ingress, an unprefixed "/summary"
  // redirect would send the browser to HA's own frontend route instead of
  // back through the ingress proxy. Empty (LAN/compose deployment) when the
  // header is absent, so behavior there is unchanged.
  const ingressPath = (await headers()).get("x-ingress-path") ?? "";

  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: `${ingressPath}/summary`,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return "Invalid email or password.";
    }
    throw error;
  }
}
