const SYM: Record<string, string> = { EUR: "€", USD: "$" };
export const money = (v: any, cur?: string | null, dp = 2) =>
  v === null || v === undefined || v === "" ? "–" :
  `${cur ? (SYM[cur] ?? cur + " ") : ""}${Number(v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const qty = (v: any) => (v === null || v === undefined ? "–" : Number(v).toLocaleString("en-US"));
export const pct = (v: any, dp = 1) => (v === null || v === undefined ? "–" : `${(Number(v) * 100).toFixed(dp)}%`);
/** margin %: "incomplete" (not 100%) when cost prices are missing; the database decides, the screen only shows it (OMS-001) */
export const marginPct = (pctValue: any, missing: any) => (Number(missing) > 0 ? "incomplete" : pct(pctValue));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const date = (v: any) => {
  if (!v) return "–";
  const [y, m, d] = String(v).slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
export const dateTime = (v: any) => (v ? `${date(v)} ${String(v).slice(11, 16)}` : "–");
export const today = () => new Date().toISOString().slice(0, 10);
export const monthName = (m: number) => MONTHS[m - 1];

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", pi_sent: "PI sent", po_received: "PO received", deposit_received: "Deposit received", in_production: "In production",
  ready_to_ship: "Ready to ship", shipped: "Shipped", delivered: "Picked up / delivered", completed: "Completed", cancelled: "Cancelled",
};
export const STATUS_ORDER = ["draft", "pi_sent", "po_received", "deposit_received", "in_production", "ready_to_ship", "shipped", "delivered", "completed"];
export const PAYMENT_LABEL: Record<string, string> = {
  draft: "–", unpaid: "Unpaid", partially_paid: "Partly paid", deposit_paid: "Deposit paid", paid: "Paid", overpaid: "Overpaid", cancelled: "Cancelled",
};
export const SOURCE_LABEL: Record<string, string> = { override: "Override", batch: "Batch", agreement: "Price agreement", product_rule: "Product rule" };
export const SHIP_LABEL: Record<string, string> = { awaiting_info: "Awaiting shipping info", planned: "Planned", in_transit: "In transit", arrived: "Arrived", collected: "Collected" };

export const days = (n: any) => (n === null || n === undefined ? "–" : `${n} day${Number(n) === 1 ? "" : "s"}`);
export const BUCKET_LABEL: Record<string, string> = { overdue: "Overdue", reminder: "Reminder due", due_soon: "Due within 7 days", scheduled: "Scheduled", no_due_date: "No due date" };
export const BUCKET_TONE: Record<string, string> = { overdue: "red", reminder: "amber", due_soon: "amber", scheduled: "green", no_due_date: "grey" };
/** "6 Nov" in the current year, "6 Nov 2025" otherwise */
export const dateShort = (v: any) => { if (!v) return "–"; const d = date(v); return String(v).slice(0, 4) === String(new Date().getFullYear()) ? d.replace(/ \d{4}$/, "") : d; };

// ---------------- payment terms ----------------
export const ANCHOR_LABEL: Record<string, string> = { order_date: "the order date", pi_date: "the PI date", po_date: "the customer's PO date", invoice_date: "the invoice date", etd: "ETD", eta: "ETA", delivery_date: "delivery" };
export const ANCHOR_OPTIONS = [
  { value: "order_date", label: "Order date (PI date, else customer PO date)" }, { value: "pi_date", label: "PI date" }, { value: "po_date", label: "Customer PO date" },
  { value: "invoice_date", label: "Invoice date" }, { value: "etd", label: "ETD (departure / pick-up)" }, { value: "eta", label: "ETA (arrival)" },
  { value: "delivery_date", label: "Delivery (picked up or delivered, from the shipment)" }];
/** "7 days after the order date", "10 days before ETA", "on ETD", "date set per order" */
export const termWhen = (anchor: string | null, d: any) => {
  if (!anchor) return "date set per order"; const n = Number(d ?? 0);
  return n === 0 ? `on ${ANCHOR_LABEL[anchor]}` : `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"} ${n < 0 ? "before" : "after"} ${ANCHOR_LABEL[anchor]}`;
};
/** one line that says what the term means */
export const termText = (t: any) => {
  if (!t) return "–"; const d = Number(t.deposit_pct);
  if (d >= 1) return `100% ${termWhen(t.deposit_anchor, t.deposit_days)}${discountText(t)}`;
  if (d <= 0) return `100% ${termWhen(t.balance_anchor, t.balance_days)}${discountText(t)}`;
  return `${pct(d, 0)} ${termWhen(t.deposit_anchor, t.deposit_days)} · ${pct(1 - d, 0)} ${termWhen(t.balance_anchor, t.balance_days)}${discountText(t)}`;
};
/** " · 3% discount if paid within 14 days" */
export const discountText = (t: any) => Number(t?.discount_pct) > 0 && t?.discount_days != null
  ? ` · ${pct(t.discount_pct, Number(t.discount_pct) * 100 % 1 ? 1 : 0)} discount if paid within ${t.discount_days} day${Number(t.discount_days) === 1 ? "" : "s"}` : "";

// ---------------- tasks and documents ----------------
export const TASK_STATE_LABEL: Record<string, string> = { overdue: "Overdue", today: "Today", upcoming: "Upcoming", no_date: "No date", done: "Done" };
export const TASK_STATE_TONE: Record<string, string> = { overdue: "red", today: "amber", upcoming: "blue", no_date: "grey", done: "green" };
export const DOC_TYPES = ["PI", "Customer PO", "Supplier PI", "Commercial invoice", "Packing list", "BL", "Certificate", "Payment proof", "Other"];
export const fileSize = (b: any) => { const n = Number(b); if (!n) return ""; return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`; };
