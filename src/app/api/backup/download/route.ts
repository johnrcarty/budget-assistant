// Streams a fresh pg_dump to the browser as a download. Session-gated
// (cookie auth): proxy.ts's matcher excludes /api, so this route checks the
// session itself rather than relying on the optimistic middleware redirect.
import { auth } from "@/server/lib/auth";
import { createDump, dumpFilename } from "@/server/lib/db-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    // Copy into a fresh ArrayBuffer-backed view: BodyInit rejects the
    // ArrayBufferLike-generic Uint8Array that fs.readFile returns.
    const dump = new Uint8Array(await createDump());
    return new Response(dump, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${dumpFilename(new Date())}"`,
        "Content-Length": String(dump.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Backup failed", {
      status: 500,
    });
  }
}
