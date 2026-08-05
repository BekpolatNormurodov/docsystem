export interface FirmSeed {
  code: string;
  shortName: string;
  legalName?: string;
  address?: string;
  bankAccount?: string;
  mfo?: string;
  stir?: string;
  postIndex?: string;
}

/** Post index 100174 for all; only Bright Future has full rekvizit from the sample ariza. */
export const FIRMS_SEED: FirmSeed[] = [
  {
    code: '12842',
    shortName: 'BRIGHT FUTURE FINANCING',
    legalName: '«BRIGHT FUTURE FINANCING» MIKROMOLIYA TASHKILOTI MCHJ',
    address: 'Toshkent shahar, Olmazor tumani, Guruchariq MFY, Sagʻbon koʻchasi 30 berk, 7/1-uy',
    bankAccount: '20216000207212842001',
    mfo: '01183',
    stir: '311 976 765',
    postIndex: '100174',
  },
  { code: '06292', shortName: 'URBAN FINANCE SOLUTIONS', postIndex: '100174' },
  { code: '55890', shortName: 'COMMUNITY MMT', postIndex: '100174' },
  { code: '05557', shortName: 'MUVAFFAQIYAT MMT', postIndex: '100174' },
  { code: '14276', shortName: 'FUNDFLOW', postIndex: '100174' },
  { code: '31685', shortName: 'ZAYMLY', postIndex: '100174' },
  { code: '31734', shortName: 'DARROWMAD', postIndex: '100174' },
  { code: '55899', shortName: 'DYNAMIC CREDIT SOLUTIONS MIKROMOLIYA TASHKILOTI', postIndex: '100174' },
  { code: '07634', shortName: '"PRESTIGE MOLIYA" MCHJ MMT', postIndex: '100174' },
];
