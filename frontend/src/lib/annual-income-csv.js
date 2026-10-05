// Annual income CSVs are separate from bank transactions and monthly budgets.
// A file has a stable lineage, and each physical row keeps its own identity.
// Identical W2 rows are therefore preserved rather than deduplicated by amount.
export function parseAnnualIncomeCsv(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false;
  const source = String(text).replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
    } else if (char === '"') {
      if (cell.length || closed)
        throw new Error(
          "A CSV quote must start a field. Quote amounts that contain commas.",
        );
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
      closed = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
      closed = false;
    } else {
      if (closed && !/\s/.test(char))
        throw new Error("Unexpected text after a quoted CSV field.");
      if (!closed) cell += char;
    }
  }
  if (quoted) throw new Error("A quoted CSV field is not closed.");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  if (!rows.length) throw new Error("The CSV is empty.");
  if (rows.length > 5001)
    throw new Error("Import at most 5,000 CSV rows at a time.");
  const width = rows[0].length;
  if (rows.some((value) => value.length !== width))
    throw new Error(
      "CSV rows have different column counts. Quote amounts that contain commas.",
    );
  return rows;
}

export function annualCsvCents(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const matched = text.match(
    /^(\()?([+-])?(?:USD\s*|\$)?((?:\d{1,3}(?:,\d{3})+|\d+)?)(?:\.(\d{1,2}))?(\))?$/i,
  );
  if (
    !matched ||
    (!matched[3] && !matched[4]) ||
    Boolean(matched[1]) !== Boolean(matched[5]) ||
    (matched[1] && matched[2])
  )
    throw new Error(
      `Invalid USD amount: ${text}. Use dollars with at most two decimal places.`,
    );
  const absolute =
    BigInt((matched[3] || "0").replaceAll(",", "")) * 100n +
    BigInt((matched[4] || "").padEnd(2, "0") || "0");
  if (absolute > 1000000000000n)
    throw new Error("An annual amount is too large.");
  return Number(absolute) * (matched[1] || matched[2] === "-" ? -1 : 1);
}

// SHA-256 also works on local HTTP development pages where SubtleCrypto is
// unavailable. This identifies a file; it is never used for authentication.
export function annualCsvDigest(text) {
  const input = new TextEncoder().encode(text);
  const length = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(length);
  bytes.set(input);
  bytes[input.length] = 128;
  const view = new DataView(bytes.buffer);
  const bits = BigInt(input.length) * 8n;
  view.setUint32(length - 8, Number(bits >> 32n));
  view.setUint32(length - 4, Number(bits & 0xffffffffn));
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];
  const rotate = (value, count) => (value >>> count) | (value << (32 - count));
  const words = new Uint32Array(64);
  for (let block = 0; block < length; block += 64) {
    for (let index = 0; index < 16; index++)
      words[index] = view.getUint32(block + index * 4);
    for (let index = 16; index < 64; index++) {
      const a = words[index - 15],
        b = words[index - 2];
      words[index] =
        (words[index - 16] +
          (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) +
          words[index - 7] +
          (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) >>>
        0;
    }
    let [a, b, c, d, e, f, g, last] = h;
    for (let index = 0; index < 64; index++) {
      const t1 =
        (last +
          (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
          ((e & f) ^ (~e & g)) +
          k[index] +
          words[index]) >>>
        0;
      const t2 =
        ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) +
          ((a & b) ^ (a & c) ^ (b & c))) >>>
        0;
      last = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, last].forEach((value, index) => {
      h[index] = (h[index] + value) >>> 0;
    });
  }
  return h.map((value) => value.toString(16).padStart(8, "0")).join("");
}

