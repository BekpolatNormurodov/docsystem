// Firm registry for the e-gov integrations: maps our portfolio branchCode to the
// firm's STIR (the cabinet/hippo session `account`) and its E-IMZO key selector.
// Only firms whose key exists in C:\DSKEYS can be authenticated.
export interface FirmCfg {
  branchCode: string; name: string; stir: string;
  cabinetKey: string; // E-IMZO key selector for cabinet.sud.uz (Adolat) login
  hippoKey: string;   // E-IMZO key selector for xat.hippo.uz login (may differ)
  // xat.hippo talabnoma template id — pins the EXACT template for this firm. The three firms
  // share one hippo account whose template list holds several «Talabnoma» entries, so matching
  // by name alone is ambiguous; the id disambiguates (see resolveContext). From the live
  // /template list (2026-08): Urban 119 «Urban talabnoma», Bright 42, Community 123.
  hippoTemplateId?: number;
}

export const FIRMS: FirmCfg[] = [
  { branchCode: '12842', name: 'BRIGHT FUTURE FINANCING', stir: '311976765', cabinetKey: 'akram', hippoKey: 'farrux', hippoTemplateId: 42 },
  { branchCode: '06292', name: 'URBAN FINANCE SOLUTIONS', stir: '311943592', cabinetKey: 'xasanov', hippoKey: 'xasanov', hippoTemplateId: 119 },
  { branchCode: '55890', name: 'COMMUNITY MICROFINANCE', stir: '312191604', cabinetKey: 'mamadaliyev', hippoKey: 'mamadaliyev', hippoTemplateId: 123 },
  // Fundflow (14276) / Muvaffaqiyat (05557): add once their DSKEYS keys are present.
];

const onlyDigits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');
export const firmByBranch = (code: string) => FIRMS.find((f) => f.branchCode === code);
export const firmByStir = (stir: string) => FIRMS.find((f) => onlyDigits(f.stir) === onlyDigits(stir));
// xat.hippo template id for a firm identified by STIR (digits-tolerant). undefined → fall back to name match.
export const hippoTemplateIdByStir = (stir: string) => firmByStir(stir)?.hippoTemplateId;
