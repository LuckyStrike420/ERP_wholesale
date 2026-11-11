/** Builds web/public/seed.json: the imported workbook as rows per table, loaded by the local test database in the browser. */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { freshDb } from '../tests/db.ts';
import { importWorkbook } from '../src/import/importer.ts';

export const SEED_TABLES = ['customers', 'customer_terms', 'suppliers', 'supplier_terms', 'products', 'product_cost_rules', 'price_agreements',
  'purchase_orders', 'supplier_invoices', 'batches', 'batch_items', 'stock_adjustments', 'sales_orders', 'sales_order_lines',
  'order_cost_lines', 'order_adjustments', 'invoices', 'shipments', 'shipment_orders', 'payments', 'payment_allocations', 'write_offs', 'fx_rates'];

const file = process.argv[2] ?? 'data/YP_Order_en_betaalsheetV5.xlsx';
const db = await freshDb();
const res = await importWorkbook(db, new Uint8Array(readFileSync(file)), 'workbook.xlsx');
const failed = res.reconciliation.filter(r => !r.ok);
if (failed.length) { console.error('Reconciliation failed', failed); process.exit(1); }
const seed: Record<string, any[]> = {};
for (const t of SEED_TABLES) {
  seed[t] = (await db.query<{ j: any }>(`select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as j from ${t} x`)).rows[0].j;
}
mkdirSync('web/public', { recursive: true });
writeFileSync('web/public/seed.json', JSON.stringify({ tables: SEED_TABLES, rows: seed }));
console.log('seed written:', Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.length]).filter(([, n]) => n)));
