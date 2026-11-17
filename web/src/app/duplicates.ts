/**
 * Spotting a customer, supplier or product that probably exists already under a slightly different name:
 * "Acme BV" ~ "Acme B.V." ~ "ACME" ~ "Acme Trading B.V." ~ "Acmee BV".
 * Case, accents, punctuation and legal forms (BV, Ltd, GmbH, d.o.o., Sp. z o.o. …) are ignored; a typo or two is allowed.
 */
const LEGAL = new Set(["bv", "nv", "vof", "ltd", "limited", "gmbh", "inc", "llc", "co", "corp", "company", "srl", "sa", "sp", "z", "oo", "zoo", "doo", "ag", "plc", "group", "the", "and", "trading", "holding"]);
export const normName = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/\./g, "")
  .split(/[^a-z0-9]+/).filter(t => t && !LEGAL.has(t)).join("");

function distance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

export function similarName(a: string, b: string) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))) return true;
  return distance(x, y) <= (Math.max(x.length, y.length) >= 8 ? 2 : 1);
}

export const findSimilar = <T extends { name: string }>(name: string, rows: T[], exceptId?: string) =>
  rows.filter(r => (r as any).id !== exceptId && similarName(name, r.name));
