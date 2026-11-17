/**
 * Adding a customer, supplier or product straight from a field where you pick one.
 * Only the name is needed; the rest can be filled in later on its own page.
 * A new customer gets the standard payment terms ("100% payment" for EXW, "30% deposit / 70% balance" for FOB).
 */
import type { DataClient } from "@/data/client";

export type Creatable = "customer" | "supplier" | "product";

/** which kind of record a field refers to, by its name */
export const CREATABLE_FIELD: Record<string, Creatable> = { customer_id: "customer", supplier_id: "supplier", default_supplier_id: "supplier", product_id: "product" };

export async function quickCreate(db: DataClient, kind: Creatable, name: string): Promise<string> {
  const n = name.trim(); if (!n) throw new Error("Type a name first");
  if (kind === "supplier") return (await db.insert<any>("suppliers", { name: n })).id;
  if (kind === "product") return (await db.insert<any>("products", { name: n })).id;
  const id = (await db.insert<any>("customers", { name: n })).id;
  const terms = await db.select<any>("payment_terms");
  for (const [type, termName] of [["EXW", "100% payment"], ["FOB", "30% deposit / 70% balance"]]) {
    const t = terms.find(x => x.name === termName && x.active);
    if (t) await db.insert("customer_terms", { customer_id: id, order_type: type, payment_term_id: t.id });
  }
  return id;
}
