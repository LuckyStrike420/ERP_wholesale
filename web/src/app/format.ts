const SYM: Record<string, string> = { EUR: "€", USD: "$" };
export const money = (v: any, cur?: string | null, dp = 2) =>
  v === null || v === undefined || v === "" ? "–" :
  `${cur ? (SYM[cur] ?? cur + " ") : ""}${Number(v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const qty = (v: any) => (v === null || v === undefined ? "–" : Number(v).toLocaleString("en-US"));
export const pct = (v: any, dp = 1) => (v === null || v === undefined ? "–" : `${(Number(v) * 100).toFixed(dp)}%`);
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
export const SHIP_LABEL: Record<string, string> = { awaiting_info: "Awaiting shipping info", planned: "Planned", in_transit: "In transit", arrived: "Arrived" };
