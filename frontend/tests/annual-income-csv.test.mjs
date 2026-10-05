import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  annualCsvCents,
  annualCsvDigest,
  parseAnnualIncomeCsv,
  snapshotFromAnnualIncomeCsv,
} from "../src/lib/annual-income-csv.js";

test("CSV digest matches SHA-256 including Unicode and block boundaries", () => {
  for (const text of [
    "",
    "abc",
    "Income 年",
    "a".repeat(55),
    "b".repeat(64),
    "c".repeat(128),
    "d".repeat(10000),
  ])
    assert.equal(
      annualCsvDigest(text),
      createHash("sha256").update(text).digest("hex"),
    );
});
test("USD amounts preserve cents, signed adjustments, zero and missing values", () => {
  assert.equal(annualCsvCents("$1,234.56"), 123456);
  assert.equal(annualCsvCents("(USD 1,234.56)"), -123456);
  assert.equal(annualCsvCents("-$12.3"), -1230);
  assert.equal(annualCsvCents(".01"), 1);
  assert.equal(annualCsvCents("0"), 0);
  assert.equal(annualCsvCents(" "), null);
});
test("Ambiguous currency, grouping and fractions are rejected", () => {
  for (const value of [
    "EUR 100",
    "1,23",
    "1.005",
    "12abc",
    "(12",
    "(-12)",
    "Infinity",
    "1e5",
    "10000000000.01",
  ])
    assert.throws(() => annualCsvCents(value));
});
test("CSV quotes, commas, escaped quotes, multiline notes, CRLF and BOM survive", () => {
  assert.deepEqual(
    parseAnnualIncomeCsv(
      '\uFEFFYear,Person,Amount,Note\r\n2020,Person A,"$1,234.50","Job ""A""\nsecond line"\r\n',
    ),
    [
      ["Year", "Person", "Amount", "Note"],
      ["2020", "Person A", "$1,234.50", 'Job "A"\nsecond line'],
    ],
  );
});
test("Malformed CSV fails before a partial import", () => {
  for (const value of [
    'Year,Person,Amount\n2020,Person A,"100',
    "Year,Amount\n2020,1,000",
    'Year,Amount\n2020,"100"tail',
    'Year,Amount\n2020,1"0',
  ])
    assert.throws(() => parseAnnualIncomeCsv(value));
});
test("Distinct identical W2 entries retain identities and zero withholding", async () => {
  const text =
    "Year,Person,Source,Amount,Federal,Note\n2020,Person A,w2,100,0,first\n2020,Person A,w2,100,,second";
  const snapshot = await snapshotFromAnnualIncomeCsv(text);
  assert.equal(snapshot.people.length, 1);
  assert.equal(snapshot.entries.length, 2);
  assert.notEqual(snapshot.entries[0].id, snapshot.entries[1].id);
  assert.equal(snapshot.entries[0].fed_tax_cents, 0);
  assert.equal(snapshot.entries[1].fed_tax_cents, null);
  assert.equal(snapshot.entries[1].note, "second");
  assert.equal(
    snapshot.entries[0].amount_cents,
    snapshot.entries[1].amount_cents,
  );
});
test("An exact reimport has stable lineage despite filename or export timestamp", async () => {
  const text = "Year,Person,Amount\n2020,Person A,100";
  const first = await snapshotFromAnnualIncomeCsv(text, "first.csv");
  const second = await snapshotFromAnnualIncomeCsv(text, "renamed.csv");
  assert.equal(first.source.household_id, second.source.household_id);
  assert.deepEqual(first.entries, second.entries);
  assert.deepEqual(first.people, second.people);
});
test("Wide spreadsheet excludes total column and distinguishes blank from measured zero", async () => {
  const snapshot = await snapshotFromAnnualIncomeCsv(
    "Year,Person A,Person B,Total\n2020,100,0,100\n2021,200,,200",
  );
  assert.deepEqual(
    snapshot.people.map((p) => p.name),
    ["Person A", "Person B"],
  );
  assert.equal(snapshot.entries.length, 3);
  assert.equal(
    snapshot.entries.find((e) => e.person_id === snapshot.people[1].id)
      .amount_cents,
    0,
  );
  assert.equal(snapshot.entries.filter((e) => e.year === 2021).length, 1);
  assert.deepEqual(snapshot.forecasts, []);
});
test("Wide shared taxes are rejected to avoid counting the same withholding twice", async () => {
  await assert.rejects(
    snapshotFromAnnualIncomeCsv(
      "Year,Person A,Person B,Federal\n2020,100,200,20",
    ),
    /one Person\/Year\/Amount/,
  );
});
test("Named row identities are preserved and duplicate identities fail", async () => {
  const snapshot = await snapshotFromAnnualIncomeCsv(
    "ID,Year,Person,Amount\njob-a,2020,Person A,100\njob-b,2020,Person A,100",
  );
  assert.deepEqual(
    snapshot.entries.map((e) => e.id),
    ["job-a", "job-b"],
  );
  await assert.rejects(
    snapshotFromAnnualIncomeCsv(
      "ID,Year,Person,Amount\njob-a,2020,Person A,100\njob-a,2020,Person A,100",
    ),
    /unique ASCII/,
  );
});
test("Invalid years, absent long amounts and ambiguous headers fail clearly", async () => {
  for (const text of [
    "Year,Person,Amount\n2020,Person A,",
    "Year,Person,Amount\n2020foo,Person A,100",
    "Year,Person,Amount\n1800,Person A,100",
    "Year,year,Amount\n2020,2020,100",
    "Year,Person\n2020,Person A",
  ])
    await assert.rejects(snapshotFromAnnualIncomeCsv(text));
});
test("Signed corrections remain signed and names resolve consistently within the file", async () => {
  const snapshot = await snapshotFromAnnualIncomeCsv(
    "Year,Person,Amount,State\n2020,Person A,-100,-2\n2021,PERSON A,0,0",
  );
  assert.equal(snapshot.people.length, 1);
  assert.equal(snapshot.entries[0].amount_cents, -10000);
  assert.equal(snapshot.entries[0].state_tax_cents, -200);
  assert.equal(snapshot.entries[1].amount_cents, 0);
});
test("Semantic aliases cannot silently discard an amount, tax, person or year", async () => {
  for (const text of [
    "Year,Tax Year,Person,Amount\n2020,2021,Person A,100",
    "Year,Person,Amount,Gross\n2020,Person A,100,200",
    "Year,Person,Amount,Federal,Fed Tax\n2020,Person A,100,1,9",
    "Year,Person,Name,Amount\n2020,Person A,Person B,100",
  ])
    await assert.rejects(snapshotFromAnnualIncomeCsv(text), /ambiguous/);
});
test("Wide total/growth variants are excluded rather than becoming extra people", async () => {
  const snapshot = await snapshotFromAnnualIncomeCsv(
    "Year,Person A,Person B,Total Income,Household Total,Δ%,Growth Rate\n2020,100,200,300,300,5,8",
  );
  assert.deepEqual(
    snapshot.people.map((p) => p.name),
    ["Person A", "Person B"],
  );
  assert.equal(
    snapshot.entries.reduce((sum, e) => sum + e.amount_cents, 0),
    30000,
  );
});
test("Tax variants cannot masquerade as a person's wide income", async () => {
  for (const header of [
    "Social Security Withheld",
    "Federal Tax Withholding",
    "Income Tax",
  ])
    await assert.rejects(
      snapshotFromAnnualIncomeCsv(
        `Year,Person A,Person B,${header}\n2020,100,200,30`,
      ),
      /one Person\/Year\/Amount/,
    );
  const snapshot = await snapshotFromAnnualIncomeCsv(
    "Year,Person,Amount,Social Security Withheld\n2020,Person A,100,2",
  );
  assert.equal(snapshot.entries[0].social_security_cents, 200);
});
test("Wide Tax Year and multiple aggregate columns retain just named people", async () => {
  const snapshot = await snapshotFromAnnualIncomeCsv(
    "Tax Year,Person A,Person B,Total,Gross,Total Net,% Change\n2020,100,200,300,300,250,5",
  );
  assert.deepEqual(
    snapshot.people.map((p) => p.name),
    ["Person A", "Person B"],
  );
  assert.equal(snapshot.entries.length, 2);
});
