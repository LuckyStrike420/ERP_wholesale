/** Delivery terms (Incoterms): who arranges and pays the transport. Separate from the order type (EXW stock in euro / FOB in dollar). */
export const INCOTERMS = [
  { code: "EXW", label: "EXW · Ex Works", hint: "The customer collects from our warehouse" },
  { code: "FCA", label: "FCA · Free Carrier", hint: "We hand the goods to the customer's carrier" },
  { code: "FOB", label: "FOB · Free On Board", hint: "The customer's forwarder takes over at the port of loading" },
  { code: "DAP", label: "DAP · Delivered At Place", hint: "We arrange and pay the transport; the customer pays import duties" },
  { code: "DDP", label: "DDP · Delivered Duty Paid", hint: "We arrange and pay the transport and the import duties" },
] as const;
export const INCOTERM_OPTIONS = INCOTERMS.map(t => ({ value: t.code, label: t.label }));
export const incotermHint = (c?: string | null) => INCOTERMS.find(t => t.code === c)?.hint;
/** with DAP and DDP the transport is ours, so its cost belongs in the margin */
export const weArrangeTransport = (c?: string | null) => c === "DAP" || c === "DDP";
/** "DDP Hamburg" — the term with its named place */
export const incotermText = (c?: string | null, place?: string | null) => [c, place].filter(Boolean).join(" ");
