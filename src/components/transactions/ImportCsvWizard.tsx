"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { formatCents } from "@/server/lib/money";
import {
  parseCsvText,
  guessColumnMapping,
  parseAmountToCents,
  parseDateToIso,
  type ColumnMapping,
} from "@/lib/csv-import";
import { importTransactionsCsv, type ImportResult } from "@/server/actions/csv-import";
import type { accounts } from "@/server/db/schema";

type Step = "select" | "map" | "done";

interface MappedRow {
  postedDate: string | null;
  description: string | null;
  amountCents: number | null;
}

function mapRow(row: string[], mapping: ColumnMapping): MappedRow {
  const rawDate = mapping.dateColumn !== null ? row[mapping.dateColumn] : undefined;
  const rawDescription =
    mapping.descriptionColumn !== null ? row[mapping.descriptionColumn] : undefined;

  let amountCents: number | null = null;
  if (mapping.amountMode === "single") {
    const raw = mapping.amountColumn !== null ? row[mapping.amountColumn] : undefined;
    const parsed = raw !== undefined ? parseAmountToCents(raw) : null;
    amountCents = parsed !== null ? (mapping.flipAmountSign ? -parsed : parsed) : null;
  } else {
    const debitRaw = mapping.debitColumn !== null ? row[mapping.debitColumn] : undefined;
    const creditRaw = mapping.creditColumn !== null ? row[mapping.creditColumn] : undefined;
    const debit = debitRaw ? parseAmountToCents(debitRaw) : null;
    const credit = creditRaw ? parseAmountToCents(creditRaw) : null;
    if (credit) amountCents = Math.abs(credit);
    else if (debit) amountCents = -Math.abs(debit);
  }

  return {
    postedDate: rawDate !== undefined ? parseDateToIso(rawDate) : null,
    description: rawDescription?.trim() || null,
    amountCents,
  };
}

