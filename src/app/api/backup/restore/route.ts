// Destructively restores an uploaded pg_dump into the live database — the
// UI counterpart of scripts/backup/restore.sh, with the same double
// confirmation (explicit typed word, checked server-side too, not just in
// the dialog). A Route Handler rather than a Server Action because dumps
// easily exceed the Server Action body limit.
import { revalidatePath } from "next/cache";
import { auth } from "@/server/lib/auth";
import { isPgCustomDump, restoreDump } from "@/server/lib/db-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  if (form.get("confirm") !== "restore") {
    return Response.json({ error: 'Type "restore" to confirm.' }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "Attach a .dump backup file." }, { status: 400 });
  }

  const data = new Uint8Array(await file.arrayBuffer());
  if (!isPgCustomDump(data)) {
    return Response.json(
      {
        error:
          "That file isn't a PostgreSQL custom-format dump. Use a .dump file downloaded from this screen or produced by the scheduled backup job.",
      },
      { status: 400 },
    );
  }

  try {
    await restoreDump(data);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Restore failed." },
      { status: 500 },
    );
  }

  revalidatePath("/", "layout");
  return Response.json({ ok: true });
}
