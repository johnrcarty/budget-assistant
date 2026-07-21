import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  users,
  oauthAccounts,
  sessions,
  verificationTokens,
} from "@/server/db/schema";

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  // Auth.js hard-requires JWT sessions when Credentials is the only
  // provider (a database-only session strategy throws UnsupportedStrategy).
  // The adapter is still wired up now so the users/oauth_account/session
  // tables exist and are ready: adding an Authentik OIDC provider later
  // lets that provider use database sessions without any schema change,
  // even while Credentials (if kept) stays on JWT.
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: oauthAccounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  // Required when self-hosting behind Docker/a reverse proxy - Auth.js can't
  // otherwise verify the request Host header against a known origin.
  trustHost: true,
  callbacks: {
    // JWT sessions don't include the user id by default - the DAL
    // (server/lib/dal.ts) depends on session.user.id being present.
    jwt: async ({ token, user }) => {
      if (user) token.id = user.id;
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user && typeof token.id === "string") {
        session.user.id = token.id;
      }
      return session;
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email.toLowerCase().trim()))
          .limit(1);

        if (!user?.passwordHash) return null;

        const passwordMatches = await bcrypt.compare(
          password,
          user.passwordHash,
        );
        if (!passwordMatches) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
});
