// The 8 target microfinance firms (companies.json in the tests project) + creditor→firm resolution.
// mib.uz returns the creditor as a raw (often garbled) string; match it against these patterns to
// attach the canonical firm name + INN, and flag whether it's one of our target firms (vs state duty).
export interface MibCompany {
  id: number; name: string; inn: string; bank: string; mfo: string; account: string;
  director: string; category: string; patterns: string[];
}

export const MIB_COMPANIES: MibCompany[] = [
  { id: 1, name: 'MUVAFFAQIYAT MIKROMOLIYA TASHKILOTI MCHJ', inn: '311939991', bank: 'Anorbank', mfo: '01183', account: '20216000007205557001', director: 'SULTANOV JO`RABEK KAMOLDINOVICH', category: 'Mikromoliya', patterns: ['MUVAFFAQIYAT', 'M.*AQIYAT', 'MU.*IYAT'] },
  { id: 2, name: 'URBAN FINANCE SOLUTIONS MIKROMOLIYA TASHKILOTI MCHJ', inn: '311943592', bank: 'Anorbank', mfo: '01183', account: '20216000307206292001', director: 'POZILDINOV ILXOMJON AZAMJON OGLI', category: 'Mikromoliya', patterns: ['URBAN', 'URBAN\\s*FINANCE', 'U.*AN\\s*FI.*CE'] },
  { id: 3, name: 'BRIGHT FUTURE FINANCING MIKROMOLIYA TASHKILOTI MCHJ', inn: '311976765', bank: 'Anorbank', mfo: '01183', account: '20216000207212842001', director: 'SUVONOV FARRUXJON FAXRITDINOVICH', category: 'Mikromoliya', patterns: ['B.*HT\\s+FU.*RE', 'BRIGHT\\s*FUTURE', '3RIGHT\\s*FUTURE'] },
  { id: 4, name: 'FUNDFLOW MIKROMOLIYA TASHKILOTI MCHJ', inn: '311979413', bank: 'Anorbank', mfo: '01183', account: '20216000307214276001', director: 'TOSHTEMIROV FAXRIDDIN FARHOD OGLI', category: 'Mikromoliya', patterns: ['FUNDFLOW', 'F.*FLOW', 'FUND\\s*FLOW'] },
  { id: 5, name: 'COMMUNITY MICROFINANCE MIKROMOLIYA TASHKILOTI MCHJ', inn: '312191604', bank: 'Anorbank', mfo: '01183', account: '20216000307255890001', director: 'Qilichova Lobarxon Komil qizi', category: 'Mikromoliya', patterns: ['COMMUNITY', 'C.*NITY\\s*MI.*CE', 'COMMUNITY\\s*MICROFINANCE'] },
  { id: 6, name: 'DYNAMIC CREDIT SOLUTIONS MIKROMOLIYA TASHKILOTI MCHJ', inn: '312192769', bank: 'Anorbank', mfo: '01183', account: '20216000007255899001', director: 'SULEYMANOVA DINARA SHAVKATOVNA', category: 'Mikromoliya', patterns: ['DYNAMIC', 'D.*MIC\\s*CREDIT', 'DYNAMIC\\s*CREDIT'] },
  { id: 7, name: 'ZAYMLY MIKROMOLIYA TASHKILOTI MCHJ', inn: '312500154', bank: 'Anorbank', mfo: '01183', account: '20216000407331685001', director: 'ABDUXAFIZOVA SITORA XABIB QIZI', category: 'Mikromoliya', patterns: ['ZAYMLY', 'Z.*MLY'] },
  { id: 8, name: 'DARROWMAD MIKROMOLIYA TASHKILOTI MCHJ', inn: '312510309', bank: 'Anorbank', mfo: '01183', account: '20216000307331734001', director: 'KAMOLDINOV RUSTAMBEK RO’ZIBOY O’G’LI', category: 'Mikromoliya', patterns: ['DARROWMAD', 'D.*ROWMAD', 'DAROMAD'] },
];

export interface ResolvedFirm { name: string; inn: string; category: string; isTarget: boolean }

/** Resolve a raw creditor string to a canonical firm + INN (isTarget=true for our 8 firms). */
export function resolveCreditor(rawCreditor: string | null | undefined): ResolvedFirm {
  if (!rawCreditor || rawCreditor === 'Nomaʼlum') {
    return { name: 'Davlat foydasiga (Davlat boji / Jarima)', inn: 'Davlat byudjeti', category: 'Davlat', isTarget: false };
  }
  const clean = String(rawCreditor).replace(/&quot;/g, '"').replace(/"/g, '').trim();
  if (/Da.*at/i.test(clean) || /Давлат/i.test(clean)) {
    return { name: 'Davlat foydasiga (Davlat boji / Jarima)', inn: 'Davlat byudjeti', category: 'Davlat', isTarget: false };
  }
  for (const comp of MIB_COMPANIES) {
    for (const pat of comp.patterns) {
      try {
        if (new RegExp(pat, 'i').test(clean)) return { name: comp.name, inn: comp.inn, category: comp.category, isTarget: true };
      } catch { /* bad regex — skip */ }
    }
  }
  return { name: clean, inn: 'Nomaʼlum', category: 'Boshqa', isTarget: false };
}
