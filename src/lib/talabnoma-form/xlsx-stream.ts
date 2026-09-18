// Bounded-memory .xlsx row streamer for portfolios whose zip uses «data descriptors»
// (openpyxl / davlat eksportlari) — exceljs'ning stream reader'i bunday zip'ni «invalid signature»
// bilan rad etadi, readFile esa 100MB+ da xotirani portlatadi. unzipper.Open MARKAZIY KATALOGni
// o'qiydi (to'g'ri o'lchamlar) → har entry'ni to'g'ri ochadi (local-header bayrog'idan qat'i nazar);
// varaqni saxes bilan oqim orqali parse qilamiz — xotira cheklangan qoladi.
import unzipper from 'unzipper';
import { SaxesParser } from 'saxes';
import type { Readable } from 'node:stream';

// «A1» / «BC12» → 0-asosli ustun indeksi (A=0). Faqat harf qismi olinadi.
function colIndex(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// sharedStrings.xml → indeks bo'yicha matnlar massivi. <si> ichida bir nechta <t> bo'lsa (rich text) —
// birlashtiriladi.
async function readSharedStrings(stream: Readable): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    const out: string[] = [];
    const parser = new SaxesParser();
    let inSi = false, cur = '', capture = false;
    parser.on('opentag', (tag) => {
      if (tag.name === 'si') { inSi = true; cur = ''; }
      else if (tag.name === 't' && inSi) capture = true;
    });
    parser.on('text', (txt: string) => { if (capture) cur += txt; });
    parser.on('cdata', (txt: string) => { if (capture) cur += txt; });
    parser.on('closetag', (tag) => {
      if (tag.name === 't') capture = false;
      else if (tag.name === 'si') { out.push(cur); inSi = false; }
    });
    parser.on('error', reject);
    stream.on('data', (c: Buffer) => { try { parser.write(c.toString('utf8')); } catch (e) { reject(e as Error); } });
    stream.on('end', () => { try { parser.close(); } catch { /* ignore */ } resolve(out); });
    stream.on('error', reject);
  });
}

// Bitta varaqni parse qiladi. 1-qator uchun onFirstRow(values) chaqiriladi: true qaytarsa — bu bizning
// varaq (keyingi qatorlar onRow'ga boradi), false — decoy (parse to'xtatiladi). Topilsa true qaytadi.
function parseSheet(
  stream: Readable,
  shared: string[],
  onFirstRow: (values: unknown[]) => boolean,
  onRow: (values: unknown[]) => void,
): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const parser = new SaxesParser();
    let headerDecided: boolean | null = null; // null=hali, true=bizniki, false=decoy
    let stopped = false;
    let values: unknown[] = [];
    let curCol = -1, curType = '', cellText = '', capture = false, inRow = false;
    const stop = (result: boolean) => {
      if (stopped) return; stopped = true;
      try { stream.destroy(); } catch { /* ignore */ }
      resolve(result);
    };
    parser.on('opentag', (tag) => {
      if (stopped) return;
      if (tag.name === 'row') { inRow = true; values = []; }
      else if (tag.name === 'c' && inRow) {
        curType = (tag.attributes as Record<string, string>).t || '';
        curCol = colIndex(String((tag.attributes as Record<string, string>).r || 'A'));
        cellText = '';
      } else if ((tag.name === 'v' || tag.name === 't') && inRow) capture = true;
    });
    parser.on('text', (txt: string) => { if (capture) cellText += txt; });
    parser.on('cdata', (txt: string) => { if (capture) cellText += txt; });
    parser.on('closetag', (tag) => {
      if (stopped) return;
      if (tag.name === 'v' || tag.name === 't') { capture = false; return; }
      if (tag.name === 'c') {
        if (curCol >= 0) {
          let val: unknown;
          if (curType === 's') val = shared[Number(cellText)] ?? '';
          else if (curType === '') val = cellText === '' ? null : Number(cellText); // raqam/sana-serial → number (toDate hal qiladi)
          else val = cellText; // inlineStr/str/b/d/e → matn
          values[curCol] = val;
        }
        curCol = -1; curType = '';
        return;
      }
      if (tag.name === 'row') {
        inRow = false;
        if (headerDecided === null) {
          headerDecided = onFirstRow(values);
          if (!headerDecided) { stop(false); return; } // decoy varaq — o'tkazamiz
        } else if (headerDecided) {
          onRow(values);
        }
      }
    });
    parser.on('error', (e: Error) => { if (!stopped) reject(e); });
    stream.on('data', (c: Buffer) => { if (!stopped) { try { parser.write(c.toString('utf8')); } catch (e) { if (!stopped) reject(e as Error); } } });
    stream.on('end', () => { if (!stopped) { try { parser.close(); } catch { /* ignore */ } resolve(headerDecided === true); } });
    stream.on('error', (e: Error) => { if (!stopped) reject(e); });
  });
}

export interface StreamXlsxOpts {
  isHeaderRow: (values: string[]) => boolean; // true → shu (birinchi) qator kerakli sarlavha
  onRow: (header: string[], values: unknown[]) => void;
}

/** Data-descriptor zip'ga chidamli, xotira-cheklangan portfel o'quvchi: birinchi «pinfl» sarlavhali
 *  varaqni oqim orqali o'qiydi. Mos varaq topilsa true. */
export async function streamXlsxRowsViaUnzipper(path: string, opts: StreamXlsxOpts): Promise<boolean> {
  const directory = await unzipper.Open.file(path);
  const ss = directory.files.find((f) => f.path === 'xl/sharedStrings.xml');
  const shared = ss ? await readSharedStrings(ss.stream()) : [];
  const sheets = directory.files
    .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f.path))
    .sort((a, b) => (Number(/(\d+)\.xml$/.exec(a.path)?.[1] ?? 0) - Number(/(\d+)\.xml$/.exec(b.path)?.[1] ?? 0)));
  let header: string[] | null = null;
  for (const sheet of sheets) {
    header = null;
    const found = await parseSheet(
      sheet.stream(),
      shared,
      (values) => {
        const h = values.map((v) => (v === null || v === undefined ? '' : String(v)));
        if (opts.isHeaderRow(h)) { header = h; return true; }
        return false;
      },
      (values) => { if (header) opts.onRow(header, values); },
    );
    if (found) return true;
  }
  return false;
}
