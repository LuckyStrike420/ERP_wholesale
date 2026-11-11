import type { PGlite } from '@electric-sql/pglite';
import { one } from './db.ts';

export interface Seed { cust: string; cust2: string; sup: string; fixed: string; pct: string; share: string; }

export async function seed(db: PGlite): Promise<Seed> {
  const id = async (sql: string, p: any[] = []) => (await one<{ id: string }>(db, sql + ' returning id', p)).id;
  const cust = await id(`insert into customers (name) values ('Customer A')`);
  const cust2 = await id(`insert into customers (name) values ('Customer B')`);
  for (const c of [cust, cust2]) {
    await db.query(`insert into customer_terms values ($1,'FOB',0.30,0), ($1,'EXW',1,0)`, [c]);
  }
  const sup = await id(`insert into suppliers (name) values ('Supplier S')`);
  await db.query(`insert into supplier_terms values ($1,'FOB','USD',0.30), ($1,'EXW','EUR',1)`, [sup]);
  const fixed = await id(`insert into products (name) values ('Fixed cost product')`);
  const pct = await id(`insert into products (name) values ('Percentage product')`);
  const share = await id(`insert into products (name) values ('Profit share product')`);
  await db.query(`insert into product_cost_rules (product_id, order_type, cost_basis, share_above_basis, royalty_per_unit) values
    ($1,'FOB',4.56,null,null), ($1,'EXW',4.56,null,null),
    ($2,'EXW',null,0.5,null),
    ($3,'FOB',44.54,0.5,null), ($3,'EXW',9.94,0.5,null)`, [fixed, pct, share]);
  return { cust, cust2, sup, fixed, pct, share };
}

export interface LineIn { product: string; qty: number; price: number; po?: string; batchItem?: string; override?: number; }

export async function mkOrder(db: PGlite, o: {
  pi?: string; type: 'EXW' | 'FOB'; customer: string; status?: string; poDate?: string; lines: LineIn[];
}): Promise<string> {
  const { id } = await one<{ id: string }>(db,
    `insert into sales_orders (pi_number, order_type, customer_id, customer_po, po_date, status)
     values ($1,$2,$3,'PO-1',$4,$5) returning id`,
    [o.pi ?? null, o.type, o.customer, o.poDate ?? '2026-10-01', o.status ?? (o.pi ? 'pi_sent' : 'draft')]);
  let n = 1;
  for (const l of o.lines) {
    await db.query(
      `insert into sales_order_lines (sales_order_id, line_no, product_id, quantity, unit_price, purchase_order_id, batch_item_id, cost_override)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, n++, l.product, l.qty, l.price, l.po ?? null, l.batchItem ?? null, l.override ?? null]);
  }
  return id;
}

export async function mkPO(db: PGlite, num: string, supplier: string, type: 'EXW' | 'FOB'): Promise<string> {
  return (await one<{ id: string }>(db,
    `insert into purchase_orders (po_number, supplier_id, order_type) values ($1,$2,$3) returning id`, [num, supplier, type])).id;
}

export const order = (db: PGlite, id: string) => one<any>(db, `select * from v_orders where id = $1`, [id]);
export const po = (db: PGlite, id: string) => one<any>(db, `select * from v_purchase_orders where id = $1`, [id]);
export const num = (v: any) => Number(v);
