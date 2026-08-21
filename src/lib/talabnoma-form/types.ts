// Shape of the reduced dataset a parse run writes to candidates.json, and the pure filter I/O.
// Kept small: only the fields the reyestr/letter build and the two-stage filter actually need.

/** One portfolio loan row kept for a candidate person (source of contract detail for the letter). */
export interface CandidateLoan {
  branch: string | null; // portfolio branch code == firm code
  clientName: string | null;
  ldId: string | null; // contract number
  dateToCr: string | null; // ISO date (contract date)
  summKr: number | null; // loan amount
  totalDebt: number; // full debt (for the letter's «Jami qarzdorlik»)
  postAddress: string | null;
  postAddressUz: string | null;
  regionName: string | null;
  distrName: string | null; // raw distr_name → hippo area id
}

/** One debtor aggregated from Лист1, with per-firm overdue (Лист2) + portfolio loans. */
export interface CandidatePerson {
  pinfl: string;
  fio: string | null;
  totalOverdue: number; // |Лист1 «12405%+16377%»| — the total-debt filter (A) reads this
  address: string | null;
  phone: string | null;
  region: string | null;
  district: string | null;
  firmsText: string | null; // raw Лист1 MKO cell
  perFirm: Record<string, number>; // firm code → |Лист2 per-firm overdue|
  loans: CandidateLoan[]; // portfolio loans (may be empty if no portfolio match)
}

export interface CandidatesFile {
  docDate: string; // ISO — the talabnoma document date (upload day)
  firmNameByCode: Record<string, string>; // Лист3 code → firm name
  people: CandidatePerson[];
}

export interface FilterOpts {
  thresholdTotal: number; // default 2_000_000
  perFirmMin: number; // default 0 (off)
}

export interface FirmBucket {
  code: string;
  name: string;
  ready: boolean; // ∈ the 3 wired firms (Bright/Urban/Community)
  personCount: number;
  overdueSum: number;
}

export interface FilterResult {
  qualifiedPeople: number; // passed filter A (total ≥ threshold)
  candidatePeople: number; // all people in the file
  firms: FirmBucket[]; // per-firm buckets AFTER filters A+B
  readyPersonCount: number; // people with ≥1 ready firm-row after filters
  unreadyPersonCount: number; // people whose only remaining rows are non-ready firms
}
