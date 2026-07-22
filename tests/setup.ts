import { randomBytes } from "node:crypto";

// Safety: tests must never reach a real database. src/server/db/client.ts
// throws at import time when DATABASE_URL is unset, so any test that imports
// a DB-touching module without mocking "@/server/db/client" fails loudly
// instead of silently connecting to the dev DB.
delete process.env.DATABASE_URL;

// Real encryptSecret/decryptSecret work in tests with a throwaway key
// (AES-256-GCM, base64 of exactly 32 bytes).
process.env.SIMPLEFIN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
