/**
 * Import of the Excel workbook "Order-, inkoop- en betaalsheet".
 *
 * - Reads only manually entered cells as data; formula results are used for reconciliation only.
 * - Safe to run twice: existing PI#, PO#, batch#, customers, suppliers, products are recognised and skipped.
 * - Every row that is not imported, or imported with a remark, is written to import_issues with its raw content.
 * - The caller decides on commit or rollback (dry run).
 */
import * as XLSX from 'xlsx';

export interface Db { query(sql: string, params?: any[]): Promise<{ rows: any[] }>; }

export interface ImportOptions {
  /** Supplier names on the Leveranciers sheet that must not become suppliers (decision 16: "Your Products B.V." is the company itself). */
  skipSuppliers?: string[];
}

export interface Issue { severity: 'info' | 'warning' | 'error'; sheet: string; row: number | null; code: string; message: string; raw?: any; }
export interface ReconRow { area: string; item: string; excel: number | null; app: number | null; diff: number | null; ok: boolean; note?: string; }
export interface ImportResult { runId: string; created: Record<string, number>; skipped: Record<string, number>; issues: Issue[]; reconciliation: ReconRow[]; }

type Cell = { v: any; f?: string };
type Row = { n: number; c: Record<string, Cell> };

const STATUS_MAP: Record<string, string> = {
  'PI verstuurd': 'pi_sent', 'PO ontvangen': 'po_received', 'Aanbetaling ontvangen': 'deposit_received',
  'In productie': 'in_production', 'Klaar voor verzending': 'ready_to_ship', 'Verscheept': 'shipped',
  'Opgehaald / geleverd': 'delivered', 'Afgerond': 'completed', 'Geannuleerd': 'cancelled',
};

const xlDate = (v: any): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  const m = String(v).match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};
const txt = (v: any): string | null => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
const numv = (v: any): number | null => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? null : Number(v));

