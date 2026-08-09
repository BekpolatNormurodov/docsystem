// Firm registry for the e-gov integrations: maps our portfolio branchCode to the
// firm's STIR (the cabinet/hippo session `account`) and its E-IMZO key selector.
// Only firms whose key exists in C:\DSKEYS can be authenticated.
export interface FirmCfg {
  branchCode: string; name: string; stir: string;
  cabinetKey: string; // E-IMZO key selector for cabinet.sud.uz (Adolat) login
  hippoKey: string;   // E-IMZO key selector for xat.hippo.uz login (may differ)
}

export const FIRMS: FirmCfg[] = [
  { branchCode: '12842', name: 'BRIGHT FUTURE FINANCING', stir: '311976765', cabinetKey: 'akram', hippoKey: 'farrux' },
  { branchCode: '06292', name: 'URBAN FINANCE SOLUTIONS', stir: '311943592', cabinetKey: 'xasanov', hippoKey: 'xasanov' },
  { branchCode: '55890', name: 'COMMUNITY MICROFINANCE', stir: '312191604', cabinetKey: 'mamadaliyev', hippoKey: 'mamadaliyev' },
  // Fundflow (14276) / Muvaffaqiyat (05557): add once their DSKEYS keys are present.
];

export const firmByBranch = (code: string) => FIRMS.find((f) => f.branchCode === code);
export const firmByStir = (stir: string) => FIRMS.find((f) => f.stir === stir);
