/**
 * Terms of an order: one choice that says both where the goods come from and who arranges the transport.
 * FOB = shipped from China in dollars (order type FOB); all others = from NL stock in euros (order type EXW).
 * The order type keeps driving currency, stock, purchase prices and payment terms, exactly as before.
 */
export const INCOTERMS = [
  { code: "FOB", label: "FOB · USD · Free On Board", hint: "From the factory in China, in dollars; the customer's forwarder takes over at the port of loading" },
  { code: "EXW", label: "EXW · EUR · Ex Works", hint: "From NL stock, in euros; the customer collects" },
  { code: "FCA", label: "FCA · EUR · Free Carrier", hint: "From NL stock, in euros; we hand the goods to the customer's carrier" },
  { code: "DAP", label: "DAP · EUR · Delivered At Place", hint: "From NL stock, in euros; we arrange and pay the transport, the customer pays import duties" },
  { code: "DDP", label: "DDP · EUR · Delivered Duty Paid", hint: "From NL stock, in euros; we arrange and pay the transport and the import duties" },
] as const;
export const INCOTERM_OPTIONS = INCOTERMS.map(t => ({ value: t.code, label: t.label }));
export const incotermHint = (c?: string | null) => INCOTERMS.find(t => t.code === c)?.hint;
/** the order type that belongs to a term: FOB stays FOB, everything else is sold from NL stock (EXW) */
export const typeFor = (c?: string | null) => (c === "FOB" ? "FOB" : "EXW");
/** with DAP and DDP the transport is ours, so its cost belongs in the margin */
export const weArrangeTransport = (c?: string | null) => c === "DAP" || c === "DDP";
/** "DDP Hamburg" — the term with its named place */
export const incotermText = (c?: string | null, place?: string | null) => [c, place].filter(Boolean).join(" ");
