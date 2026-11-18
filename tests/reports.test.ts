import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one } from './db.ts';
import { seed, mkOrder, num } from './fixtures.ts';
import { runReport, blankDef } from '../web/src/modules/reports/engine.ts';

test('report builder: orders per month, totals per currency, filters, list mode', async () => {
  const db = await freshDb(); const s = await seed(db);
  await mkOrder(db, { pi: 'R1', type: 'EXW', customer: s.cust, poDate: '2026-09-03', lines: [{ product: s.fixed, qty: 10, price: 10 }] });
  await mkOrder(db, { pi: 'R2', type: 'EXW', customer: s.cust, poDate: '2026-09-20', lines: [{ product: s.fixed, qty: 5, price: 10 }] });
  await mkOrder(db, { pi: 'R3', type: 'EXW', customer: s.cust, poDate: '2026-10-02', lines: [{ product: s.fixed, qty: 1, price: 30 }] });
  await mkOrder(db, { pi: 'R4', type: 'FOB', customer: s.cust, poDate: '2026-10-05', lines: [{ product: s.fixed, qty: 2, price: 50 }] });
  const rows = (await db.query<any>(`select * from v_orders`)).rows.map(r => ({ ...r, po_date: r.po_date instanceof Date ? r.po_date.toISOString().slice(0, 10) : r.po_date }));

  const def = { ...blankDef('orders'), group: 'po_date', bucket: 'month' as const, measures: [{ agg: 'sum' as const, field: 'order_value' }, { agg: 'count' as const, field: '*' }], chart: 'bar' as const };
  const res = runReport(def, rows);
  assert.equal(res.grouped, true);
  assert.deepEqual(res.currencies.sort(), ['EUR', 'USD']);
  const eur = res.rows.filter(r => r._currency === 'EUR').map(r => [r._group, num(r.m0), r.m1]);
  assert.deepEqual(eur, [['2026-09', 150, 2], ['2026-10', 30, 1]]);
  assert.deepEqual(res.rows.filter(r => r._currency === 'USD').map(r => [r._group, num(r.m0)]), [['2026-10', 100]]);

  // a month without orders still shows, with 0
  const gap = runReport({ ...def, measures: [{ agg: 'count', field: '*' }] }, rows.map(r => r.pi_number === 'R3' ? { ...r, po_date: '2026-12-01' } : r));
  assert.deepEqual(gap.rows.map(r => [r._group, r.m0]), [['2026-09', 2], ['2026-10', 1], ['2026-11', 0], ['2026-12', 1]]);

  // a filter narrows it before grouping
  const f = runReport({ ...def, filters: [{ field: 'order_type', op: 'is', value: 'FOB' }] }, rows);
  assert.deepEqual(f.currencies, ['USD']); assert.equal(f.rows.length, 1);

  // list mode keeps the chosen columns and sorts
  const list = runReport({ ...blankDef('orders'), columns: ['pi_number', 'order_value'], sort: { key: 'order_value', dir: 1 } }, rows);
  assert.equal(list.grouped, false);
  assert.deepEqual(list.rows.slice(0, 2).map(r => r.pi_number), ['R3', 'R2']); assert.deepEqual(list.columns.map(c => c.key), ['pi_number', 'order_value']);

  // a report saves with its definition
  const saved = await one<any>(db, `insert into reports (name, definition, on_dashboard) values ('Per month', $1, true) returning definition, on_dashboard`, [JSON.stringify(def)]);
  assert.equal(saved.definition.group, 'po_date'); assert.equal(saved.on_dashboard, true);
});