function readSheet(wb: XLSX.WorkBook, name: string, firstRow = 5): Row[] {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet "${name}" not found`);
  const range = XLSX.utils.decode_range(ws['!ref']!);
  const rows: Row[] = [];
  for (let r = firstRow - 1; r <= range.e.r; r++) {
    const c: Record<string, Cell> = {};
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: col })];
      if (cell && cell.v !== undefined && cell.v !== '') c[XLSX.utils.encode_col(col)] = { v: cell.v, f: cell.f };
    }
    rows.push({ n: r + 1, c });
  }
  return rows;
}
/** manually typed value (cells holding a formula are not data) */
const man = (r: Row, col: string) => (r.c[col] && !r.c[col].f ? r.c[col].v : undefined);
/** value as Excel shows it, typed or calculated */
const val = (r: Row, col: string) => r.c[col]?.v;
const hasManual = (r: Row) => Object.values(r.c).some(c => !c.f);
const rawOf = (r: Row) => Object.fromEntries(Object.entries(r.c).filter(([, c]) => !c.f).map(([k, c]) => [k, c.v]));

export async function importWorkbook(db: Db, data: Uint8Array, fileName: string, opts: ImportOptions = {}): Promise<ImportResult> {
  const skipSuppliers = opts.skipSuppliers ?? ['Your Products B.V.'];
  const wb = XLSX.read(data, { type: 'array', cellFormula: true, cellDates: false });
  const issues: Issue[] = [];
  const created: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
  const issue = (severity: Issue['severity'], sheet: string, row: Row | null, code: string, message: string) =>
    issues.push({ severity, sheet, row: row?.n ?? null, code, message, raw: row ? rawOf(row) : undefined });
  const q = async (sql: string, p: any[] = []) => (await db.query(sql, p)).rows;
  const q1 = async (sql: string, p: any[] = []) => (await q(sql, p))[0];

  const runId: string = (await q1(`insert into import_runs (file_name) values ($1) returning id`, [fileName])).id;

  /** insert unless a row with this natural key exists; returns [id, wasCreated] */
  const ensure = async (table: string, keyCol: string, key: string, cols: Record<string, any>): Promise<[string, boolean]> => {
    const ex = await q1(`select id from ${table} where ${keyCol} = $1`, [key]);
    if (ex) { bump(skipped, table); return [ex.id, false]; }
    const names = [keyCol, ...Object.keys(cols)];
    const row = await q1(`insert into ${table} (${names.join(',')}) values (${names.map((_, i) => '$' + (i + 1)).join(',')}) returning id`,
      [key, ...Object.values(cols)]);
    bump(created, table);
    return [row.id, true];
  };
  const pct = (v: any, sheet: string, r: Row, what: string): number => {
    let n = numv(v) ?? 0;
    if (n > 1) { issue('warning', sheet, r, 'percentage_normalised', `${what} was entered as ${n}; read as ${n}% = ${n / 100}`); n = n / 100; }
    return n;
  };

  // ---------------- Klanten ----------------
  const customers = new Map<string, string>();
  for (const r of readSheet(wb, 'Klanten')) {
    const name = txt(man(r, 'A')); if (!name) { if (hasManual(r)) issue('error', 'Klanten', r, 'row_without_name', 'Row has data but no customer name'); continue; }
    const [id, isNew] = await ensure('customers', 'name', name, {
      country: txt(man(r, 'B')), vat_number: txt(man(r, 'C')), contact_name: txt(man(r, 'D')), email: txt(man(r, 'E')), notes: txt(man(r, 'J')) });
    customers.set(name, id);
    if (isNew) {
      await q(`insert into customer_terms (customer_id, order_type, deposit_pct, payment_days) values ($1,'EXW',$2,$3), ($1,'FOB',$4,$5)`,
        [id, pct(man(r, 'G'), 'Klanten', r, 'Aanbetaling % EXW'), numv(man(r, 'F')) ?? 0, pct(man(r, 'I'), 'Klanten', r, 'Aanbetaling % FOB'), numv(man(r, 'H')) ?? 0]);
    }
  }

  // ---------------- Leveranciers ----------------
  // "Name EXW" / "Name FOB" are one supplier with a set of terms per order type.
  const supplierByExcelName = new Map<string, { id: string; type: 'EXW' | 'FOB' | null }>();
  const supplierByBase = new Map<string, string>();
  for (const r of readSheet(wb, 'Leveranciers')) {
    const name = txt(man(r, 'A')); if (!name) { if (hasManual(r)) issue('error', 'Leveranciers', r, 'row_without_name', 'Row has data but no supplier name'); continue; }
    if (skipSuppliers.includes(name)) {
      issue('warning', 'Leveranciers', r, 'supplier_not_imported', `"${name}" is the company itself, not a supplier: skipped.`);
      continue;
    }
    const m = name.match(/^(.*\S)\s+(EXW|FOB)$/);
    const base = m ? m[1] : name;
    const currency = txt(man(r, 'C'));
    const type = (m ? m[2] : currency === 'USD' ? 'FOB' : currency === 'EUR' ? 'EXW' : null) as 'EXW' | 'FOB' | null;
    const [id] = supplierByBase.has(base) ? [supplierByBase.get(base)!] :
      await ensure('suppliers', 'name', base, { country: txt(man(r, 'B')), contact_name: txt(man(r, 'E')), email: txt(man(r, 'F')), notes: txt(man(r, 'G')) });
    supplierByBase.set(base, id);
    supplierByExcelName.set(name, { id, type });
    if (m) issue('info', 'Leveranciers', r, 'supplier_merged', `"${name}" merged into supplier "${base}" with ${type} terms`);
    if (type) {
      await q(`insert into supplier_terms (supplier_id, order_type, currency, deposit_pct) values ($1,$2,$3,$4) on conflict do nothing`,
        [id, type, currency ?? (type === 'FOB' ? 'USD' : 'EUR'), pct(man(r, 'D'), 'Leveranciers', r, 'Aanbetaling %')]);
    } else issue('warning', 'Leveranciers', r, 'supplier_without_currency', `No currency for "${name}": no payment terms stored`);
  }
  const findSupplier = (excelName: string | null) =>
    excelName ? supplierByExcelName.get(excelName) ?? (supplierByBase.has(excelName) ? { id: supplierByBase.get(excelName)!, type: null } : undefined) : undefined;

  // ---------------- Producten ----------------
  const products = new Map<string, string>();
  const productSupplier = new Map<string, string>();
  for (const r of readSheet(wb, 'Producten')) {
    const name = txt(man(r, 'A')); if (!name) { if (hasManual(r)) issue('error', 'Producten', r, 'row_without_name', 'Row has data but no product name'); continue; }
    const supName = txt(man(r, 'D')); const sup = findSupplier(supName);
    if (supName && !sup) issue('warning', 'Producten', r, 'unknown_supplier', `Supplier "${supName}" is not on Leveranciers; product imported without supplier`);
    const [id, isNew] = await ensure('products', 'name', name, {
      sku: txt(man(r, 'B')), kind: txt(man(r, 'C')), default_supplier_id: sup?.id ?? null, carton_dimensions: txt(man(r, 'K')),
      carton_weight_kg: numv(man(r, 'L')), units_per_carton: numv(man(r, 'M')), units_20ft: numv(man(r, 'N')), units_40ft: numv(man(r, 'O')),
      units_40hc: numv(man(r, 'P')), notes: txt(man(r, 'Q')) });
    products.set(name, id);
    if (sup) productSupplier.set(id, sup.id);
    if (isNew) {
      for (const [type, b, s, roy] of [['FOB', 'E', 'F', 'G'], ['EXW', 'H', 'I', 'J']] as const) {
        const vals = [numv(man(r, b)), numv(man(r, s)), numv(man(r, roy))];
        if (vals.some(v => v !== null)) {
          await q(`insert into product_cost_rules (product_id, order_type, cost_basis, share_above_basis, royalty_per_unit) values ($1,$2,$3,$4,$5)`, [id, type, ...vals]);
          bump(created, 'product_cost_rules');
        }
      }
      if (![man(r, 'E'), man(r, 'F'), man(r, 'H'), man(r, 'I')].some(v => numv(v) !== null))
        issue('info', 'Producten', r, 'product_without_cost_rule', `"${name}" has no cost rule yet`);
    }
  }

  // ---------------- Prijzen ----------------
  for (const r of readSheet(wb, 'Prijzen')) {
    if (!hasManual(r)) continue;
    const pid = products.get(txt(man(r, 'A')) ?? ''); const type = txt(man(r, 'C')); const price = numv(man(r, 'D'));
    const custName = txt(man(r, 'B')); const cid = custName ? customers.get(custName) : null;
    if (!pid || !type || price === null || (custName && !cid)) { issue('error', 'Prijzen', r, 'price_agreement_incomplete', 'Unknown product/customer, or type/price missing: not imported'); continue; }
    const ex = await q1(`select id from price_agreements where product_id=$1 and customer_id is not distinct from $2::uuid and order_type=$3 and sale_price=$4
                          and valid_from is not distinct from $5::date and valid_to is not distinct from $6::date`,
      [pid, cid, type, price, xlDate(man(r, 'G')), xlDate(man(r, 'H'))]);
    if (ex) { bump(skipped, 'price_agreements'); continue; }
    await q(`insert into price_agreements (product_id, customer_id, order_type, sale_price, moq, valid_from, valid_to, notes, agreed_cost) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [pid, cid, type, price, numv(man(r, 'F')), xlDate(man(r, 'G')), xlDate(man(r, 'H')), txt(man(r, 'I')), numv(man(r, 'J'))]);
    bump(created, 'price_agreements');
  }

  // ---------------- Batches / Batch inhoud / Voorraad mutaties ----------------
  const batches = new Map<string, { id: string; isNew: boolean; date: string | null }>();
  for (const r of readSheet(wb, 'Batches')) {
    const no = txt(man(r, 'A')); if (!no) { if (hasManual(r)) issue('error', 'Batches', r, 'row_without_number', 'Row has data but no batch#'); continue; }
    const sup = findSupplier(txt(man(r, 'B')));
    if (txt(man(r, 'B')) && !sup) issue('warning', 'Batches', r, 'unknown_supplier', `Supplier "${man(r, 'B')}" unknown; batch imported without supplier`);
    const date = xlDate(man(r, 'D'));
    const [id, isNew] = await ensure('batches', 'batch_number', no, { supplier_id: sup?.id ?? null, reference: txt(man(r, 'C')), received_date: date, notes: txt(man(r, 'E')) });
    batches.set(no, { id, isNew, date });
  }
  const batchItems = new Map<string, { id: string; isNew: boolean }>();   // key: batch|product
  for (const r of readSheet(wb, 'Batch inhoud')) {
    const no = txt(man(r, 'A')); const pname = txt(man(r, 'B'));
    if (!no && !pname) continue;
    const b = batches.get(no ?? ''); const pid = products.get(pname ?? '');
    if (!b || !pid) { issue('error', 'Batch inhoud', r, 'batch_item_unresolved', `Batch "${no}" or product "${pname}" unknown: not imported`); continue; }
    const typedDate = xlDate(man(r, 'D'));        // normally a formula; a typed date belongs on the batch
    if (typedDate && !b.date) {
      await q(`update batches set received_date = $2 where id = $1 and received_date is null`, [b.id, typedDate]);
      b.date = typedDate;
      issue('info', 'Batch inhoud', r, 'receipt_date_moved_to_batch', `Receipt date ${typedDate} was typed over the formula; stored on batch ${no}`);
    } else if (typedDate && b.date !== typedDate) issue('warning', 'Batch inhoud', r, 'receipt_date_conflict', `Typed date ${typedDate} differs from batch date ${b.date}; batch date kept`);
    const ex = await q1(`select id from batch_items where batch_id=$1 and product_id=$2`, [b.id, pid]);
    if (ex) { batchItems.set(`${no}|${pname}`, { id: ex.id, isNew: false }); bump(skipped, 'batch_items'); continue; }
    const row = await q1(`insert into batch_items (batch_id, product_id, qty_received, cost_basis, share_above_basis, notes) values ($1,$2,$3,$4,$5,$6) returning id`,
      [b.id, pid, numv(man(r, 'E')) ?? 0, numv(man(r, 'F')), numv(man(r, 'G')), txt(man(r, 'M'))]);
    batchItems.set(`${no}|${pname}`, { id: row.id, isNew: true }); bump(created, 'batch_items');
  }
  for (const r of readSheet(wb, 'Voorraad mutaties')) {
    if (!hasManual(r)) continue;
    const bi = batchItems.get(`${txt(man(r, 'B'))}|${txt(man(r, 'C'))}`); const qty = numv(man(r, 'E'));
    if (!bi || !qty) { issue('error', 'Voorraad mutaties', r, 'adjustment_unresolved', 'Batch/product unknown or quantity missing: not imported'); continue; }
    if (!bi.isNew) { bump(skipped, 'stock_adjustments'); continue; }      // batch was imported before: its corrections are already in
    await q(`insert into stock_adjustments (adjustment_date, batch_item_id, kind, quantity, reference, notes) values ($1,$2,$3,$4,$5,$6)`,
      [xlDate(man(r, 'A')), bi.id, txt(man(r, 'D')), qty, txt(man(r, 'F')), txt(man(r, 'G'))]);
    bump(created, 'stock_adjustments');
  }

  // ---------------- read order lines first: POs need them for type and supplier ----------------
  const lineRows = readSheet(wb, 'Orderregels').filter(r => ['A', 'B', 'C', 'I', 'J', 'K'].some(c => man(r, c) !== undefined));
  const poUse = new Map<string, { type: string | null; productId: string | undefined }>();
  for (const r of lineRows) {
    const po = txt(man(r, 'L'));
    if (po && !poUse.has(po)) poUse.set(po, { type: txt(man(r, 'B')), productId: products.get(txt(man(r, 'I')) ?? '') });
  }

  // ---------------- Inkoop orders ----------------
  const pos = new Map<string, { id: string; isNew: boolean; row?: Row }>();
  for (const r of readSheet(wb, 'Inkoop orders')) {
    const no = txt(man(r, 'A')); if (!no) { if (hasManual(r)) issue('error', 'Inkoop orders', r, 'row_without_number', 'Row has data but no PO#'); continue; }
    const sup = findSupplier(txt(man(r, 'B')));
    if (!sup) { issue('error', 'Inkoop orders', r, 'unknown_supplier', `Supplier "${man(r, 'B') ?? ''}" unknown: PO ${no} not imported`); continue; }
    const type = sup.type ?? poUse.get(no)?.type ?? null;
    if (!type) { issue('error', 'Inkoop orders', r, 'po_type_unknown', `Cannot tell whether PO ${no} is EXW or FOB: not imported`); continue; }
    const [id, isNew] = await ensure('purchase_orders', 'po_number', no, { supplier_id: sup.id, order_type: type, po_date: xlDate(man(r, 'D')), notes: txt(man(r, 'R')) });
    pos.set(no, { id, isNew, row: r });
  }
  const posNotOnSheet: string[] = [];
  for (const [no, use] of poUse) {
    if (pos.has(no)) continue;
    const supId = use.productId ? productSupplier.get(use.productId) : undefined;
    if (!supId || !use.type) { issue('error', 'Orderregels', null, 'po_unresolved', `PO ${no} is used on order lines but is not on Inkoop orders and no supplier can be derived: lines imported without PO`); continue; }
    const [id, isNew] = await ensure('purchase_orders', 'po_number', no, { supplier_id: supId, order_type: use.type, po_date: null, notes: 'Created by import: PO was not on the Inkoop orders sheet' });
    pos.set(no, { id, isNew });
    posNotOnSheet.push(no);
    if (isNew) issue('warning', 'Inkoop orders', null, 'po_missing_from_purchase_sheet', `PO ${no} is used on order lines but missing from Inkoop orders; created from the order lines so the payable is visible`);
  }

  // ---------------- PI overzicht (indexed by PI#) ----------------
  const piRows = new Map<string, Row>();
  for (const r of readSheet(wb, 'PI overzicht')) {
    const pi = txt(man(r, 'A')); if (!pi) { if (hasManual(r)) issue('error', 'PI overzicht', r, 'row_without_pi', 'Row has data but no PI#'); continue; }
    if (piRows.has(pi)) { issue('error', 'PI overzicht', r, 'duplicate_pi', `PI ${pi} appears twice on PI overzicht; second row ignored`); continue; }
    piRows.set(pi, r);
  }

  // ---------------- Orderregels -> orders and lines ----------------
  const groups = new Map<string, Row[]>();
  for (const r of lineRows) {
    const pi = txt(man(r, 'A'));
    const key = pi ? `PI|${pi}` : `DRAFT|${txt(man(r, 'C'))}|${txt(man(r, 'B'))}|${txt(man(r, 'D'))}|${xlDate(man(r, 'E'))}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const orders = new Map<string, { id: string; isNew: boolean; rows: Row[] }>();   // by PI#
  const missingFromOverview: string[] = [];
  for (const [key, rows] of groups) {
    const first = rows[0]; const pi = txt(man(first, 'A'));
    const type = txt(man(first, 'B')); const custName = txt(man(first, 'C')); const cid = customers.get(custName ?? '');
    if (!type || !cid) { for (const r of rows) issue('error', 'Orderregels', r, 'order_header_unresolved', `Type missing or customer "${custName}" not on Klanten: line not imported`); continue; }
    if (rows.some(r => txt(man(r, 'B')) !== type || txt(man(r, 'C')) !== custName)) {
      for (const r of rows) issue('error', 'Orderregels', r, 'header_differs_within_pi', `Type or customer differs within PI ${pi}: order not imported`); continue;
    }
    const dates = rows.map(r => xlDate(man(r, 'E'))).filter(Boolean) as string[];
    const poDate = dates.length ? dates.sort()[0] : null;
    if (new Set(dates).size > 1) issue('info', 'Orderregels', first, 'several_po_dates', `PI ${pi}: lines carry ${[...new Set(dates)].join(', ')}; order date = ${poDate}, each line keeps its own date`);
    const custPo = rows.map(r => txt(man(r, 'D'))).find(Boolean) ?? null;

    let status = 'draft'; const ov = pi ? piRows.get(pi) : undefined;
    if (pi) {
      const label = ov ? txt(man(ov, 'H')) : null;
      status = label ? STATUS_MAP[label] : 'pi_sent';
      if (!ov) { missingFromOverview.push(pi); issue('warning', 'PI overzicht', null, 'pi_missing_from_overview', `PI ${pi} has order lines but is not on PI overzicht; imported as "PI verstuurd" so the receivable is visible`); }
      else if (!label) issue('warning', 'PI overzicht', ov, 'status_missing', `PI ${pi} has no status; imported as "PI verstuurd"`);
      else if (!status) { issue('error', 'PI overzicht', ov, 'unknown_status', `Unknown status "${label}"; imported as "PI verstuurd"`); status = 'pi_sent'; }
    } else issue('warning', 'Orderregels', first, 'order_without_pi', `Order for ${custName} has no PI# yet: imported as draft. Drafts do not count in revenue or receivables.`);

    if (pi) {
      const ex = await q1(`select id from sales_orders where pi_number = $1`, [pi]);
      if (ex) { orders.set(pi, { id: ex.id, isNew: false, rows }); bump(skipped, 'sales_orders'); continue; }
    } else {
      const ex = await q1(`select id from sales_orders where pi_number is null and customer_id=$1 and order_type=$2 and customer_po is not distinct from $3::text and po_date is not distinct from $4::date`, [cid, type, custPo, poDate]);
      if (ex) { bump(skipped, 'sales_orders'); continue; }
    }
    const o = await q1(`insert into sales_orders (pi_number, order_type, customer_id, customer_po, po_date, status, notes) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [pi, type, cid, custPo, poDate, status, ov ? txt(man(ov, 'Y')) : null]);
    bump(created, 'sales_orders');
    if (pi) orders.set(pi, { id: o.id, isNew: true, rows });

    let lineNo = 0;
    for (const r of rows) {
      lineNo++;
      const pname = txt(man(r, 'I')); const pid = products.get(pname ?? ''); const qty = numv(man(r, 'J')); const price = numv(man(r, 'K'));
      if (!pid || !qty || price === null) { issue('error', 'Orderregels', r, 'line_incomplete', `Product "${pname ?? ''}" unknown, or quantity/price missing: line not imported`); continue; }
      const poNo = txt(man(r, 'L')); const batchNo = txt(man(r, 'M'));
      const bi = batchNo ? batchItems.get(`${batchNo}|${pname}`) : undefined;
      if (batchNo && !bi) issue('warning', 'Orderregels', r, 'batch_unresolved', `Batch ${batchNo} does not contain "${pname}": line imported without batch`);
      if (poNo && !pos.has(poNo)) issue('warning', 'Orderregels', r, 'po_link_dropped', `PO ${poNo} could not be created: line imported without PO`);
      const d = xlDate(man(r, 'E'));
      const line = await q1(`insert into sales_order_lines (sales_order_id, line_no, product_id, quantity, unit_price, line_date, purchase_order_id, batch_item_id, cost_override, notes)
                             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [o.id, lineNo, pid, qty, price, d && d !== poDate ? d : null, poNo ? pos.get(poNo)?.id ?? null : null, bi?.id ?? null, numv(man(r, 'N')), txt(man(r, 'Y'))]);
      bump(created, 'sales_order_lines');
      const extra = numv(man(r, 'R'));
      if (extra) { await q(`insert into order_cost_lines (sales_order_line_id, kind, amount, notes) values ($1,'other',$2,'Extra kosten (vracht, commissie) from Excel')`, [line.id, extra]); bump(created, 'order_cost_lines'); }
    }
  }

  // ---------------- PI overzicht: corrections, invoice, payments, write-off ----------------
  const bookPayment = async (dir: 'in' | 'out', party: string, target: string, currency: string, date: string | null, amount: number, ref: string, sheet: string, r: Row, fallbackDate: string | null) => {
    let d = date;
    if (!d) { d = fallbackDate; issue('warning', sheet, r, 'payment_without_date', `${ref}: amount ${amount} has no date; booked on ${d ?? 'today'}`); }
    const p = await q1(`insert into payments (direction, ${dir === 'in' ? 'customer_id' : 'supplier_id'}, payment_date, amount, currency, reference, notes)
                        values ($1,$2,coalesce($3::date, current_date),$4,$5,$6,'Imported from Excel') returning id`, [dir, party, d, amount, currency, ref]);
    await q(`insert into payment_allocations (payment_id, ${dir === 'in' ? 'sales_order_id' : 'purchase_order_id'}, amount) values ($1,$2,$3)`, [p.id, target, amount]);
    bump(created, 'payments');
  };
  for (const [pi, r] of piRows) {
    const o = orders.get(pi);
    if (!o) { issue('warning', 'PI overzicht', r, 'pi_without_order_lines', `PI ${pi} is on PI overzicht but has no importable order lines: not imported`); continue; }
    if (!o.isNew) continue;
    const head = await q1(`select so.customer_id, so.po_date, so.status, t.currency from sales_orders so join order_types t on t.code = so.order_type where so.id=$1`, [o.id]);
    const corr = numv(man(r, 'J'));
    if (corr) { await q(`insert into order_adjustments (sales_order_id, amount, reason) values ($1,$2,'Imported from Excel: Correctie (+/-)')`, [o.id, corr]); bump(created, 'order_adjustments'); }
    const invNo = txt(man(r, 'P')); const invDate = xlDate(man(r, 'Q'));
    if (invNo && invDate) { await q(`insert into invoices (sales_order_id, invoice_number, invoice_date) values ($1,$2,$3)`, [o.id, invNo, invDate]); bump(created, 'invoices'); }
    else if (invNo || invDate) issue('warning', 'PI overzicht', r, 'invoice_incomplete', `PI ${pi}: invoice needs both number and date; not imported`);
    const dep = numv(man(r, 'O')), bal = numv(man(r, 'T')), wo = numv(man(r, 'U'));
    if ((dep || bal) && ['draft', 'cancelled'].includes(head.status)) { issue('error', 'PI overzicht', r, 'payment_on_closed_order', `PI ${pi} is ${head.status} but has payments; payments not imported`); }
    else {
      if (dep) await bookPayment('in', head.customer_id, o.id, head.currency, xlDate(man(r, 'N')), dep, `Excel aanbetaling PI ${pi}`, 'PI overzicht', r, head.po_date);
      if (bal) await bookPayment('in', head.customer_id, o.id, head.currency, xlDate(man(r, 'S')), bal, `Excel restbetaling PI ${pi}`, 'PI overzicht', r, invDate ?? head.po_date);
    }
    if (wo) { await q(`insert into write_offs (sales_order_id, amount, reason) values ($1,$2,'Imported from Excel: Afgeschreven (bankkosten/verschil)')`, [o.id, wo]); bump(created, 'write_offs'); }
  }
  // requested deposit is fixed for everything past draft
  for (const o of orders.values()) if (o.isNew) await q(`select recalculate_deposit(id) from sales_orders where id=$1 and status not in ('draft','cancelled')`, [o.id]);
  // the import must reproduce the statuses of the workbook, not advance them
  for (const [pi, o] of orders) {
    if (!o.isNew) continue;
    const ov = piRows.get(pi); const want = ov && txt(man(ov, 'H')) ? STATUS_MAP[txt(man(ov, 'H'))!] : 'pi_sent';
    const cur = (await q1(`select status from sales_orders where id=$1`, [o.id])).status;
    if (want && cur !== want) issue('info', 'PI overzicht', ov ?? null, 'status_advanced', `PI ${pi}: deposit is covered, status moved from "${want}" to "${cur}"`);
  }

  // ---------------- Inkoop orders: supplier invoice and payments ----------------
  for (const [no, p] of pos) {
    if (!p.isNew || !p.row) continue; const r = p.row;
    const head = await q1(`select supplier_id, currency, po_date from purchase_orders where id=$1`, [p.id]);
    const invAmt = numv(man(r, 'G'));
    if (invAmt !== null) { await q(`insert into supplier_invoices (purchase_order_id, invoice_number, amount) values ($1,$2,$3)`, [p.id, txt(man(r, 'I')), invAmt]); bump(created, 'supplier_invoices'); }
    else if (txt(man(r, 'I'))) issue('warning', 'Inkoop orders', r, 'supplier_invoice_without_amount', `PO ${no}: invoice number without amount; not imported`);
    const dep = numv(man(r, 'M')), bal = numv(man(r, 'O'));
    if (dep) await bookPayment('out', head.supplier_id, p.id, head.currency, xlDate(man(r, 'L')), dep, `Excel aanbetaling PO ${no}`, 'Inkoop orders', r, head.po_date);
    if (bal) await bookPayment('out', head.supplier_id, p.id, head.currency, xlDate(man(r, 'N')), bal, `Excel restbetaling PO ${no}`, 'Inkoop orders', r, head.po_date);
    const piTyped = txt(man(r, 'C'));
    if (piTyped) {
      const linked = (await q1(`select pi_numbers from v_purchase_orders where id=$1`, [p.id]))?.pi_numbers ?? '';
      if (!String(linked).split(', ').includes(piTyped)) issue('warning', 'Inkoop orders', r, 'po_pi_mismatch', `PO ${no} names PI ${piTyped}, but its order lines belong to "${linked}"`);
    }
  }

  // ---------------- Shipping ----------------
  for (const r of readSheet(wb, 'Shipping')) {
    if (!hasManual(r)) continue;
    const pi = txt(man(r, 'A')); const poNo = txt(man(r, 'C'));
    const o = pi ? orders.get(pi) : undefined; const p = poNo ? pos.get(poNo) : undefined;
    if (!o && !p) { issue('error', 'Shipping', r, 'shipment_unresolved', `PI ${pi ?? '-'} / PO ${poNo ?? '-'} unknown: shipment not imported`); continue; }
    const ex = await q1(`select 1 as x from shipment_orders where sales_order_id is not distinct from $1::uuid and purchase_order_id is not distinct from $2::uuid`, [o?.id ?? null, p?.id ?? null]);
    if (ex) { bump(skipped, 'shipments'); continue; }
    const s = await q1(`insert into shipments (forwarder, container_number, bl_number, port_loading, port_discharge, ready_date, etd, eta, docs_complete, notes)
                        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [txt(man(r, 'D')), txt(man(r, 'E')), txt(man(r, 'F')), txt(man(r, 'G')), txt(man(r, 'H')), xlDate(man(r, 'I')), xlDate(man(r, 'J')), xlDate(man(r, 'K')), txt(man(r, 'L')) === 'Ja', txt(man(r, 'N'))]);
    await q(`insert into shipment_orders (shipment_id, sales_order_id, purchase_order_id) values ($1,$2,$3)`, [s.id, o?.id ?? null, p?.id ?? null]);
    bump(created, 'shipments');
    if (pi && !o) issue('warning', 'Shipping', r, 'shipment_pi_unknown', `PI ${pi} unknown; shipment linked to PO ${poNo} only`);
  }

  // ---------------- reconciliation against the figures Excel shows ----------------
  const recon: ReconRow[] = [];
  const cmp = (area: string, item: string, excel: any, app: any, note?: string) => {
    const e = numv(excel), a = numv(app);
    const diff = e === null || a === null ? null : Math.round((a - e) * 100) / 100;
    recon.push({ area, item, excel: e, app: a, diff, ok: (e ?? 0) === 0 && a === null ? true : diff !== null && Math.abs(diff) <= 0.01, note });
  };
  // order lines
  const seq = new Map<string, number>();
  for (const r of lineRows) {
    const pi = txt(man(r, 'A')); if (!pi || !orders.get(pi)) continue;
    const n = (seq.get(pi) ?? 0) + 1; seq.set(pi, n);
    const l = await q1(`select revenue, purchase_value, margin from v_order_lines where pi_number=$1 and line_no=$2`, [pi, n]);
    cmp('Order lines', `PI ${pi} line ${n} revenue`, val(r, 'S'), l?.revenue);
    cmp('Order lines', `PI ${pi} line ${n} purchase value`, val(r, 'T'), l?.purchase_value);
    cmp('Order lines', `PI ${pi} line ${n} margin`, val(r, 'V'), l?.margin);
  }
  for (const [pi, r] of piRows) {
    const v = await q1(`select order_value, total_receivable, deposit_due, outstanding from v_orders where pi_number=$1`, [pi]);
    cmp('PI overzicht', `PI ${pi} order value`, val(r, 'I'), v?.order_value);
    cmp('PI overzicht', `PI ${pi} total receivable`, val(r, 'K'), v?.total_receivable);
    cmp('PI overzicht', `PI ${pi} deposit requested`, val(r, 'M'), v?.deposit_due);
    cmp('PI overzicht', `PI ${pi} outstanding`, val(r, 'V'), v?.outstanding);
  }
  for (const [no, p] of pos) {
    if (!p.row) continue;
    const v = await q1(`select expected_amount, deposit_due, outstanding from v_purchase_orders where id=$1`, [p.id]);
    cmp('Inkoop orders', `PO ${no} expected amount`, val(p.row, 'F'), v?.expected_amount);
    cmp('Inkoop orders', `PO ${no} deposit to pay`, val(p.row, 'K'), v?.deposit_due);
    cmp('Inkoop orders', `PO ${no} outstanding`, val(p.row, 'P'), v?.outstanding);
  }
  for (const r of readSheet(wb, 'Batch inhoud')) {
    const k = `${txt(man(r, 'A'))}|${txt(man(r, 'B'))}`; const bi = batchItems.get(k); if (!bi) continue;
    cmp('Stock', `Batch ${k.replace('|', ' / ')} stock`, val(r, 'J'), (await q1(`select stock from v_batch_item_stock where batch_item_id=$1`, [bi.id]))?.stock);
  }
  for (const r of readSheet(wb, 'Producten')) {
    const name = txt(man(r, 'A')); if (!name) continue;
    cmp('Stock', `${name} NL stock`, val(r, 'T'), (await q1(`select stock from v_product_stock where product_id=$1`, [products.get(name)]))?.stock);
  }
  // dashboard
  const dash = wb.Sheets['Dashboard']; const dv = (a: string) => dash[a]?.v;
  const year = numv(dv('C4'));
  const sumOf = async (sql: string, p: any[]) => (await q1(sql, p))?.x ?? 0;
  const inList = (a: string[]) => (a.length ? a : ['-']);
  const missPo = posNotOnSheet;
  for (const [type, cur, col] of [['EXW', 'EUR', 'C'], ['FOB', 'USD', 'D']] as const) {
    cmp('Dashboard', `Revenue ${year} ${type}`, dv(col + '7'), await sumOf(`select coalesce(sum(revenue),0) x from v_revenue_monthly where year=$1 and order_type=$2`, [year, type]));
    cmp('Dashboard', `Margin ${year} ${type}`, dv(col + '8'), await sumOf(`select coalesce(sum(margin),0) x from v_revenue_monthly where year=$1 and order_type=$2`, [year, type]));
    const recvAll = Number(await sumOf(`select coalesce(sum(receivable),0) x from v_outstanding_summary where currency=$1`, [cur]));
    const recvMissing = Number(await sumOf(`select coalesce(sum(greatest(outstanding,0)),0) x from v_orders where currency=$1 and pi_number = any($2::text[])`, [cur, inList(missingFromOverview)]));
    cmp('Dashboard', `Outstanding at customers ${cur}, PIs on PI overzicht only`, dv(col + '10'), recvAll - recvMissing);
    if (recvMissing) recon.push({ area: 'Dashboard', item: `Outstanding at customers ${cur}, all orders`, excel: numv(dv(col + '10')), app: recvAll, diff: Math.round(recvMissing * 100) / 100, ok: true, note: `Difference = PI ${missingFromOverview.join(', ')}, missing from PI overzicht` });
    const payAll = Number(await sumOf(`select coalesce(sum(payable),0) x from v_outstanding_summary where currency=$1`, [cur]));
    const payMissing = Number(await sumOf(`select coalesce(sum(greatest(outstanding,0)),0) x from v_purchase_orders where currency=$1 and po_number = any($2::text[])`, [cur, inList(missPo)]));
    cmp('Dashboard', `Outstanding at suppliers ${cur}, POs on Inkoop orders only`, dv(col + '12'), payAll - payMissing);
    if (payMissing) recon.push({ area: 'Dashboard', item: `Outstanding at suppliers ${cur}, all POs`, excel: numv(dv(col + '12')), app: payAll, diff: Math.round(payMissing * 100) / 100, ok: true, note: `Difference = PO ${missPo.join(', ')}, missing from Inkoop orders` });
    const openAll = Number(await sumOf(`select count(*) x from v_orders where order_type=$1 and is_open and status <> 'draft'`, [type]));
    const openMissing = Number(await sumOf(`select count(*) x from v_orders where order_type=$1 and is_open and pi_number = any($2::text[])`, [type, inList(missingFromOverview)]));
    cmp('Dashboard', `Open PIs ${type}, on PI overzicht only`, dv(col + '13'), openAll - openMissing);
  }

  // ---------------- store issues and summary ----------------
  for (const i of issues) {
    await q(`insert into import_issues (run_id, severity, sheet, row_no, code, message, raw) values ($1,$2,$3,$4,$5,$6,$7)`,
      [runId, i.severity, i.sheet, i.row, i.code, i.message, i.raw ? JSON.stringify(i.raw) : null]);
  }
  const summary = { created, skipped, issues: { error: issues.filter(i => i.severity === 'error').length, warning: issues.filter(i => i.severity === 'warning').length, info: issues.filter(i => i.severity === 'info').length },
    reconciliation: { checks: recon.length, failed: recon.filter(r => !r.ok).length } };
  await q(`update import_runs set summary = $2 where id = $1`, [runId, JSON.stringify(summary)]);
  return { runId, created, skipped, issues, reconciliation: recon };
}

export function reportMarkdown(file: string, res: ImportResult, mode: string): string {
  const f = (n: number | null) => (n === null ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const out: string[] = [`# Import report: ${file}`, '', `Mode: ${mode}`, ''];
  out.push('## Records', '', '| Table | Created | Already present |', '| --- | ---: | ---: |');
  for (const t of [...new Set([...Object.keys(res.created), ...Object.keys(res.skipped)])]) out.push(`| ${t} | ${res.created[t] ?? 0} | ${res.skipped[t] ?? 0} |`);
  out.push('', '## Issues', '', '| Severity | Sheet | Row | Code | Message |', '| --- | --- | ---: | --- | --- |');
  const order = { error: 0, warning: 1, info: 2 };
  for (const i of [...res.issues].sort((a, b) => order[a.severity] - order[b.severity])) out.push(`| ${i.severity} | ${i.sheet} | ${i.row ?? ''} | ${i.code} | ${i.message.replace(/\|/g, '/')} |`);
  if (!res.issues.length) out.push('| | | | | none |');
  const failed = res.reconciliation.filter(r => !r.ok);
  out.push('', '## Reconciliation with Excel', '', `${res.reconciliation.length} figures compared, ${failed.length} differ by more than 0.01.`, '',
    '| Area | Figure | Excel | App | Difference | Result |', '| --- | --- | ---: | ---: | ---: | --- |');
  for (const r of res.reconciliation) out.push(`| ${r.area} | ${r.item} | ${f(r.excel)} | ${f(r.app)} | ${f(r.diff)} | ${r.ok ? (r.note ?? 'ok') : 'DIFFERS'} |`);
  return out.join('\n') + '\n';
}
