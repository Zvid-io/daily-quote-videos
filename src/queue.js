import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { csvField } from './util.js';

export const SHEET_COLUMNS = [
  'Quote',
  'Author',
  'AuthorNote',
  'Status',
  'VideoUrl',
];

export function loadQueue(filePath) {
  const records = parse(readFileSync(filePath, 'utf8'), {
    columns: true,
    bom: true,
    trim: true,
    skip_empty_lines: true,
  });

  if (records.length === 0) {
    throw new Error(`${filePath} contains no quote rows`);
  }

  const missing = SHEET_COLUMNS.filter((column) => !(column in records[0]));
  if (missing.length > 0) {
    throw new Error(
      `${filePath} is missing required column(s): ${missing.join(', ')}. ` +
        `Expected header: ${SHEET_COLUMNS.join(',')}`
    );
  }

  const index = records.findIndex((row) => !String(row.Status || '').trim());
  if (index === -1) return { records, pending: null };

  const record = records[index];
  const sheetRow = index + 2;
  const missingInputs = ['Quote', 'Author'].filter(
    (column) => !String(record[column] || '').trim()
  );
  if (missingInputs.length > 0) {
    throw new Error(
      `Row ${sheetRow} is missing ${missingInputs.join(' and ')}. ` +
        'Fill the cells, or put anything in Status to skip the row.'
    );
  }

  return { records, pending: { index, sheetRow, record } };
}

export function writeQueue(filePath, records) {
  const lines = [SHEET_COLUMNS.join(',')];
  for (const record of records) {
    lines.push(SHEET_COLUMNS.map((column) => csvField(record[column])).join(','));
  }
  writeFileSync(filePath, `${lines.join('\n')}\n`);
}
