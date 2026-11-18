/**
 * Bank / mobile-money statement import from CSV. Pure functions: parse the file, guess which
 * columns hold the date, description and amounts, read each row, and suggest a category.
 *
 * Statement formats vary a lot, so every guess can be overridden on the import screen.
 */
import type { TxType } from '@/db/types';

export type ColumnMap = {
  date: number;
  description: number;
  /** A single signed amount column, or -1 when the statement splits money in and out. */
  amount: number;
  debit: number;
  credit: number;
};

export type DateOrder = 'dmy' | 'mdy';

export type StatementRow = {
  line: number;
  date: string;
  description: string;
  amount: number;
  type: TxType;
};

export type ParsedStatement = {
  headers: string[];
  rows: string[][];
  columns: ColumnMap;
  /** Index of the header line within the file, for the user's reference. */
  headerLine: number;
};

/** Splits CSV text into rows, handling quoted fields, escaped quotes and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.slice(0, clean.indexOf('\n') === -1 ? undefined : clean.indexOf('\n'));
  const delimiter = [',', ';', '\t', '|'].reduce((best, d) => (count(firstLine, d) > count(firstLine, best) ? d : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f !== ''));
}

function count(s: string, ch: string) {
  return s.split(ch).length - 1;
}

const PATTERNS = {
  date: /^(trans(action)?\.?\s*)?date$|^date|value\s*date|posting\s*date|completion\s*time|^time$|txn\s*date/i,
  // Strongest first: a "Reference" column is usually a code, so it's only used if nothing better exists.
  description: [/desc|narration|details|particulars|remarks|memo/i, /beneficiary|payee|merchant|transaction$/i, /reference|ref\.?$/i],
  debit: /debit|withdraw|money\s*out|paid\s*out|^dr\.?$|outflow|spent/i,
  credit: /credit|deposit|money\s*in|paid\s*in|^cr\.?$|inflow|received/i,
  amount: /amount|value|^sum$/i,
};

/** Finds the header row (banks often put account details above it) and guesses each column. */
export function detectColumns(rows: string[][]): ParsedStatement | null {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const headers = rows[i];
    const find = (re: RegExp, except: number[] = []) => headers.findIndex((h, idx) => !except.includes(idx) && re.test(h));
    const date = find(PATTERNS.date);
    if (date === -1) continue;
    const debit = find(PATTERNS.debit, [date]);
    const credit = find(PATTERNS.credit, [date, debit]);
    const amount = debit === -1 || credit === -1 ? find(PATTERNS.amount, [date]) : -1;
    if (amount === -1 && (debit === -1 || credit === -1)) continue;
    const used = [date, debit, credit, amount];
    const description = PATTERNS.description.map((re) => find(re, used)).find((idx) => idx !== -1) ?? -1;
    return {
      headers,
      rows: rows.slice(i + 1).filter((r) => r.length >= Math.min(headers.length, 2)),
      columns: { date, description, amount, debit, credit },
      headerLine: i + 1,
    };
  }
  return null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number) {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** Reads the common statement date formats; day-first unless `order` is 'mdy'. Returns YYYY-MM-DD or null. */
export function parseStatementDate(raw: string, order: DateOrder = 'dmy'): string | null {
  const s = raw.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[ap]m)?$/i, '').replace(/T.*$/, '');
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/., ]+(\d{2,4})$/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return validDate(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  m = s.match(/^([A-Za-z]{3,9})[ -](\d{1,2}),?[ -](\d{2,4})$/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return validDate(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) return order === 'dmy' ? validDate(+m[3], +m[2], +m[1]) : validDate(+m[3], +m[1], +m[2]);
  return null;
}

/** Reads an amount like "₦1,234.50", "(500.00)", "-2 000,00", "1,200.00 DR". Returns signed major units or null. */
export function parseStatementAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s || s === '-') return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (/\bdr\.?$/i.test(s)) sign = -1;
  s = s.replace(/\b(dr|cr)\.?$/i, '').replace(/[^\d.,\-]/g, '');
  if (s.startsWith('-')) {
    sign = -sign;
    s = s.slice(1);
  }
  if (s.endsWith('-')) {
    sign = -sign;
    s = s.slice(0, -1);
  }
  // A comma followed by exactly two digits at the end is a decimal comma (e.g. 1.234,50).
  if (/,\d{2}$/.test(s) && !/\.\d{2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!s || !/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? sign * n : null;
}

/** Turns parsed CSV rows into transactions. Rows without a readable date or amount are skipped. */
export function readRows(parsed: ParsedStatement, columns: ColumnMap, order: DateOrder): { rows: StatementRow[]; skipped: number } {
  const rows: StatementRow[] = [];
  let skipped = 0;
  parsed.rows.forEach((r, i) => {
    const date = parseStatementDate(r[columns.date] ?? '', order);
    let value: number | null;
    if (columns.amount !== -1) value = parseStatementAmount(r[columns.amount] ?? '');
    else {
      const debit = parseStatementAmount(r[columns.debit] ?? '');
      const credit = parseStatementAmount(r[columns.credit] ?? '');
      value = credit && credit !== 0 ? Math.abs(credit) : debit && debit !== 0 ? -Math.abs(debit) : null;
    }
    if (!date || value === null || value === 0) {
      skipped++;
      return;
    }
    rows.push({
      line: parsed.headerLine + i + 1,
      date,
      description: (columns.description >= 0 ? r[columns.description] : '')?.replace(/\s+/g, ' ').slice(0, 120) ?? '',
      amount: Math.round(Math.abs(value) * 100),
      type: value > 0 ? 'income' : 'expense',
    });
  });
  return { rows, skipped };
}

/** Keyword rules for suggesting a category, tuned for common African merchants and services. */
const RULES: [RegExp, string][] = [
  [/salary|payroll|wages|stipend/i, 'Salary'],
  [/interest|dividend|coupon/i, 'Investments'],
  [/uber|bolt|taxify|indrive|lyft|little cab|fuel|petrol|total ?energies|oando|mrs |conoil|shell|matatu|toll|lcc|parking|brt|danfo/i, 'Transport'],
  [/shoprite|spar|carrefour|naivas|quickmart|game stores|pick ?n ?pay|checkers|woolworths|market|supermarket|grocer|justrite|ebeano|prince ebeano|chandarana/i, 'Groceries'],
  [/netflix|spotify|dstv|gotv|showmax|apple\.com|icloud|google storage|youtube|prime video|startimes|boomplay|canal\+/i, 'Subscriptions'],
  [/airtime|data bundle|mtn|airtel|glo|9mobile|safaricom|vodacom|telkom|electricity|nepa|ekedc|ikedc|aedc|kplc|token|prepaid|water bill|eskom|ecg|internet|wifi|starlink|spectranet/i, 'Utilities'],
  [/rent|landlord|estate|caution fee|agency fee/i, 'Housing'],
  [/restaurant|kfc|chicken republic|domino|pizza|cafe|coffee|eatery|mr biggs|jumia food|chowdeck|glovo|uber eats|bolt food|java/i, 'Food & Dining'],
  [/jumia|konga|takealot|amazon|aliexpress|temu|shein|mall|boutique|fashion/i, 'Shopping'],
  [/pharm|hospital|clinic|medic|hmo|nhis|lab|dental/i, 'Health'],
  [/school|tuition|university|college|course|udemy|coursera|exam|waec|jamb|books/i, 'Education'],
  [/cinema|filmhouse|genesis|silverbird|bet9ja|sportybet|betking|betway|1xbet|event|ticket|concert/i, 'Entertainment'],
  [/loan|repayment|carbon|fairmoney|palmcredit|branch|m-shwari|fuliza|tala|credit card payment/i, 'Debt Payments'],
  [/charge|commission|fee|levy|stamp duty|sms alert|maintenance|vat on|cot\b/i, 'Fees & Charges'],
  [/church|mosque|tithe|offering|zakat|donation|charity/i, 'Gifts & Donations'],
  [/flight|airline|air peace|arik|kenya airways|ethiopian|hotel|airbnb|booking\.com/i, 'Travel'],
  [/salon|barber|spa|cosmetic/i, 'Personal Care'],
];

/** Suggests a category name for a statement line, or null to use the "Other" categories. */
export function suggestCategory(description: string, type: TxType): string | null {
  for (const [re, name] of RULES) {
    if (!re.test(description)) continue;
    const incomeName = name === 'Salary' || name === 'Investments';
    if ((type === 'income') === incomeName) return name;
  }
  if (type === 'income' && /transfer|trf|from /i.test(description)) return 'Other Income';
  return null;
}
