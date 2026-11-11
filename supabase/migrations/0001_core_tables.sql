-- =====================================================================
-- Your Products - Order & Payment app
-- 0001: core tables
-- Money: numeric(14,2). Unit prices/costs: numeric(14,4). Percentages: numeric(7,4) as fraction (0.30 = 30%).
-- Nothing that can be derived is stored, except values that must stay fixed
-- (frozen cost price, requested deposit).
-- =====================================================================

-- ---------- settings and lookups ----------
create table app_settings (
  key   text primary key,
  value text not null,
  description text
);
insert into app_settings (key, value, description) values
  ('cost_decimals',            '3',    'Decimals a purchase price per piece is rounded to'),
  ('payment_tolerance',        '0.01', 'Outstanding at or below this amount counts as paid'),
  ('exw_reminder_working_days','5',    'Working days after the PI date before an unpaid EXW order raises a reminder'),
  ('fob_balance_days_before_eta','10', 'FOB balance is due this many days before ETA'),
  ('reporting_currency',       'EUR',  'Currency of the combined total in reports');

create table order_types (
  code     text primary key,
  currency char(3) not null,
  label    text not null
);
insert into order_types values ('EXW','EUR','Ex Works (euro)'), ('FOB','USD','Free On Board (dollar)');

create table order_statuses (
  code  text primary key,
  label text not null,          -- label used in the Excel workbook
  rank  int  not null unique,
  is_open boolean not null default true
);
insert into order_statuses (code, label, rank, is_open) values
  ('draft',            'Concept (nog geen PI#)',  0, true),
  ('pi_sent',          'PI verstuurd',           10, true),
  ('po_received',      'PO ontvangen',           20, true),
  ('deposit_received', 'Aanbetaling ontvangen',  30, true),
  ('in_production',    'In productie',           40, true),
  ('ready_to_ship',    'Klaar voor verzending',  50, true),
  ('shipped',          'Verscheept',             60, true),
  ('delivered',        'Opgehaald / geleverd',   70, true),
  ('completed',        'Afgerond',               80, false),
  ('cancelled',        'Geannuleerd',            90, false);

create table product_kinds (code text primary key);
insert into product_kinds values ('Eindproduct'),('Verpakking'),('Onderdeel'),('Overig');

create table stock_adjustment_kinds (code text primary key);
insert into stock_adjustment_kinds values ('Telling'),('Schade'),('Retour'),('Overig');

create table fx_rates (
  rate_date date not null,
  currency  char(3) not null,              -- 1 unit of this currency = rate units of reporting currency
  rate      numeric(14,6) not null check (rate > 0),
  source    text,
  primary key (rate_date, currency)
);

-- ---------- master data ----------
create table customers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  country      text,
  vat_number   text,
  contact_name text,
  email        text,
  notes        text,
  created_at   timestamptz not null default now()
);

create table customer_terms (
  customer_id  uuid not null references customers on delete cascade,
  order_type   text not null references order_types,
  deposit_pct  numeric(7,4) not null default 0 check (deposit_pct between 0 and 1),
  payment_days int not null default 0 check (payment_days >= 0),
  primary key (customer_id, order_type)
);

create table suppliers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  country      text,
  contact_name text,
  email        text,
  notes        text,
  created_at   timestamptz not null default now()
);

create table supplier_terms (
  supplier_id uuid not null references suppliers on delete cascade,
  order_type  text not null references order_types,
  currency    char(3) not null,
  deposit_pct numeric(7,4) not null default 0 check (deposit_pct between 0 and 1),
  primary key (supplier_id, order_type)
);

create table products (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null unique,
  sku                 text,
  kind                text references product_kinds,
  default_supplier_id uuid references suppliers,
  carton_dimensions   text,
  carton_weight_kg    numeric(10,2),
  units_per_carton    int,
  units_20ft          int,
  units_40ft          int,
  units_40hc          int,
  notes               text,
  created_at          timestamptz not null default now()
);

-- cost = basis + (sale price - basis) * share.  basis only = fixed; share only = % of sale price.
create table product_cost_rules (
  product_id        uuid not null references products on delete cascade,
  order_type        text not null references order_types,
  valid_from        date not null default date '2000-01-01',
  cost_basis        numeric(14,4),
  share_above_basis numeric(7,4) check (share_above_basis between 0 and 1),
  royalty_per_unit  numeric(14,4) check (royalty_per_unit >= 0),
  primary key (product_id, order_type, valid_from)
);

