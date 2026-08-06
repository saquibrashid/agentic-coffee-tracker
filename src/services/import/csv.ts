/**
 * A small RFC 4180 CSV reader.
 *
 * Hand-rolled rather than pulled from npm because the import path has to cope
 * with files people exported from Notes, Numbers or a spreadsheet, where quoted
 * fields containing commas and line breaks are routine. A naive `split(',')`
 * silently mangles exactly those rows — and a mangled rating is worse than a
 * rejected one, because nothing tells the user it happened.
 */

/** A single parsed row, plus the 1-based line it started on for error messages. */
export interface CsvRow {
  cells: string[];
  line: number;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Splits CSV text into rows of raw cells.
 *
 * Blank rows and `#` comment rows are dropped, so a template can carry
 * instructions and a file can have trailing newlines without producing a
 * phantom empty record.
 */
export function parseCsv(text: string): CsvRow[] {
  const src = stripBom(text);
  const rows: CsvRow[] = [];

  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;

  const pushRow = () => {
    cells.push(field);
    field = '';
    const isBlank = cells.every((c) => c.trim() === '');
    const isComment = cells[0]?.trimStart().startsWith('#') ?? false;
    if (!isBlank && !isComment) rows.push({ cells, line: rowStartLine });
    cells = [];
  };

  for (let i = 0; i < src.length; i += 1) {
    const char = src[i];

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote is an escaped literal quote, not the end of the field.
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      cells.push(field);
      field = '';
      continue;
    }

    if (char === '\r') continue;

    if (char === '\n') {
      pushRow();
      line += 1;
      rowStartLine = line;
      continue;
    }

    field += char;
  }

  // Flush whatever the final line left behind when the file has no trailing newline.
  if (field !== '' || cells.length > 0) pushRow();

  return rows;
}

/** Normalises a header cell so `Brew Method`, `brew_method` and `brewmethod` all agree. */
export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}
