/** Readable URLs for every record. One place, so links stay consistent everywhere. */
export const slug = (s: string | null | undefined) =>
  String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
const short = (id: string) => String(id).slice(0, 8);

/** orders: /orders/26179; drafts have no PI# yet: /orders/draft-1a2b3c4d */
export const orderRef = (o: { pi_number?: string | null; id: string }) => o.pi_number ? String(o.pi_number) : `draft-${short(o.id)}`;
export const orderPath = (o: { pi_number?: string | null; id: string }, sub = "") => `/orders/${encodeURIComponent(orderRef(o))}${sub}`;
export const findOrder = <T extends { pi_number?: string | null; id: string }>(rows: T[], ref: string) =>
  ref.startsWith("draft-") ? rows.find(r => !r.pi_number && String(r.id).startsWith(ref.slice(6))) : rows.find(r => String(r.pi_number) === ref);

export const poPath = (p: { po_number: string }, sub = "") => `/purchasing/${encodeURIComponent(p.po_number)}${sub}`;
export const customerPath = (c: { name: string }, sub = "") => `/customers/${slug(c.name)}${sub}`;
export const supplierPath = (s: { name: string }, sub = "") => `/suppliers/${slug(s.name)}${sub}`;
export const productPath = (p: { name: string }, sub = "") => `/products/${slug(p.name)}${sub}`;
export const pricePath = (a: { id: string }) => `/prices/${short(a.id)}`;
export const shipmentRef = (s: { id: string; container_number?: string | null }) => s.container_number ? slug(s.container_number) : short(s.id);
export const shipmentPath = (s: { id: string; container_number?: string | null }, sub = "") => `/shipping/${shipmentRef(s)}${sub}`;
export const bySlug = <T extends { name: string }>(rows: T[], s: string) => rows.find(r => slug(r.name) === s);
export const byShort = <T extends { id: string }>(rows: T[], s: string) => rows.find(r => String(r.id).startsWith(s));
