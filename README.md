# Your Products - Order & Payment app

The application that replaces `YP_Order-_en_betaalsheetV5.xlsx`: database with all calculations, workbook import, and the web app.

## What is here

| Path | Contents |
| --- | --- |
| `supabase/migrations/0001_core_tables.sql` | 31 tables: master data, orders, purchasing, payments, shipping, stock, system |
| `supabase/migrations/0002_calculations.sql` | Cost price rules, all financial views, status flow, payment rules |
| `supabase/migrations/0003_audit_and_access.sql` | Audit log on every business table, roles, row-level security |
| `src/import/` | Workbook import with dry run, issue log and reconciliation against Excel |
| `supabase/migrations/0004_reporting_views.sql` | Views for payment history and reports |
| `web/` | The application |
| `scripts/`, `docs/` | Seed builder, Supabase setup, migration runbook |
| `tests/` | 18 automated tests that run the real SQL in an embedded Postgres |
| `reports/import-report.md` | Result of the last import run |

## The app (web/)

React + TypeScript + Tailwind + shadcn/ui. Screens: dashboard, orders and order page, purchase orders, payments, shipping,
NL stock, customers, suppliers, products, price agreements, reports with CSV export, admin (settings, exchange rates,
users, audit log, workbook import).

```bash
cd web && pnpm install && pnpm dev      # opens on the local test database, loaded with the imported workbook
```

The local test database is Postgres running in the browser with the same migrations. Moving to Supabase is described in
`docs/MIGRATE-TO-SUPABASE.md`.

## Run it

```bash
npm install
npm test                                                     # all business scenarios + import of the workbook
npm run import -- --file data/YP_Order_en_betaalsheetV5.xlsx # rehearsal in a temporary database
```

## Put it on Supabase

1. Create a Supabase project and run the three files in `supabase/migrations` in order (SQL editor, or `supabase db push`).
2. Create the users under Authentication, then give each a role:
   `insert into profiles (user_id, full_name, role) values ('<auth user id>', 'Sander', 'admin');` (roles: `admin`, `finance`, `operations`)
3. Import: `DATABASE_URL=<connection string> npm run import -- --file <workbook.xlsx>` shows the dry run.
   Add `--commit` to save. A commit is refused while any figure differs from Excel.

## Where the numbers come from

The frontend never calculates money. It reads these views:

| View | Replaces |
| --- | --- |
| `v_order_lines` | Orderregels: revenue, cost price and its source, margin per line |
| `v_orders` | PI overzicht: receivable, deposit, outstanding, due dates, payment status |
| `v_purchase_orders` | Inkoop orders: expected vs invoiced, payable, outstanding |
| `v_batch_item_stock`, `v_batch_stock`, `v_product_stock`, `v_stock_movements` | Batches, Batch inhoud, stock columns on Producten |
| `v_shipments` | Shipping status |
| `v_revenue_monthly`, `v_outstanding_summary`, `v_cash_flow` | Dashboard |
| `v_attention` | Check columns and the "Actie nodig" block |
| `v_payments`, `v_customer_credit` | new: payment ledger and customer credit |

Actions with rules behind them are database functions: `register_customer_payment`, `register_supplier_payment`,
`void_payment`, `recalculate_deposit`.

## Adding modules later

A new module adds its own tables in a new numbered migration and reads the existing views. It does not change
existing tables or views, so existing figures cannot move. The test suite is the safety net: `npm test` must stay green.