create table price_agreements (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products,
  customer_id uuid references customers,          -- null = standard price
  order_type  text not null references order_types,
  sale_price  numeric(14,4) not null check (sale_price >= 0),
  moq         int,
  valid_from  date,
  valid_to    date,
  agreed_cost numeric(14,4),
  notes       text,
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
create index on price_agreements (product_id, order_type);

-- ---------- purchasing ----------
create table purchase_orders (
  id               uuid primary key default gen_random_uuid(),
  po_number        text not null unique,
  supplier_id      uuid not null references suppliers,
  order_type       text not null references order_types,
  currency         char(3),                 -- filled from the supplier's terms when left empty
  po_date          date,
  deposit_pct      numeric(7,4) check (deposit_pct between 0 and 1),   -- copied from the supplier's terms when left empty
  deposit_due_date date,      -- due dates are set per PO
  balance_due_date date,
  notes            text,
  created_at       timestamptz not null default now()
);

create table supplier_invoices (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null unique references purchase_orders,
  invoice_number    text,
  invoice_date      date,
  amount            numeric(14,2) not null check (amount >= 0),
  created_at        timestamptz not null default now()
);

-- ---------- stock (NL consignment batches) ----------
create table batches (
  id            uuid primary key default gen_random_uuid(),
  batch_number  text not null unique,
  supplier_id   uuid references suppliers,
  reference     text,          -- container# or other reference
  received_date date,
  notes         text
);

create table batch_items (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references batches on delete cascade,
  product_id        uuid not null references products,
  qty_received      int not null default 0 check (qty_received >= 0),
  cost_basis        numeric(14,4),   -- optional EXW cost rule for this batch
  share_above_basis numeric(7,4) check (share_above_basis between 0 and 1),
  notes             text,
  unique (batch_id, product_id)
);

create table stock_adjustments (
  id              uuid primary key default gen_random_uuid(),
  adjustment_date date,
  batch_item_id   uuid not null references batch_items,
  kind            text references stock_adjustment_kinds,
  quantity        int not null check (quantity <> 0),   -- less stock = negative
  reference       text,
  notes           text
);

-- ---------- sales ----------
create table sales_orders (
  id             uuid primary key default gen_random_uuid(),
  pi_number      text unique,                       -- typed in; empty only while draft
  order_type     text not null references order_types,
  customer_id    uuid not null references customers,
  customer_po    text,
  po_date        date,
  pi_date        date,                              -- date the PI was sent
  status         text not null default 'draft' references order_statuses,
  deposit_pct    numeric(7,4) check (deposit_pct between 0 and 1),   -- copied from the customer's terms when left empty
  payment_days   int check (payment_days >= 0),
  deposit_amount numeric(14,2),                     -- requested deposit, fixed once the PI is out
  deposit_due_date date,                            -- optional manual due date
  balance_due_date date,                            -- optional manual override
  notes          text,
  created_at     timestamptz not null default now(),
  check (status = 'draft' or pi_number is not null)
);
create index on sales_orders (customer_id);

create table sales_order_lines (
  id                 uuid primary key default gen_random_uuid(),
  sales_order_id     uuid not null references sales_orders on delete cascade,
  line_no            int not null,
  product_id         uuid not null references products,
  quantity           int not null check (quantity > 0),
  quantity_cancelled int not null default 0 check (quantity_cancelled >= 0),
  unit_price         numeric(14,4) not null check (unit_price >= 0),
  line_date          date,                          -- only when it differs from the order's PO date
  purchase_order_id  uuid references purchase_orders,
  batch_item_id      uuid references batch_items,
  cost_override      numeric(14,4) check (cost_override >= 0),
  -- frozen when the supplier invoice arrives; until then calculated live
  frozen_unit_cost   numeric(14,4),
  frozen_cost_source text,
  frozen_royalty     numeric(14,4),
  cost_frozen_at     timestamptz,
  notes              text,
  unique (sales_order_id, line_no),
  check (quantity_cancelled <= quantity)
);
create index on sales_order_lines (purchase_order_id);
create index on sales_order_lines (batch_item_id);
create index on sales_order_lines (product_id);

create table order_cost_lines (               -- freight, commission, other extra costs
  id                  uuid primary key default gen_random_uuid(),
  sales_order_line_id uuid not null references sales_order_lines on delete cascade,
  kind                text not null default 'other' check (kind in ('freight','commission','other')),
  amount              numeric(14,2) not null,
  notes               text
);

create table order_adjustments (              -- Excel "Correctie (+/-)"
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references sales_orders on delete cascade,
  amount         numeric(14,2) not null check (amount <> 0),
  reason         text not null check (length(trim(reason)) > 0),
  created_at     timestamptz not null default now()
);

create table invoices (                       -- one commercial invoice per PI
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null unique references sales_orders,
  invoice_number text not null unique,
  invoice_date   date not null,
  created_at     timestamptz not null default now()
);

-- ---------- logistics ----------
create table shipments (
  id               uuid primary key default gen_random_uuid(),
  forwarder        text,
  container_number text,
  bl_number        text,
  port_loading     text,
  port_discharge   text,
  ready_date       date,
  etd              date,
  eta              date,
  docs_complete    boolean not null default false,
  notes            text
);

create table shipment_orders (
  id                uuid primary key default gen_random_uuid(),
  shipment_id       uuid not null references shipments on delete cascade,
  sales_order_id    uuid references sales_orders,
  purchase_order_id uuid references purchase_orders,
  check (sales_order_id is not null or purchase_order_id is not null)
);
-- one shipment per PI (decision 21). Drop this index to allow partial shipments later.
create unique index shipment_orders_one_per_pi on shipment_orders (sales_order_id) where sales_order_id is not null;

-- ---------- money ----------
create table payments (
  id           uuid primary key default gen_random_uuid(),
  direction    text not null check (direction in ('in','out')),   -- in = from customer, out = to supplier
  customer_id  uuid references customers,
  supplier_id  uuid references suppliers,
  payment_date date not null,
  amount       numeric(14,2) not null check (amount > 0),
  currency     char(3) not null,
  reference    text,
  notes        text,
  voided_at    timestamptz,                 -- a wrong payment is voided, never deleted
  void_reason  text,
  created_at   timestamptz not null default now(),
  check ((direction = 'in'  and customer_id is not null and supplier_id is null)
      or (direction = 'out' and supplier_id is not null and customer_id is null)),
  check (voided_at is null or length(trim(coalesce(void_reason,''))) > 0)
);
-- duplicate protection: same party, date, amount, currency and reference cannot be booked twice
create unique index payments_no_duplicates on payments
  (direction, coalesce(customer_id, supplier_id), payment_date, amount, currency, coalesce(reference,''))
  where voided_at is null;

create table payment_allocations (
  id                uuid primary key default gen_random_uuid(),
  payment_id        uuid not null references payments on delete cascade,
  sales_order_id    uuid references sales_orders,
  purchase_order_id uuid references purchase_orders,
  amount            numeric(14,2) not null check (amount > 0),
  check ((sales_order_id is not null) <> (purchase_order_id is not null))
);
create index on payment_allocations (sales_order_id);
create index on payment_allocations (purchase_order_id);
create index on payment_allocations (payment_id);

create table write_offs (                    -- bank charges / small differences. Always manual, always with a reason.
  id                uuid primary key default gen_random_uuid(),
  sales_order_id    uuid references sales_orders,
  purchase_order_id uuid references purchase_orders,
  write_off_date    date not null default current_date,
  amount            numeric(14,2) not null check (amount <> 0),
  reason            text not null check (length(trim(reason)) > 0),
  check ((sales_order_id is not null) <> (purchase_order_id is not null))
);

-- ---------- system ----------
create table attachments (
  id           uuid primary key default gen_random_uuid(),
  entity_table text not null,
  entity_id    uuid not null,
  doc_type     text,                 -- PI, CI, PL, BL, COO, other
  file_name    text not null,
  storage_path text not null,
  created_at   timestamptz not null default now()
);
create index on attachments (entity_table, entity_id);

create table import_runs (
  id         uuid primary key default gen_random_uuid(),
  file_name  text not null,
  started_at timestamptz not null default now(),
  summary    jsonb
);

create table import_issues (
  id       bigint generated always as identity primary key,
  run_id   uuid not null references import_runs on delete cascade,
  severity text not null check (severity in ('info','warning','error')),
  sheet    text,
  row_no   int,
  code     text not null,
  message  text not null,
  raw      jsonb
);
