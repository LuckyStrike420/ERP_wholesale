import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, one, all } from './db.ts';
import { importWorkbook } from '../src/import/importer.ts';

const FILE = process.env.WORKBOOK ?? join(import.meta.dirname, '..', 'data', 'YP_Order_en_betaalsheetV5.xlsx');

test('workbook import: reconciles with Excel, keeps every row, and is safe to run twice', { skip: !existsSync(FILE) }, async () => {
  const db = await freshDb('2026-11-10');
  const first = await importWorkbook(db, new Uint8Array(readFileSync(FILE)), 'workbook.xlsx');
  assert.deepEqual(first.reconciliation.filter(r => !r.ok), []);
  assert.ok(first.reconciliation.length >= 60);
  assert.equal(first.issues.filter(i => i.severity === 'error').length, 0);
  assert.deepEqual(first.created, { customers: 14, suppliers: 1, products: 10, product_cost_rules: 4, batches: 2, batch_items: 2,
    purchase_orders: 4, sales_orders: 5, sales_order_lines: 9, shipments: 1 });

  // all 9 Excel order lines are in, including the one without PI# (as a draft)
  assert.equal(Number((await one<any>(db, `select count(*) c from sales_order_lines`)).c), 9);
  assert.equal((await one<any>(db, `select status from v_orders where pi_number is null`)).status, 'draft');
  // one supplier, two sets of terms
  assert.deepEqual((await all<any>(db, `select order_type, currency, deposit_pct::float8 d from supplier_terms order by 1`)).map(r => [r.order_type, r.currency, r.d]),
    [['EXW', 'EUR', 1], ['FOB', 'USD', 0.3]]);
  // complete picture: what Excel showed plus what it missed
  const sum = await all<any>(db, `select currency, receivable::float8 r, payable::float8 p from v_outstanding_summary order by 1`);
  assert.deepEqual(sum.map(r => [r.currency, r.r, r.p]), [['EUR', 8525, 6747.5], ['USD', 166866, 146009.62]]);
  // statuses come from the workbook
  assert.deepEqual((await all<any>(db, `select pi_number, status from sales_orders where pi_number is not null order by 1`)).map(r => [r.pi_number, r.status]),
    [['26069', 'pi_sent'], ['26122', 'shipped'], ['26179', 'po_received'], ['26182', 'pi_sent']]);
  const att = (await all<any>(db, `select code from v_attention`)).map(a => a.code);
  for (const code of ['cost_missing', 'draft_order', 'deposit_missing', 'exw_payment_reminder', 'shipment_awaiting_info']) assert.ok(att.includes(code), code);

  const second = await importWorkbook(db, new Uint8Array(readFileSync(FILE)), 'workbook.xlsx');
  assert.deepEqual(second.created, {});
  assert.equal(Number((await one<any>(db, `select count(*) c from sales_order_lines`)).c), 9);
  assert.equal(Number((await one<any>(db, `select count(*) c from payments`)).c), 0);
  assert.deepEqual(second.reconciliation.filter(r => !r.ok), []);
  assert.equal(Number((await one<any>(db, `select count(*) c from import_runs`)).c), 2);
});

test('migrations are applied once and later ones are picked up', async () => {
  const { applyMigrations } = await import('../src/db/migrate.ts');
  const db = await freshDb();
  assert.deepEqual(await applyMigrations(db), []);                                   // nothing left to do
  await db.query(`delete from app_migrations where name like '0004%'`);
  await db.exec(`drop view v_product_sales, v_supplier_summary, v_customer_summary, v_allocations`);
  assert.deepEqual(await applyMigrations(db), ['0004_reporting_views.sql']);         // only the missing one runs
});
