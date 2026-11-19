/** How a shipment travels. Each type asks only for its own fields; ETD/ETA keep driving the status. */
export const MODES = [
  { value: "sea_container", label: "Sea · container" },
  { value: "sea_lcl", label: "Sea · LCL / pallets" },
  { value: "road", label: "Road · truck / pallets" },
  { value: "pickup", label: "Pick-up by the customer" },
  { value: "courier", label: "Courier / parcel" },
] as const;
export const MODE_LABEL: Record<string, string> = Object.fromEntries(MODES.map(m => [m.value, m.label]));
export const COURIERS = ["FedEx", "UPS", "DHL", "PostNL"];

/** the usual way for an order's terms: FOB by container, EXW/FCA collected, DAP/DDP by road */
export const modeFor = (incoterm?: string | null) =>
  incoterm === "EXW" || incoterm === "FCA" ? "pickup" : incoterm === "DAP" || incoterm === "DDP" ? "road" : "sea_container";

const isSea = (m?: string) => m === "sea_container" || m === "sea_lcl" || !m;
/** what the dates mean for this type */
export const dateLabels = (m?: string) =>
  m === "pickup" ? { etd: "Pick-up date", eta: "" }
  : m === "road" ? { etd: "Loading date", eta: "Delivery date" }
  : m === "courier" ? { etd: "Sent on", eta: "Delivered on" }
  : { etd: "ETD", eta: "ETA" };
export { isSea };

/** link to the courier's tracking page; PostNL also wants the destination postcode and country code */
export function trackingUrl(carrier?: string | null, code?: string | null, postcode?: string | null, countryCode?: string | null) {
  if (!code) return null; const c = encodeURIComponent(code.trim()); const k = (carrier ?? "").toLowerCase();
  if (k.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${c}`;
  if (k.includes("ups")) return `https://www.ups.com/track?tracknum=${c}`;
  if (k.includes("dhl")) return `https://www.dhl.com/nl-en/home/tracking.html?tracking-id=${c}&submit=1`;
  if (k.includes("postnl")) return `https://postnl.nl/tracktrace/?B=${c}${postcode ? `&P=${encodeURIComponent(postcode.replace(/\s/g, ""))}` : ""}${countryCode ? `&D=${countryCode}` : ""}&T=C`;
  return null;
}

/** a short name for a shipment in lists: container, tracking number, CMR, who collected … */
export const shipmentLabel = (s: any) =>
  s.container_number || (s.mode === "courier" && s.tracking_number ? `${s.carrier ?? "Courier"} ${s.tracking_number}` : null)
  || (s.cmr_number ? `CMR ${s.cmr_number}` : null) || (s.mode === "pickup" && s.collected_by ? `Collected by ${s.collected_by}` : null)
  || s.bl_number || MODE_LABEL[s.mode] || "Shipment";
