"use client";

import { useState, useTransition } from "react";
import { IngressLink } from "@/components/layout/ingress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { parseCsvText, type ParsedCsv } from "@/lib/csv-import";
import {
  buildIncomeRows,
  guessIncomeMapping,
  type IncomeCsvMapping,
  type IncomeCsvMode,
} from "@/lib/income-csv";
import {
  importIncomeCsv,
  type IncomeImportResult,
} from "@/server/actions/annual-income";
import { PersonResolutionStep, type PersonResolution } from "./PersonResolutionStep";

const NONE = "none";

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function ColumnSelect({
  id,
  label,
  headers,
  value,
  onChange,
}: {
  id: string;
  label: string;
  headers: string[];
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const items: Record<string, string> = { [NONE]: "—" };
  headers.forEach((header, index) => {
    items[String(index)] = header || `Column ${index + 1}`;
  });

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value === null ? NONE : String(value)}
        onValueChange={(v) => onChange(v === NONE || v === null ? null : Number(v))}
        items={items}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(items).map(([key, itemLabel]) => (
            <SelectItem key={key} value={key}>
              {itemLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function IncomeImportWizard({ persons }: { persons: { id: string; name: string }[] }) {
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<IncomeCsvMapping | null>(null);
  const [defaultSource, setDefaultSource] = useState("w2");
  const [result, setResult] = useState<IncomeImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [resolutions, setResolutions] = useState<Record<string, PersonResolution>>({});

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const csv = parseCsvText(text);
    setParsed(csv);
    setMapping(guessIncomeMapping(csv.headers, csv.rows));
    setResult(null);
    setError(null);
    setResolutions({});
  }

  const preview =
    parsed && mapping
      ? buildIncomeRows(parsed.headers, parsed.rows, mapping, defaultSource)
      : null;

  const update = (patch: Partial<IncomeCsvMapping>) =>
    setMapping((current) => (current ? { ...current, ...patch } : current));

  const distinctLabels = preview ? [...new Set(preview.built.map((r) => r.person))] : [];

  function defaultResolutionFor(label: string): PersonResolution {
    const match = persons.find((p) => p.name.toLowerCase() === label.toLowerCase());
    return match ? { mode: "existing", personId: match.id } : { mode: "new", name: label };
  }

  // Merge in defaults for any label the user hasn't touched yet, so every
  // distinct label always has a resolution without needing an effect.
  const effectiveResolutions: Record<string, PersonResolution> = Object.fromEntries(
    distinctLabels.map((label) => [label, resolutions[label] ?? defaultResolutionFor(label)]),
  );

  function resolvedNameFor(label: string): string {
    const resolution = effectiveResolutions[label];
    if (!resolution) return label;
    if (resolution.mode === "existing") {
      return persons.find((p) => p.id === resolution.personId)?.name ?? label;
    }
    return resolution.name;
  }

  const hasBlankNewName = distinctLabels.some((label) => {
    const resolution = effectiveResolutions[label];
    return resolution.mode === "new" && resolution.name.trim() === "";
  });

  if (result) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-2">
          <p className="font-medium">
            Imported {result.imported} {result.imported === 1 ? "entry" : "entries"}.
          </p>
          {result.skippedDuplicates > 0 && (
            <p className="text-sm text-muted-foreground">
              {result.skippedDuplicates} skipped as duplicates of existing entries.
            </p>
          )}
          <IngressLink href="/income" className="pt-2 text-sm font-medium text-primary">
            Back to Income →
          </IngressLink>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="income-csv-file">CSV file</Label>
          <Input
            id="income-csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <p className="text-xs text-muted-foreground">
            Works with one row per entry, or a spreadsheet layout with a Year
            column and one column of amounts per person.
          </p>
        </CardContent>
      </Card>

      {parsed && mapping && (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <h2 className="font-semibold">Map columns</h2>

            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="import-mode">Layout</Label>
                <Select
                  value={mapping.mode}
                  onValueChange={(v) => update({ mode: (v ?? "wide") as IncomeCsvMode })}
                  items={{ wide: "Year rows, person columns", long: "One row per entry" }}
                >
                  <SelectTrigger id="import-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wide">Year rows, person columns</SelectItem>
                    <SelectItem value="long">One row per entry</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <ColumnSelect
                  id="import-year"
                  label="Year column"
                  headers={parsed.headers}
                  value={mapping.yearColumn}
                  onChange={(v) => update({ yearColumn: v })}
                />
              </div>
            </div>

            {mapping.mode === "wide" ? (
              <div className="flex flex-col gap-2">
                <Label>Person columns (header = name)</Label>
                <div className="flex flex-col gap-1.5">
                  {parsed.headers.map((header, index) => {
                    if (index === mapping.yearColumn) return null;
                    const checked = mapping.personColumns.includes(index);
                    return (
                      <label key={index} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            update({
                              personColumns: checked
                                ? mapping.personColumns.filter((c) => c !== index)
                                : [...mapping.personColumns, index],
                            })
                          }
                        />
                        {header || `Column ${index + 1}`}
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <ColumnSelect
                    id="import-person"
                    label="Person"
                    headers={parsed.headers}
                    value={mapping.personColumn}
                    onChange={(v) => update({ personColumn: v })}
                  />
                  <ColumnSelect
                    id="import-amount"
                    label="Amount"
                    headers={parsed.headers}
                    value={mapping.amountColumn}
                    onChange={(v) => update({ amountColumn: v })}
                  />
                  <ColumnSelect
                    id="import-source"
                    label="Source (optional)"
                    headers={parsed.headers}
                    value={mapping.sourceColumn}
                    onChange={(v) => update({ sourceColumn: v })}
                  />
                </div>
                <details>
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    Withholding columns (optional)
                  </summary>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <ColumnSelect id="import-fed" label="Federal tax" headers={parsed.headers} value={mapping.fedColumn} onChange={(v) => update({ fedColumn: v })} />
                    <ColumnSelect id="import-state" label="State tax" headers={parsed.headers} value={mapping.stateColumn} onChange={(v) => update({ stateColumn: v })} />
                    <ColumnSelect id="import-local" label="Local tax" headers={parsed.headers} value={mapping.localColumn} onChange={(v) => update({ localColumn: v })} />
                    <ColumnSelect id="import-medicare" label="Medicare" headers={parsed.headers} value={mapping.medicareColumn} onChange={(v) => update({ medicareColumn: v })} />
                    <ColumnSelect id="import-ss" label="Social Security" headers={parsed.headers} value={mapping.ssColumn} onChange={(v) => update({ ssColumn: v })} />
                  </div>
                </details>
              </>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="import-default-source">
                {mapping.mode === "wide" ? "Source for all rows" : "Source when column is blank"}
              </Label>
              <Input
                id="import-default-source"
                value={defaultSource}
                onChange={(e) => setDefaultSource(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {preview && preview.built.length > 0 && (
        <Card>
          <CardContent>
            <PersonResolutionStep
              labels={distinctLabels}
              persons={persons}
              resolutions={effectiveResolutions}
              onChange={(label, resolution) =>
                setResolutions((current) => ({ ...current, [label]: resolution }))
              }
            />
          </CardContent>
        </Card>
      )}

      {preview && (
        <Card>
          <CardContent>
            <h2 className="pb-2 font-semibold">
              Preview — {preview.built.length} {preview.built.length === 1 ? "entry" : "entries"}
              {preview.skipped > 0 && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {preview.skipped} rows skipped
                </span>
              )}
            </h2>
            {preview.built.length > 0 && (
              <div className="-mx-4 overflow-x-auto px-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-1.5 pr-2 font-medium">Person</th>
                      <th className="py-1.5 pr-2 font-medium">Year</th>
                      <th className="py-1.5 pr-2 font-medium">Source</th>
                      <th className="py-1.5 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.built.slice(0, 8).map((row, index) => (
                      <tr key={index} className="border-b last:border-b-0">
                        <td className="py-1.5 pr-2">{resolvedNameFor(row.person)}</td>
                        <td className="py-1.5 pr-2">{row.year}</td>
                        <td className="py-1.5 pr-2">{row.source}</td>
                        <td className="py-1.5 text-right whitespace-nowrap">
                          {usd(row.amountCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.built.length > 8 && (
                  <p className="pt-2 text-xs text-muted-foreground">
                    …and {preview.built.length - 8} more
                  </p>
                )}
              </div>
            )}
            {error && <p className="pt-2 text-sm text-destructive">{error}</p>}
            <Button
              className="mt-3"
              disabled={pending || preview.built.length === 0 || hasBlankNewName}
              onClick={() =>
                startTransition(async () => {
                  try {
                    setResult(await importIncomeCsv(preview.built, effectiveResolutions));
                  } catch {
                    setError("Import failed — check the column mapping.");
                  }
                })
              }
            >
              {pending
                ? "Importing…"
                : `Import ${preview.built.length} ${preview.built.length === 1 ? "entry" : "entries"}`}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
