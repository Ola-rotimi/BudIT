/**
 * Year-end summary for tax filing: income and spending by category for a calendar year, with an
 * estimate of income tax on salary under the user's country preset, rendered as printable HTML.
 */
import type { CategoryTotal } from '@/db/queries';
import { examplePay, type CountryPreset } from './countries';
import { calculateTax } from './finance';
import { formatMoney } from './money';

export type TaxSummary = {
  year: number;
  income: CategoryTotal[];
  expense: CategoryTotal[];
  totalIncome: number;
  totalExpense: number;
  salary: number;
  housing: number;
  estimate: null | {
    country: string;
    taxYear: string;
    rentRelief: number;
    contributions: { name: string; amount: number }[];
    taxable: number;
    incomeTax: number;
    netAnnual: number;
  };
};

const byName = (rows: CategoryTotal[], name: string) => rows.find((r) => r.name.toLowerCase() === name.toLowerCase())?.total ?? 0;

export function buildTaxSummary(year: number, income: CategoryTotal[], expense: CategoryTotal[], preset?: CountryPreset): TaxSummary {
  const salary = byName(income, 'Salary');
  const housing = byName(expense, 'Housing');
  let estimate: TaxSummary['estimate'] = null;
  if (preset && salary > 0) {
    // The tax engine works in major units; the preset's example split stands in for the payslip breakdown.
    const gross = salary / 100;
    const tax = preset.tax;
    const r = calculateTax({
      grossAnnual: gross,
      preTaxDeductions: 0,
      allowance: tax.allowance,
      brackets: tax.brackets,
      contributions: tax.contributions,
      expenseDeduction: tax.expenseDeduction,
      credits: tax.credits,
      surchargePct: tax.surchargePct,
      alternativeBrackets: tax.alternativeBrackets,
      pay: examplePay(preset, gross),
      rentRelief: tax.rentRelief,
      rentPaid: housing / 100,
    });
    const cents = (v: number) => Math.round(v * 100);
    estimate = {
      country: preset.name,
      taxYear: tax.year,
      rentRelief: cents(r.rentRelief),
      contributions: r.contributions.map((c) => ({ name: c.name, amount: cents(c.amount) })),
      taxable: cents(r.taxable),
      incomeTax: cents(r.incomeTax),
      netAnnual: cents(r.netAnnual),
    };
  }
  return {
    year,
    income,
    expense,
    totalIncome: income.reduce((s, r) => s + r.total, 0),
    totalExpense: expense.reduce((s, r) => s + r.total, 0),
    salary,
    housing,
    estimate,
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Printable A4 HTML for the PDF. */
export function taxSummaryHtml(s: TaxSummary, currency: string) {
  const m = (cents: number) => esc(formatMoney(cents, currency));
  const rows = (list: CategoryTotal[]) =>
    list.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${r.count}</td><td class="n">${m(r.total)}</td></tr>`).join('');
  const e = s.estimate;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;margin:32px;font-size:12px}
    h1{color:#0F766E;font-size:22px;margin:0}h2{font-size:15px;margin:22px 0 6px;color:#064E3B}
    .meta{color:#64748b;margin:4px 0 16px}table{width:100%;border-collapse:collapse}
    td,th{padding:6px 4px;border-bottom:1px solid #e2e8f0;text-align:left}th{color:#64748b;font-weight:600}
    .n{text-align:right;font-variant-numeric:tabular-nums}.total td{font-weight:700;border-top:2px solid #0f172a}
    .box{background:#F0FDFA;border:1px solid #99F6E4;border-radius:8px;padding:10px 12px;margin-top:8px}
    .note{color:#64748b;font-size:10px;margin-top:20px;line-height:1.5}
  </style></head><body>
  <h1>BudT annual summary ${s.year}</h1>
  <div class="meta">1 January – 31 December ${s.year} · amounts in ${esc(currency)} · generated ${esc(new Date().toLocaleDateString())}</div>
  <h2>Income</h2>
  <table><tr><th>Category</th><th class="n">Entries</th><th class="n">Total</th></tr>${rows(s.income)}
  <tr class="total"><td>Total income</td><td></td><td class="n">${m(s.totalIncome)}</td></tr></table>
  <h2>Spending</h2>
  <table><tr><th>Category</th><th class="n">Entries</th><th class="n">Total</th></tr>${rows(s.expense)}
  <tr class="total"><td>Total spending</td><td></td><td class="n">${m(s.totalExpense)}</td></tr></table>
  ${
    e
      ? `<h2>Estimated income tax on salary (${esc(e.country)}, ${esc(e.taxYear)} rules)</h2>
  <table>
    <tr><td>Salary recorded in BudT</td><td class="n">${m(s.salary)}</td></tr>
    ${e.contributions.map((c) => `<tr><td>${esc(c.name)}</td><td class="n">${m(c.amount)}</td></tr>`).join('')}
    ${e.rentRelief ? `<tr><td>Rent relief (from ${m(s.housing)} housing payments)</td><td class="n">${m(e.rentRelief)}</td></tr>` : ''}
    <tr><td>Taxable income</td><td class="n">${m(e.taxable)}</td></tr>
    <tr class="total"><td>Estimated income tax for the year</td><td class="n">${m(e.incomeTax)}</td></tr>
    <tr><td>Estimated take-home after tax and contributions</td><td class="n">${m(e.netAnnual)}</td></tr>
  </table>
  <div class="box">Compare the estimated tax with the PAYE shown on your payslips or your employer's year-end tax certificate. A large difference may mean a refund is due, or that other income needs declaring.</div>`
      : ''
  }
  <p class="note">Prepared from records you entered in BudT. Salary uses an example split of basic pay and allowances, and the
  estimate covers a single person with no other reliefs. Tax years differ by country (for example April–April or July–June).
  This is not tax advice: confirm figures with your tax authority or a tax professional before filing.</p>
  </body></html>`;
}
