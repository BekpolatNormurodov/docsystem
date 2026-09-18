// Bir nechta PDF'ni BITTA faylga birlashtirish — sahifalar tartibi saqlanadi, qayta rasterlanmaydi.
//
// NEGA: sud paketida har kredit shartnomasi (oferta) alohida fayl bo'lib ketardi — 17 kreditli
// mijozda 17 ta «Boshqa hujjatlar». 2026-09-18 tahlili: kredit (fayl) soni oshgan sari ADOLAT
// kantselyariyasi «Ҳужжатлар тартибсиз ёки тескари сақланганлиги сабабли …» deb ko'proq qaytargan
// (1 kredit — 50%, 11+ — 97%). Bitta ilova bandi = bitta fayl bo'lsin.
//
// pdf-lib `copyPages` — sahifa obyektlari (matn, shriftlar, rasmlar) o'zgarmay ko'chiriladi,
// hech narsa rasmga aylantirilmaydi. Yon ta'sirsiz: faqat buferlar bilan ishlaydi.
import { PDFDocument } from 'pdf-lib';

export class PdfMergeError extends Error {
  constructor(message: string) { super(message); this.name = 'PdfMergeError'; }
}

// PDF sarlavhasi odatda 0-baytda, lekin spetsifikatsiya birinchi 1024 bayt ichida ruxsat beradi.
function looksLikePdf(b: Uint8Array): boolean {
  if (!b || b.length < 8) return false;
  return Buffer.from(b.subarray(0, Math.min(1024, b.length))).toString('latin1').includes('%PDF-');
}

/**
 * `parts` ni berilgan TARTIBDA bitta PDF qiladi. `labels` (ixtiyoriy) — xato xabarida qaysi fayl
 * buzuq ekanini aytish uchun (masalan fayl nomlari).
 *
 * Xato (PdfMergeError): bo'sh ro'yxat; PDF bo'lmagan bufer; ochilmaydigan yoki shifrlangan PDF;
 * sahifasiz PDF. Jim tashlab ketilmaydi — sudga chala hujjat ketmasin.
 * Bitta qism berilsa — o'sha bufer o'zgarmay qaytadi (baytma-bayt).
 */
export async function mergePdfs(parts: Uint8Array[], opts: { labels?: string[] } = {}): Promise<Buffer> {
  if (!parts?.length) throw new PdfMergeError('mergePdfs: birlashtiriladigan PDF yo\'q (bo\'sh ro\'yxat)');
  const name = (i: number) => opts.labels?.[i] ?? `#${i + 1}`;

  for (let i = 0; i < parts.length; i++) {
    if (!looksLikePdf(parts[i])) throw new PdfMergeError(`mergePdfs: ${name(i)} PDF emas (%PDF sarlavhasi yo'q)`);
  }
  if (parts.length === 1) return Buffer.from(parts[0]);

  const out = await PDFDocument.create();
  for (let i = 0; i < parts.length; i++) {
    let src: PDFDocument;
    try {
      // ignoreEncryption=false: shifrlangan PDF'dan ko'chirilgan sahifa bo'sh/buzuq chiqadi — rad etamiz.
      src = await PDFDocument.load(parts[i], { ignoreEncryption: false, updateMetadata: false });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      throw new PdfMergeError(`mergePdfs: ${name(i)} ochilmadi (${/encrypt/i.test(why) ? 'shifrlangan' : why})`);
    }
    const count = src.getPageCount();
    if (count === 0) throw new PdfMergeError(`mergePdfs: ${name(i)} da sahifa yo'q`);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  return Buffer.from(await out.save());
}
