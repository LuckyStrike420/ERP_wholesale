/** Dutch VAT (EXW with a Dutch company): rates per product, and the split per rate for documents. */
export const VAT_OPTIONS = [{ value: "0.21", label: "21% (standard)" }, { value: "0.09", label: "9% (reduced)" }];

/** VAT per rate over the lines; `raw` are the sales_order_lines rows (their own rate), products give the fallback */
export function vatSplit(lines: any[], raw: any[], products: any[], amountKey: "revenue" | "purchase_value" = "revenue") {
  const rateOf = (l: any) => Number(raw.find(r => r.id === l.id)?.vat_rate ?? products.find(p => p.id === l.product_id)?.vat_rate ?? 0);
  const by = new Map<number, { rate: number; base: number; vat: number }>();
  for (const l of lines) {
    const rate = rateOf(l); const base = Number(l[amountKey] ?? 0);
    const t = by.get(rate) ?? { rate, base: 0, vat: 0 }; t.base += base; t.vat += Math.round(base * rate * 100) / 100; by.set(rate, t);
  }
  return [...by.values()].filter(t => t.rate > 0).sort((a, b) => b.rate - a.rate);
}
