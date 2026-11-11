import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, all } from './db.ts';
import { seed, mkOrder, mkPO, order, po, num } from './fixtures.ts';

const pay = (db: any, orderId: string, date: string, amount: number, ref?: string) =>
  one<any>(db, `select register_customer_payment($1,$2,$3,$4) as id`, [orderId, date, amount, ref ?? null]);

test('cost price rules: fixed, percentage of sale, profit share', async () => {
  const db = await freshDb(); const s = await seed(db);
  const c = async (product: string, type: string, price: number) =>
    one<any>(db, `select * from calc_unit_cost($1,$2,$3,$4,null,null,'2026-10-01')`, [product, s.cust, type, price]);
  assert.equal(num((await c(s.fixed, 'FOB', 33)).unit_cost), 4.56);
  assert.equal(num((await c(s.pct, 'EXW', 10)).unit_cost), 5);
  assert.equal(num((await c(s.pct, 'EXW', 11)).unit_cost), 5.5);
  assert.equal(num((await c(s.share, 'FOB', 57)).unit_cost), 50.77);      // example from the Start sheet
  assert.equal((await c(s.share, 'FOB', 57)).cost_source, 'product_rule');
  assert.equal((await c(s.pct, 'FOB', 10)).unit_cost, null);              // no rule for this type -> cost missing
});

test('cost price priority: override > batch > agreement > product rule', async () => {
  const db = await freshDb(); const s = await seed(db);
  const batch = (await one<any>(db, `insert into batches (batch_number) values ('B1') returning id`)).id;
  const bi = (await one<any>(db, `insert into batch_items (batch_id, product_id, qty_received, cost_basis) values ($1,$2,100,8) returning id`, [batch, s.share])).id;
  await db.query(`insert into price_agreements (product_id, customer_id, order_type, sale_price, agreed_cost) values ($1,$2,'EXW',20,12)`, [s.share, s.cust]);
  await db.query(`insert into price_agreements (product_id, customer_id, order_type, sale_price, agreed_cost) values ($1,null,'EXW',20,13)`, [s.share]);
  const c = async (cust: string, batchItem: string | null, override: number | null, type = 'EXW', date = '2026-10-01') =>
    one<any>(db, `select * from calc_unit_cost($1,$2,$3,20,$4,$5,$6)`, [s.share, cust, type, batchItem, override, date]);
  assert.deepEqual([num((await c(s.cust, bi, 7)).unit_cost), (await c(s.cust, bi, 7)).cost_source], [7, 'override']);
  assert.deepEqual([num((await c(s.cust, bi, null)).unit_cost), (await c(s.cust, bi, null)).cost_source], [8, 'batch']);
  assert.deepEqual([num((await c(s.cust, null, null)).unit_cost), (await c(s.cust, null, null)).cost_source], [12, 'agreement']);
  assert.equal(num((await c(s.cust2, null, null)).unit_cost), 13);                    // standard agreement for other customers
  assert.equal((await c(s.cust, bi, null, 'FOB')).cost_source, 'product_rule');       // batch cost applies to EXW only
  // an expired agreement no longer applies on the order date
  await db.query(`update price_agreements set valid_to = '2026-06-30'`);
  assert.deepEqual([num((await c(s.cust, null, null)).unit_cost), (await c(s.cust, null, null)).cost_source], [14.97, 'product_rule']);
  assert.equal((await c(s.cust, null, null, 'EXW', '2026-06-01')).cost_source, 'agreement');
});

test('selling below the cost basis is allowed but flagged', async () => {
  const db = await freshDb(); const s = await seed(db);
  const o = await mkOrder(db, { pi: 'P1', type: 'FOB', customer: s.cust, lines: [{ product: s.share, qty: 10, price: 40 }] });
  const l = await one<any>(db, `select * from v_order_lines where sales_order_id = $1`, [o]);
  assert.equal(num(l.unit_cost), 42.27);            // 44.54 + (40 - 44.54) * 0.5
  assert.equal(l.below_basis, true);
  assert.ok(num(l.margin) < 0);
  const att = await all<any>(db, `select code from v_attention where entity_id = $1`, [l.id]);
  assert.ok(att.some(a => a.code === 'below_basis'));
});

