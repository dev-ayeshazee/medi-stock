/**
 * Minimal, dependency-free RFC-4180-ish CSV parser for POS batch uploads.
 *
 * Supports: quoted fields, escaped quotes (`""`), CRLF or LF line endings, and
 * a trailing newline. The first non-empty row is treated as the header.
 */
export function parseCsv(input: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  const pushRow = (): void => {
    pushField();
    if (row.some((value) => value.length > 0)) {
      rows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      pushField();
    } else if (char === '\n') {
      pushRow();
    } else if (char === '\r') {
      if (input[i + 1] === '\n') i += 1;
      pushRow();
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  const headerRow = rows.shift();
  if (!headerRow) return [];

  const headers = headerRow.map((header) => header.trim());

  return rows.map((values) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (values[index] ?? '').trim();
    });
    return record;
  });
}
