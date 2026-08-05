// Test helper: writes a tiny 2-sheet xlsx fixture for exercising importPortfolio().
// Sheet 1 mirrors real portfolio column names (incl. the 4 debt columns); sheet 2 is a
// decoy with no `pinfl` column, proving the importer skips non-portfolio worksheets.
import Excel from 'exceljs';
import JSZip from 'jszip';
import fs from 'node:fs/promises';

const HEADER = [
  'pinfl',
  'passport_sn',
  'client_name',
  'phone_mobile',
  'post_address',
  'name',
  'branch',
  'ld_id',
  'account',
  'summ_kr',
  'rate',
  'date_to_cr',
  'date_close',
  'klass_name',
  'status_name',
  'term_type',
  'summ_ost_ze',
  'sumproc_eqv',
  'summ_ostpr_ze',
  'sumnachpr_eqv',
];

export interface FixtureRow {
  pinfl: string;
  clientName: string;
  branch: string;
  summOstZe: number;
  sumprocEqv: number;
  summOstprZe: number;
  sumnachprEqv: number;
}

export const DEFAULT_FIXTURE_ROWS: FixtureRow[] = [
  { pinfl: '10000000000001', clientName: 'ALPHA ONE', branch: '12842', summOstZe: 100, sumprocEqv: 10, summOstprZe: 5, sumnachprEqv: 1 },
  { pinfl: '10000000000002', clientName: 'BETA TWO', branch: '12842', summOstZe: 200, sumprocEqv: 20, summOstprZe: 0, sumnachprEqv: 0 },
  { pinfl: '10000000000003', clientName: 'GAMMA THREE', branch: '10091', summOstZe: 300, sumprocEqv: 30, summOstprZe: 15, sumnachprEqv: 3 },
];

export async function makeFixture(filePath: string, rows: FixtureRow[] = DEFAULT_FIXTURE_ROWS): Promise<void> {
  const workbook = new Excel.Workbook();

  const sheet = workbook.addWorksheet('Portfolio');
  sheet.addRow(HEADER);
  for (const r of rows) {
    sheet.addRow([
      r.pinfl,
      `AB${r.pinfl.slice(-7)}`,
      r.clientName,
      '+998901234567',
      'Some street 1',
      'Tashkent',
      r.branch,
      `LD-${r.pinfl.slice(-4)}`,
      `ACC-${r.pinfl.slice(-4)}`,
      1000,
      24.5,
      new Date('2024-01-15'),
      null,
      'Standard',
      'Active',
      'Long',
      r.summOstZe,
      r.sumprocEqv,
      r.summOstprZe,
      r.sumnachprEqv,
    ]);
  }

  const decoy = workbook.addWorksheet('Decoy');
  decoy.addRow(['junk_column']);
  decoy.addRow(['nonsense']);

  await workbook.xlsx.writeFile(filePath);
  await reorderZipForStreamingRead(filePath);
}

/**
 * exceljs's in-memory writer places `xl/workbook.xml` (and its rels/sharedStrings) at the
 * END of the zip. Real-world xlsx files put them near the start. `Excel.stream.xlsx.WorkbookReader`
 * assumes workbook metadata + shared strings are readable before it starts resolving worksheet
 * rows; with the writer's own ordering it unpredictably crashes or leaves cells as unresolved
 * `{ sharedString: n }` placeholders. Re-pack the zip so those parts come first, matching what a
 * real portfolio export looks like and making the streaming reader deterministic for tests.
 */
async function reorderZipForStreamingRead(filePath: string): Promise<void> {
  const buf = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);
  const priority = [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/_rels/workbook.xml.rels',
    'xl/workbook.xml',
    'xl/sharedStrings.xml',
    'xl/styles.xml',
  ];
  const ordered = [...priority.filter((n) => names.includes(n)), ...names.filter((n) => !priority.includes(n))];

  const reordered = new JSZip();
  for (const name of ordered) {
    const entry = zip.files[name];
    if (entry.dir) {
      reordered.folder(name);
      continue;
    }
    reordered.file(name, await entry.async('nodebuffer'));
  }

  const outBuf = await reordered.generateAsync({ type: 'nodebuffer' });
  await fs.writeFile(filePath, outBuf);
}