test('one invoice, one payment', async () => {
  const db = await freshDb(); const s = await seed(db);
  const o = await mkOrder(db, { pi: 'P1', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  let v = await order(db, o);
  assert.deepEqual([num(v.order_value), num(v.deposit_due), num(v.outstanding), v.payment_status], [1000, 1000, 1000, 'unpaid']);
  await db.query(`insert into invoices (sales_order_id, invoice_number, invoice_date) values ($1,'CI-1','2026-10-05')`, [o]);
  await pay(db, o, '2026-10-06', 1000, 'BANK-1');
  v = await order(db, o);
  assert.deepEqual([num(v.outstanding), v.payment_status, v.paid_and_invoiced, v.status], [0, 'paid', true, 'deposit_received']);
  await db.query(`update sales_orders set status = 'completed' where id = $1`, [o]);
});

test('deposit then final payment; status follows the ledger', async () => {
  const db = await freshDb(); const s = await seed(db);
  const o = await mkOrder(db, { pi: 'P1', type: 'FOB', customer: s.cust, lines: [{ product: s.share, qty: 1000, price: 57 }] });
  await db.query(`update sales_orders set status = 'po_received' where id = $1`, [o]);
  let v = await order(db, o);
  assert.deepEqual([num(v.total_receivable), num(v.deposit_due), num(v.balance_due)], [57000, 17100, 39900]);
  await pay(db, o, '2026-10-02', 17100, 'DEP');
  v = await order(db, o);
  assert.deepEqual([v.status, v.payment_status, num(v.outstanding)], ['deposit_received', 'deposit_paid', 39900]);
  await pay(db, o, '2026-11-02', 39900, 'BAL');
  v = await order(db, o);
  assert.deepEqual([v.payment_status, num(v.outstanding)], ['paid', 0]);
});

test('several partial payments, bank-charge write-off within tolerance', async () => {
  const db = await freshDb(); const s = await seed(db);
  const o = await mkOrder(db, { pi: 'P1', type: 'FOB', customer: s.cust, lines: [{ product: s.fixed, qty: 1000, price: 10 }] });
  await pay(db, o, '2026-10-02', 1000, 'A');
  assert.equal((await order(db, o)).payment_status, 'partially_paid');
  await pay(db, o, '2026-10-03', 2000, 'B');
  await pay(db, o, '2026-10-20', 6975, 'C');
  let v = await order(db, o);
  assert.deepEqual([num(v.paid), num(v.outstanding), v.payment_status], [9975, 25, 'deposit_paid']);
  await assert.rejects(db.query(`insert into write_offs (sales_order_id, amount, reason) values ($1, 25, ' ')`, [o]));   // reason required
  await db.query(`insert into write_offs (sales_order_id, amount, reason) values ($1, 25, 'Bank charges')`, [o]);
  v = await order(db, o);
  assert.deepEqual([num(v.written_off), num(v.outstanding), v.payment_status], [25, 0, 'paid']);
});

test('overdue: FOB balance is due 10 days before ETA; EXW gets a reminder after 5 working days', async () => {
  const db = await freshDb('2026-11-10'); const s = await seed(db);
  const fob = await mkOrder(db, { pi: 'F1', type: 'FOB', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  let v = await order(db, fob);
  assert.deepEqual([v.balance_due_date, num(v.overdue_amount), v.days_late], [null, 0, null]);   // no ETA: no due date
  const sh = (await one<any>(db, `insert into shipments (etd, eta) values ('2026-10-10','2026-11-15') returning id`)).id;
  await db.query(`insert into shipment_orders (shipment_id, sales_order_id) values ($1,$2)`, [sh, fob]);
  v = await order(db, fob);
  assert.equal(new Date(v.balance_due_date).toISOString().slice(0, 10), '2026-11-05');
  assert.deepEqual([num(v.overdue_amount), v.days_late], [1000, 5]);
  await pay(db, fob, '2026-11-10', 1000);
  assert.equal(num((await order(db, fob)).overdue_amount), 0);

  const exw = await mkOrder(db, { pi: 'E1', type: 'EXW', customer: s.cust, poDate: '2026-10-30', lines: [{ product: s.fixed, qty: 10, price: 10 }] });
  v = await order(db, exw);
  assert.equal(new Date(v.reminder_date).toISOString().slice(0, 10), '2026-11-06');   // 30 Oct + 5 working days
  assert.deepEqual([v.reminder_due, num(v.overdue_amount)], [true, 0]);                // a reminder, never "overdue"
});

test('order with several products: totals, margin, royalty and extra costs', async () => {
  const db = await freshDb(); const s = await seed(db);
  await db.query(`update product_cost_rules set royalty_per_unit = 0.25 where product_id = $1 and order_type = 'FOB'`, [s.fixed]);
  const o = await mkOrder(db, { pi: 'P1', type: 'FOB', customer: s.cust, lines: [
    { product: s.share, qty: 1840, price: 57 }, { product: s.fixed, qty: 500, price: 10 }, { product: s.fixed, qty: 3, price: 10, override: 3.3333 }] });
  const lines = await all<any>(db, `select * from v_order_lines where sales_order_id = $1 order by line_no`, [o]);
  await db.query(`insert into order_cost_lines (sales_order_line_id, kind, amount) values ($1,'freight',120)`, [lines[1].id]);
  const l = await all<any>(db, `select * from v_order_lines where sales_order_id = $1 order by line_no`, [o]);
  assert.deepEqual([num(l[0].revenue), num(l[0].purchase_value), num(l[0].margin)], [104880, 93416.8, 11463.2]);
  // 500*10 - (500*4.56 + 500*0.25 + 120)
  assert.deepEqual([num(l[1].royalty_total), num(l[1].extra_costs), num(l[1].margin)], [125, 120, 2475]);
  assert.deepEqual([num(l[2].unit_cost), l[2].cost_source, num(l[2].purchase_value)], [3.333, 'override', 10]);   // 3 decimals, amount to the cent
  const v = await order(db, o);
  assert.equal(num(v.order_value), 104880 + 5000 + 30);
  assert.equal(num(v.margin), 11463.2 + 2475 + (30 - 10 - 0.75));
});

test('currencies: EUR and USD never mix', async () => {
  const db = await freshDb(); const s = await seed(db);
  const eur = await mkOrder(db, { pi: 'E1', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  const usd = await mkOrder(db, { pi: 'F1', type: 'FOB', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 20 }] });
  const sum = await all<any>(db, `select currency, receivable from v_outstanding_summary order by currency`);
  assert.deepEqual(sum.map(r => [r.currency, num(r.receivable)]), [['EUR', 1000], ['USD', 2000]]);
  // a euro payment cannot be put on a dollar order
  const p = (await one<any>(db, `insert into payments (direction, customer_id, payment_date, amount, currency) values ('in',$1,'2026-10-02',500,'EUR') returning id`, [s.cust])).id;
  await assert.rejects(db.query(`insert into payment_allocations (payment_id, sales_order_id, amount) values ($1,$2,500)`, [p, usd]), /Currency mismatch/);
  await db.query(`insert into payment_allocations (payment_id, sales_order_id, amount) values ($1,$2,500)`, [p, eur]);
  // order type cannot change once paid
  await assert.rejects(db.query(`update sales_orders set order_type = 'FOB' where id = $1`, [eur]), /cannot change/);
  // combined EUR total only when a rate exists
  let m = await all<any>(db, `select currency, revenue_reporting, fx_rate_missing from v_revenue_monthly order by currency`);
  assert.deepEqual(m.map(r => [r.currency, r.revenue_reporting === null ? null : num(r.revenue_reporting), r.fx_rate_missing]), [['EUR', 1000, false], ['USD', null, true]]);
  await db.query(`insert into fx_rates values ('2026-09-30','USD',0.9)`);
  m = await all<any>(db, `select sum(revenue_reporting) as t from v_revenue_monthly`);
  assert.equal(num(m[0].t), 1000 + 1800);
});

test('order value changes after a payment: deposit stays as invoiced, balance grows', async () => {
  const db = await freshDb(); const s = await seed(db);
  const o = await mkOrder(db, { type: 'FOB', customer: s.cust, lines: [{ product: s.fixed, qty: 1000, price: 10 }] });   // draft
  await db.query(`update sales_orders set pi_number = 'P1', status = 'pi_sent' where id = $1`, [o]);
  await pay(db, o, '2026-10-02', 3000, 'DEP');
  await db.query(`update sales_order_lines set quantity = 1200 where sales_order_id = $1`, [o]);
  let v = await order(db, o);
  assert.deepEqual([num(v.total_receivable), num(v.deposit_due), num(v.balance_due), num(v.outstanding)], [12000, 3000, 9000, 9000]);
  await db.query(`insert into order_adjustments (sales_order_id, amount, reason) values ($1,-200,'Discount for damaged cartons')`, [o]);
  v = await order(db, o);
  assert.deepEqual([num(v.total_receivable), num(v.outstanding)], [11800, 8800]);
  assert.equal(num((await one<any>(db, `select recalculate_deposit($1) as d`, [o])).d), 3540);   // explicit action only
});

test('cancellation: whole order and single lines', async () => {
  const db = await freshDb(); const s = await seed(db);
  const o = await mkOrder(db, { pi: 'P1', type: 'FOB', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }, { product: s.fixed, qty: 50, price: 10 }] });
  await db.query(`update sales_order_lines set quantity_cancelled = 50 where sales_order_id = $1 and line_no = 2`, [o]);   // cancel one line
  assert.equal(num((await order(db, o)).order_value), 1000);
  await pay(db, o, '2026-10-02', 300, 'DEP');
  await db.query(`update sales_orders set status = 'cancelled' where id = $1`, [o]);
  const v = await order(db, o);
  assert.deepEqual([num(v.order_value), num(v.total_receivable), num(v.outstanding), v.payment_status], [0, 0, -300, 'cancelled']);
  assert.equal((await all(db, `select * from v_revenue_monthly`)).length, 0);                    // out of revenue
  assert.equal(num((await one<any>(db, `select coalesce(sum(receivable),0) r from v_outstanding_summary`)).r), 0);
  assert.equal(num((await one<any>(db, `select credit from v_customer_credit where customer_id = $1`, [s.cust])).credit), 300);   // money received is kept as credit
  await assert.rejects(db.query(`update sales_orders set status = 'pi_sent' where id = $1`, [o]), /cannot be reopened/);
});

test('wrong and duplicate payments', async () => {
  const db = await freshDb(); const s = await seed(db);
  const o = await mkOrder(db, { pi: 'P1', type: 'FOB', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  const p1 = (await pay(db, o, '2026-10-02', 300, 'REF-1')).id;
  await assert.rejects(pay(db, o, '2026-10-02', 300, 'REF-1'), /payments_no_duplicates/);       // same payment twice
  await assert.rejects(db.query(`delete from payments where id = $1`, [p1]), /never deleted/);
  await assert.rejects(db.query(`update payments set amount = 100 where id = $1`, [p1]), /void it/);
  await assert.rejects(db.query(`insert into payment_allocations (payment_id, sales_order_id, amount) values ($1,$2,1)`, [p1, o]), /exceeds/);
  await db.query(`select void_payment($1,'Booked on the wrong customer')`, [p1]);
  let v = await order(db, o);
  assert.deepEqual([num(v.paid), num(v.outstanding)], [0, 1000]);
  await pay(db, o, '2026-10-02', 300, 'REF-1');                                                    // can be booked again after the void
  // overpayment: the surplus is not forced onto the order, it stays as credit
  await pay(db, o, '2026-10-09', 900, 'REF-2');
  v = await order(db, o);
  assert.deepEqual([num(v.paid), num(v.outstanding), v.payment_status], [1000, 0, 'paid']);
  assert.equal(num((await one<any>(db, `select credit from v_customer_credit where customer_id = $1`, [s.cust])).credit), 200);
  // a payment from another customer cannot be used
  const p3 = (await one<any>(db, `insert into payments (direction, customer_id, payment_date, amount, currency) values ('in',$1,'2026-10-02',5,'USD') returning id`, [s.cust2])).id;
  await assert.rejects(db.query(`insert into payment_allocations (payment_id, sales_order_id, amount) values ($1,$2,5)`, [p3, o]), /different customers/);
});

test('status flow rules', async () => {
  const db = await freshDb(); const s = await seed(db);
  const o = await mkOrder(db, { type: 'FOB', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  const set = (st: string) => db.query(`update sales_orders set status = $2 where id = $1`, [o, st]);
  await assert.rejects(set('pi_sent'));                                  // no PI# yet
  await assert.rejects(pay(db, o, '2026-10-02', 300), /draft/);          // no payments on a draft
  await db.query(`update sales_orders set pi_number = 'P1', status = 'pi_sent' where id = $1`, [o]);
  await set('in_production');                                            // forward, skipping steps
  await assert.rejects(set('pi_sent'), /one step/);
  await set('deposit_received');                                         // one step back is a correction
  await set('shipped');
  await assert.rejects(set('cancelled'), /shipped/);
  await assert.rejects(set('completed'), /no invoice/);
  await db.query(`insert into invoices (sales_order_id, invoice_number, invoice_date) values ($1,'CI-1','2026-10-05')`, [o]);
  await assert.rejects(set('completed'), /outstanding/);
  await pay(db, o, '2026-10-06', 1000);
  await set('completed');
  await assert.rejects(db.query(`update sales_order_lines set quantity = 1 where sales_order_id = $1`, [o]), /completed order/);
});

test('supplier side: expected vs invoiced, cost freeze, variance into margin, payments', async () => {
  const db = await freshDb('2026-11-10'); const s = await seed(db);
  const p = await mkPO(db, '2801', s.sup, 'FOB');
  const o = await mkOrder(db, { pi: 'P1', type: 'FOB', customer: s.cust, lines: [
    { product: s.share, qty: 1000, price: 57, po: p }, { product: s.fixed, qty: 1000, price: 10, po: p }] });
  let v = await po(db, p);
  assert.deepEqual([v.currency, num(v.expected_amount), num(v.deposit_due), num(v.outstanding), v.pi_numbers], ['USD', 55330, 16599, 55330, 'P1']);
  await db.query(`select register_supplier_payment($1,'2026-10-03',16599,'DEP')`, [p]);
  // the invoice comes in 100 higher: it stands, and margin follows it
  await db.query(`insert into supplier_invoices (purchase_order_id, invoice_number, invoice_date, amount) values ($1,'SI-9','2026-10-20',55430)`, [p]);
  v = await po(db, p);
  assert.deepEqual([num(v.invoice_difference), num(v.payable), num(v.deposit_due), num(v.outstanding)], [100, 55430, 16629, 38831]);
  const ov = await order(db, o);
  assert.equal(num(ov.margin), 67000 - 55430);
  const lines = await all<any>(db, `select cost_is_final, invoice_variance from v_order_lines where sales_order_id = $1 order by line_no`, [o]);
  assert.deepEqual(lines.map(l => [l.cost_is_final, num(l.invoice_variance)]), [[true, 91.76], [true, 8.24]]);
  // cost is final now: changing the product rule no longer moves this order
  await db.query(`update product_cost_rules set cost_basis = 1 where product_id = $1`, [s.fixed]);
  assert.equal(num((await order(db, o)).margin), 67000 - 55430);
  // due dates are per PO
  await db.query(`update purchase_orders set balance_due_date = '2026-11-01' where id = $1`, [p]);
  v = await po(db, p);
  assert.deepEqual([num(v.overdue_amount), v.days_late], [38831, 9]);
  assert.ok((await all<any>(db, `select code from v_attention`)).some(a => a.code === 'supplier_invoice_differs'));
});

test('NL stock: sale from a batch, before and after the PO to the supplier', async () => {
  const db = await freshDb(); const s = await seed(db);
  const b = (await one<any>(db, `insert into batches (batch_number, supplier_id, received_date) values ('1257',$1,'2026-11-01') returning id`, [s.sup])).id;
  const bi = (await one<any>(db, `insert into batch_items (batch_id, product_id, qty_received) values ($1,$2,272) returning id`, [b, s.share])).id;
  const o = await mkOrder(db, { pi: 'E1', type: 'EXW', customer: s.cust, lines: [{ product: s.share, qty: 200, price: 17.5, batchItem: bi }] });
  let st = await one<any>(db, `select * from v_batch_item_stock where batch_item_id = $1`, [bi]);
  assert.deepEqual([st.stock, num(st.sold), num(st.sold_without_po)], [72, 200, 200]);
  assert.ok((await all<any>(db, `select code from v_attention`)).some(a => a.code === 'stock_sale_without_po'));
  const p = await mkPO(db, '2808', s.sup, 'EXW');
  await db.query(`update sales_order_lines set purchase_order_id = $2 where sales_order_id = $1`, [o, p]);
  st = await one<any>(db, `select * from v_batch_item_stock where batch_item_id = $1`, [bi]);
  assert.equal(num(st.sold_without_po), 0);
  assert.equal(num((await po(db, p)).expected_amount), 2744);          // 200 x 13.72
  await db.query(`insert into stock_adjustments (adjustment_date, batch_item_id, kind, quantity) values ('2026-11-05',$1,'Schade',-80)`, [bi]);
  assert.ok((await all<any>(db, `select code from v_attention`)).some(a => a.code === 'negative_stock'));
  await assert.rejects(mkOrder(db, { pi: 'E2', type: 'EXW', customer: s.cust, lines: [{ product: s.fixed, qty: 1, price: 5, batchItem: bi }] }), /not in the chosen batch/);
  assert.equal((await all(db, `select * from v_stock_movements where batch_item_id = $1`, [bi])).length, 3);
});

test('audit log and role-based access', async () => {
  const db = await freshDb(); const s = await seed(db);
  const o = await mkOrder(db, { pi: 'P1', type: 'FOB', customer: s.cust, lines: [{ product: s.fixed, qty: 100, price: 10 }] });
  await db.query(`update sales_orders set customer_po = 'PO-2' where id = $1`, [o]);
  const log = await all<any>(db, `select action, old_data->>'customer_po' as o, new_data->>'customer_po' as n from audit_log where table_name = 'sales_orders' and row_id = $1 order by id`, [o]);
  assert.deepEqual(log.map(l => [l.action, l.o, l.n]), [['INSERT', null, 'PO-1'], ['UPDATE', 'PO-1', 'PO-2']]);

  const fin = '00000000-0000-0000-0000-0000000000f1', ops = '00000000-0000-0000-0000-0000000000a1', nobody = '00000000-0000-0000-0000-0000000000b1';
  await db.query(`insert into profiles values ($1,'CFO','finance'), ($2,'Ops','operations')`, [fin, ops]);
  const as = async (uid: string) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`); };
  await as(nobody);
  assert.equal((await all(db, `select * from v_orders`)).length, 0);                               // no profile: sees nothing
  await as(fin);
  assert.equal((await all(db, `select * from v_orders`)).length, 1);
  assert.equal((await db.query(`update sales_orders set customer_po = 'X' where id = $1`, [o])).affectedRows, 0);   // finance cannot edit orders
  await db.query(`select register_customer_payment($1,'2026-10-02',300,'R1')`, [o]);                // ...but books payments
  assert.equal((await order(db, o)).status, 'deposit_received');
  await as(ops);
  await assert.rejects(db.query(`select register_customer_payment($1,'2026-10-03',100,'R2')`, [o]), /row-level security/);
  await db.query(`update sales_orders set customer_po = 'PO-3' where id = $1`, [o]);
  await assert.rejects(db.query(`insert into audit_log (table_name, action) values ('x','y')`), /permission denied/);
  await db.exec(`reset role`);
  const who = await one<any>(db, `select changed_by from audit_log where table_name = 'payments' order by id desc limit 1`);
  assert.equal(who.changed_by, fin);
});