export async function snapshotFromAnnualIncomeCsv(
  text,
  fileName = "income.csv",
) {
  if (new TextEncoder().encode(text).length > 5 * 1024 * 1024)
    throw new Error("Choose a CSV smaller than 5 MB.");
  const [rawHeaders, ...rows] = parseAnnualIncomeCsv(text);
  const normalize = (value) =>
    value
      .trim()
      .toLowerCase()
      .replaceAll(/[_-]+/g, " ")
      .replaceAll(/\s+/g, " ");
  const headers = rawHeaders.map(normalize);
  if (
    new Set(headers).size !== headers.length ||
    headers.some((value) => !value)
  )
    throw new Error("CSV column names must be unique and nonempty.");
  const column = (...names) => {
    const matches = headers.flatMap((value, index) =>
      names.includes(value) ? [index] : [],
    );
    if (matches.length > 1)
      throw new Error(
        `Choose only one ${names[0]} column; ${matches.map((index) => rawHeaders[index]).join(" and ")} are ambiguous.`,
      );
    return matches[0] ?? -1;
  };
  const yearColumn = column("year", "tax year", "yr");
  const personColumn = column("person", "name", "who", "earner");
  const long = personColumn >= 0;
  const amountColumn = long
    ? column(
        "amount",
        "gross",
        "income",
        "wages",
        "gross income",
        "amount dollars",
        "total income",
        "total",
        "gross pay",
      )
    : -1;
  if (yearColumn < 0) throw new Error("Include a Year column in the CSV.");
  if (long && amountColumn < 0)
    throw new Error(
      "A Person column also needs an Amount or Gross column in dollars.",
    );
  const sourceColumn = column("source", "type", "form");
  const noteColumn = column("note", "notes");
  const idColumn = column("id", "entry id");
  const taxColumn = (...names) =>
    column(
      ...names.flatMap((name) => [
        name,
        `${name} withheld`,
        `${name} withholding`,
      ]),
    );
  const taxes = {
    fed_tax_cents: taxColumn(
      "fed",
      "federal",
      "fed tax",
      "federal tax",
      "federal income tax",
    ),
    state_tax_cents: taxColumn(
      "state",
      "state tax",
      "st tax",
      "state income tax",
    ),
    local_tax_cents: taxColumn("local", "local tax", "local income tax"),
    medicare_cents: taxColumn("medicare", "medicare tax"),
    social_security_cents: taxColumn(
      "social security",
      "social security tax",
      "ss tax",
      "oasdi",
    ),
  };
  const taxLike = (value) =>
    /\b(?:tax|taxes|withheld|withholding|medicare|social security|oasdi|federal|state|local)\b/.test(
      value,
    );
  if (
    !long &&
    headers.some((value, index) => index !== yearColumn && taxLike(value))
  )
    throw new Error(
      "Use one Person/Year/Amount record per row when importing tax withholdings; a shared tax column cannot be assigned to each person.",
    );
  if (
    long &&
    headers.some(
      (value, index) =>
        taxLike(value) &&
        index !== yearColumn &&
        !Object.values(taxes).includes(index),
    )
  )
    throw new Error(
      "A tax/withholding column is not recognized. Use Federal, State, Local, Medicare, or Social Security headers.",
    );
  const ignored = new Set([
    yearColumn,
    sourceColumn,
    noteColumn,
    idColumn,
    ...Object.values(taxes),
  ]);
  const wideColumns = headers
    .map((value, index) => ({ value, index }))
    .filter(
      ({ value, index }) =>
        !ignored.has(index) &&
        !/^(?:(?:household|combined|annual|gross|net|grand|all people|all persons?)\s+)?total(?:\s+(?:income|gross|net|amount|wages|earnings|pay))?$/.test(
          value,
        ) &&
        !/^(?:change|growth|delta|δ|yoy|year over year)(?:\s*(?:%|percent|pct|rate))?$/.test(
          value,
        ) &&
        !/^(?:%|percent|pct)\s*(?:change|growth|delta|δ|yoy)$/.test(value) &&
        ![
          "projection",
          "projected",
          "income",
          "gross income",
          "net income",
          "household income",
          "combined income",
          "amount",
          "gross",
          "net",
          "wages",
          "gross pay",
        ].includes(value),
    );
  if (!long && !wideColumns.length)
    throw new Error(
      "Include one named income column per person, such as Year,Person A,Person B.",
    );
  const people = [],
    entries = [],
    personIds = new Map(),
    entryIds = new Set();
  function person(name) {
    const key = name.trim().toLocaleLowerCase("en-US");
    if (!key) throw new Error("Every income record needs a person's name.");
    if (!personIds.has(key)) {
      const id = `person-${people.length + 1}`;
      people.push({
        id,
        name: name.trim(),
        color: null,
        sort_order: people.length,
        active: true,
      });
      personIds.set(key, id);
    }
    return personIds.get(key);
  }
  function add(row, rowIndex, personId, amount, suffix = "") {
    if (amount === null) return;
    const id =
      (long && idColumn >= 0 && row[idColumn].trim()) ||
      `row-${rowIndex + 2}${suffix}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(id) || entryIds.has(id))
      throw new Error(
        "CSV entry IDs must be unique ASCII identifiers of at most 80 characters.",
      );
    entryIds.add(id);
    entries.push({
      id,
      person_id: personId,
      year: Number(row[yearColumn].trim()),
      source: sourceColumn >= 0 ? row[sourceColumn].trim() || "w2" : "w2",
      amount_cents: amount,
      ...Object.fromEntries(
        Object.entries(taxes).map(([name, index]) => [
          name,
          index < 0 ? null : annualCsvCents(row[index]),
        ]),
      ),
      note: noteColumn < 0 ? null : row[noteColumn] || null,
      created_at: null,
      updated_at: null,
    });
  }
  rows.forEach((row, index) => {
    const year = row[yearColumn].trim();
    if (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > 2200)
      throw new Error(
        `CSV row ${index + 2} needs a year from 1900 through 2200.`,
      );
    if (long) {
      const amount = annualCsvCents(row[amountColumn]);
      if (amount === null)
        throw new Error(
          `CSV row ${index + 2} needs an amount. Enter 0 for measured zero income.`,
        );
      add(row, index, person(row[personColumn]), amount);
    } else
      wideColumns.forEach(({ index: amountIndex }) =>
        add(
          row,
          index,
          person(rawHeaders[amountIndex]),
          annualCsvCents(row[amountIndex]),
          `-column-${amountIndex + 1}`,
        ),
      );
  });
  if (!entries.length)
    throw new Error("The CSV contains no recorded income amounts.");
  if (entries.length > 5000)
    throw new Error("Import at most 5,000 income entries at a time.");
  return {
    format: "budget-assistant-annual-income",
    version: 1,
    source: {
      kind: "csv",
      household_id: `csv-${annualCsvDigest(text)}`,
      exported_at: new Date().toISOString(),
    },
    people,
    entries,
    forecasts: [],
  };
}
