// Input masks. Pure + unit-tested — the UI layer only calls these.

/** Digits only. */
const digits = (v: string) => v.replace(/\D/g, '');

/** "4000000" | "4 000 000" -> "4 000 000" (space-grouped thousands). */
export function maskAmount(v: string): string {
  const n = digits(v).replace(/^0+(?=\d)/, '');
  return n.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** "4 000 000" -> "4000000" (what we send to the API). */
export function unmaskAmount(v: string): string {
  return digits(v);
}

/**
 * Uzbek phone: "+998 XX XXX XX XX". Accepts raw digits with or without the 998 prefix.
 * Partial input stays partial (so typing feels natural).
 */
export function maskPhone(v: string): string {
  let n = digits(v);
  if (n.startsWith('998')) n = n.slice(3);
  n = n.slice(0, 9);
  if (!n) return '';
  const p = [n.slice(0, 2), n.slice(2, 5), n.slice(5, 7), n.slice(7, 9)].filter(Boolean);
  return `+998 ${p.join(' ')}`.trimEnd();
}

/** "+998 90 123 45 67" -> "+998901234567". */
export function unmaskPhone(v: string): string {
  const n = digits(v);
  if (!n) return '';
  return `+${n.startsWith('998') ? n : `998${n}`}`;
}

/** Uzbek ID/passport: 2 uppercase letters + 7 digits, e.g. "AE5348993". */
export function maskPassport(v: string): string {
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const letters = s.slice(0, 2).replace(/[^A-Z]/g, '');
  const nums = s.slice(letters.length).replace(/\D/g, '').slice(0, 7);
  return letters + nums;
}

/** STIR / INN — 9 digits. */
export function maskStir(v: string): string {
  return digits(v).slice(0, 9);
}

/** Bank account (h/r) — 20 digits, grouped in 4s for readability. */
export function maskAccount(v: string): string {
  const n = digits(v).slice(0, 20);
  return n.replace(/(.{4})(?=.)/g, '$1 ');
}

/** MFO — 5 digits. */
export function maskMfo(v: string): string {
  return digits(v).slice(0, 5);
}

/** PINFL / JSHSHIR — exactly 14 digits. */
export function maskPinfl(v: string): string {
  return digits(v).slice(0, 14);
}

/** True when the value is a well-formed PINFL. */
export function isValidPinfl(v: string): boolean {
  return /^\d{14}$/.test(v);
}

/**
 * Typed date — digits auto-dotted as DD.MM.YYYY.
 *
 * Only the digits are kept, so typing the dots and skipping them come out the same, and the
 * eight-digit cap means a full date stops accepting more rather than growing a tail.
 */
export function maskDmy(v: string): string {
  const d = digits(v).slice(0, 8);
  // A dot typed at a boundary is kept. Stripping it made «17.» come back as «17», so the separator
  // the person just pressed vanished under their fingers and the field looked like it had refused
  // it — even though the next digit would have put it back.
  const dot = /\D$/.test(v) && (d.length === 2 || d.length === 4) ? '.' : '';
  if (d.length <= 2) return d + dot;
  if (d.length <= 4) return `${d.slice(0, 2)}.${d.slice(2)}${dot}`;
  return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}`;
}

// `dmyToIso` / `isoToDmy` live in ./calendar — the masked input pairs with those, not with copies.
