"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function RestoreBackupCard() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleRestore() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a backup file first.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("confirm", confirmText.trim().toLowerCase());
      const res = await fetch("/api/backup/restore", { method: "POST", body });
      if (!res.ok) {
        let message = `Restore failed (HTTP ${res.status}).`;
        try {
          const json = (await res.json()) as { error?: string };
          if (json.error) message = json.error;
        } catch {
          // non-JSON error body (e.g. a proxy's 413 page) — keep the status message
        }
        throw new Error(message);
      }
      setDone(true);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <h2 className="pb-2 font-bold">Restore from a backup</h2>
        <p className="pb-4 text-sm text-muted-foreground">
          Upload a <code>.dump</code> backup file and replace{" "}
          <span className="font-medium text-foreground">all data in this install</span> with
          its contents. Use this to move data from another install (e.g. migrating to the
          Home Assistant add-on) or to roll back to an earlier backup.
        </p>
        {done ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-primary">
              Restore complete — all data has been replaced and migrations re-applied.
            </p>
            <Button onClick={() => window.location.assign("/")}>Reload the app</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="restore-file">Backup file</Label>
              <Input
                id="restore-file"
                ref={fileInputRef}
                type="file"
                accept=".dump"
                onChange={(e) => {
                  setFileName(e.target.files?.[0]?.name ?? null);
                  setError(null);
                }}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              variant="destructive"
              className="w-fit"
              disabled={!fileName}
              onClick={() => {
                setConfirmText("");
                setError(null);
                setOpen(true);
              }}
            >
              Restore…
            </Button>
          </div>
        )}

        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (!pending) setOpen(next);
          }}
        >
          <DialogContent showCloseButton={!pending}>
            <DialogHeader>
              <DialogTitle>Restore this backup?</DialogTitle>
              <DialogDescription>
                This permanently replaces every account, transaction, budget, and debt in
                this install with the contents of{" "}
                <span className="font-medium text-foreground">{fileName}</span>. It cannot
                be undone — download a backup of the current data first if you might need
                it.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="restore-confirm">
                Type <span className="font-mono font-medium">restore</span> to confirm
              </Label>
              <Input
                id="restore-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
                disabled={pending}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button
                variant="destructive"
                disabled={confirmText.trim().toLowerCase() !== "restore" || pending}
                onClick={handleRestore}
              >
                {pending ? "Restoring…" : "Replace all data"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