export function ImportCsvWizard({
  accountList,
}: {
  accountList: (typeof accounts.$inferSelect)[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("select");
  const [accountId, setAccountId] = useState(accountList[0]?.id ?? "");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [parseError, setParseError] = useState<string | undefined>();
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleFile(file: File) {
    setParseError(undefined);
    const text = await file.text();
    const parsed = parseCsvText(text);

    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setParseError("Couldn't find any rows in that file.");
      return;
    }

    setFileName(file.name);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setMapping(guessColumnMapping(parsed.headers));
    setStep("map");
  }

  const mappedPreview = useMemo(() => {
    if (!mapping) return [];
    return rows.slice(0, 5).map((row) => mapRow(row, mapping));
  }, [rows, mapping]);

  const allMapped = useMemo(() => {
    if (!mapping) return [];
    return rows.map((row) => mapRow(row, mapping));
  }, [rows, mapping]);

  const validCount = allMapped.filter(
    (r) => r.postedDate && r.description && r.amountCents !== null,
  ).length;

  async function handleImport() {
    if (!mapping) return;
    setImporting(true);
    try {
      const validRows = allMapped.filter(
        (r): r is { postedDate: string; description: string; amountCents: number } =>
          !!r.postedDate && !!r.description && r.amountCents !== null,
      );
      const res = await importTransactionsCsv(accountId, validRows);
      setResult(res);
      setStep("done");
    } catch {
      setParseError("Import failed. Check the mapping and try again.");
    } finally {
      setImporting(false);
    }
  }

  function updateMapping(patch: Partial<ColumnMapping>) {
    setMapping((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  const columnOptions = headers.map((h, i) => ({ value: String(i), label: h }));

  return (
    <div className="flex flex-col gap-4">
      {step === "select" && (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="import-account">Account</Label>
              <Select value={accountId} onValueChange={(v) => setAccountId(v ?? "")}>
                <SelectTrigger id="import-account" className="w-full">
                  <SelectValue placeholder="Select an account" />
                </SelectTrigger>
                <SelectContent>
                  {accountList.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="import-file">CSV file</Label>
              <label
                htmlFor="import-file"
                className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-sm text-muted-foreground"
              >
                <Upload className="size-6" />
                Tap to choose a CSV file
                <input
                  id="import-file"
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  disabled={!accountId}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                  }}
                />
              </label>
            </div>

            {parseError && <p className="text-sm text-destructive">{parseError}</p>}
          </CardContent>
        </Card>
      )}

      {step === "map" && mapping && (
        <>
          <Card>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                {fileName} · {rows.length} row{rows.length === 1 ? "" : "s"}
              </p>

              <div className="flex flex-col gap-2">
                <Label>Date column</Label>
                <ColumnSelect
                  options={columnOptions}
                  value={mapping.dateColumn}
                  onChange={(v) => updateMapping({ dateColumn: v })}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label>Description column</Label>
                <ColumnSelect
                  options={columnOptions}
                  value={mapping.descriptionColumn}
                  onChange={(v) => updateMapping({ descriptionColumn: v })}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label>Amount</Label>
                <Select
                  value={mapping.amountMode}
                  onValueChange={(v) => {
                    if (v === "single" || v === "split") updateMapping({ amountMode: v });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">One column (signed)</SelectItem>
                    <SelectItem value="split">Separate debit/credit columns</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {mapping.amountMode === "single" ? (
                <>
                  <div className="flex flex-col gap-2">
                    <Label>Amount column</Label>
                    <ColumnSelect
                      options={columnOptions}
                      value={mapping.amountColumn}
                      onChange={(v) => updateMapping({ amountColumn: v })}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={mapping.flipAmountSign}
                      onCheckedChange={(v) => updateMapping({ flipAmountSign: v === true })}
                    />
                    Flip sign (use if expenses show as positive in this file)
                  </label>
                </>
              ) : (
                <div className="flex gap-3">
                  <div className="flex flex-1 flex-col gap-2">
                    <Label>Debit column</Label>
                    <ColumnSelect
                      options={columnOptions}
                      value={mapping.debitColumn}
                      onChange={(v) => updateMapping({ debitColumn: v })}
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-2">
                    <Label>Credit column</Label>
                    <ColumnSelect
                      options={columnOptions}
                      value={mapping.creditColumn}
                      onChange={(v) => updateMapping({ creditColumn: v })}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <h2 className="pb-2 font-bold">Preview</h2>
              <div className="flex flex-col gap-1">
                {mappedPreview.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between border-b py-2 text-sm last:border-b-0"
                  >
                    <span className="w-20 shrink-0 text-muted-foreground">
                      {r.postedDate ?? <span className="text-destructive">invalid</span>}
                    </span>
                    <span className="min-w-0 flex-1 truncate px-2">
                      {r.description ?? <span className="text-destructive">missing</span>}
                    </span>
                    <span
                      className={`shrink-0 font-medium ${
                        r.amountCents !== null && r.amountCents < 0
                          ? ""
                          : r.amountCents !== null
                            ? "text-primary"
                            : "text-destructive"
                      }`}
                    >
                      {r.amountCents !== null ? formatCents(r.amountCents) : "invalid"}
                    </span>
                  </div>
                ))}
              </div>
              <p className="pt-3 text-sm text-muted-foreground">
                {validCount} of {rows.length} rows look valid with this mapping.
              </p>
            </CardContent>
          </Card>

          {parseError && <p className="text-sm text-destructive">{parseError}</p>}

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setStep("select")}>
              Back
            </Button>
            <Button
              className="flex-1"
              disabled={importing || validCount === 0}
              onClick={handleImport}
            >
              {importing ? "Importing…" : `Import ${validCount} transaction${validCount === 1 ? "" : "s"}`}
            </Button>
          </div>
        </>
      )}

      {step === "done" && result && (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <p>
              Imported <span className="font-medium text-primary">{result.imported}</span>{" "}
              transaction{result.imported === 1 ? "" : "s"}.
              {result.skippedDuplicates > 0 && (
                <>
                  {" "}
                  Skipped {result.skippedDuplicates} that looked like duplicates of
                  transactions already on this account.
                </>
              )}
            </p>
            <Button onClick={() => router.push("/transactions")}>Done</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ColumnSelect({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <Select
      value={value !== null ? String(value) : "none"}
      onValueChange={(v) => onChange(v === "none" || v === null ? null : Number(v))}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Not in file" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Not in file</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
