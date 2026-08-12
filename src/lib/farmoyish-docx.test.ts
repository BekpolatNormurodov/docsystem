import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { renderFarmoyishDocx, courtFromDistrict } from './farmoyish-docx';

// Extract the document.xml as plain text: paragraph/row → newline, cell → " | ", strip tags, and
// normalise the ru-RU thousands space (nbsp / narrow-nbsp) to a regular space so assertions are stable.
async function docText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')!.async('string');
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:tc>/g, ' | ')
    .replace(/<[^>]*>/g, '')
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[  ]/g, ' ');
}

describe('courtFromDistrict', () => {
  it('derives the inter-district court from a tuman, else null', () => {
    expect(courtFromDistrict('Учтепа тумани')).toBe('Учтепа туманлараро судига');
    expect(courtFromDistrict('Олмазор тумани')).toBe('Олмазор туманлараро судига');
    expect(courtFromDistrict('Тошкент шаҳар')).toBeNull(); // not a tuman → caller uses generic "судга"
    expect(courtFromDistrict('')).toBeNull();
    expect(courtFromDistrict(null)).toBeNull();
  });
});

describe('renderFarmoyishDocx — matches the real URBAN reference', () => {
  const input = {
    legalName: '«URBAN FINANCE SOLUTIONS MIKROMOLIYA TASHKILOTI» MCHJ',
    district: 'Учтепа тумани',
    phone: '99-772-92-77',
    date: new Date('2026-08-07T00:00:00Z'),
    rows: [
      { clientName: "TURDALIYEV SAMANDAR SAFARALI O'G'LI", kod: '60123092', receiptNumber: '262160984965' },
      { clientName: "XOSHIMOV BEKZODBEK ERKINJON O'G'LI", kod: '60123859', receiptNumber: '262168671390' },
    ],
  };

  it('renders the reference title, date, legal name, derived court, table and signature', async () => {
    const buf = await renderFarmoyishDocx(input);
    expect(buf.length).toBeGreaterThan(2000); // a real zip/docx
    const t = await docText(buf);

    // Title + date (right of the title)
    expect(t).toContain('Бухгалтерия фармойиши');
    expect(t).toContain('07.08.2026 й');

    // Intro: full legal name + the derived Uchtepa court; the old per-item amount + total are gone.
    expect(t).toContain('«URBAN FINANCE SOLUTIONS MIKROMOLIYA TASHKILOTI» MCHJ');
    expect(t).toContain('Учтепа туманлараро судига');
    expect(t).not.toContain('ҳар бирига');
    expect(t).not.toContain('Жами:');

    // Table header + a real row (name, kod, fee, receipt)
    expect(t).toContain('Қарздор ФИО');
    expect(t).toContain('Квитанция рақами');
    expect(t).toContain("TURDALIYEV SAMANDAR SAFARALI O'G'LI");
    expect(t).toContain('60123092');
    expect(t).toContain('262160984965');
    expect(t).toContain('20 600');

    // Signature block with the real firm phone.
    expect(t).toContain('Ижрожи директори');
    expect(t).toContain('Ижрочи:');
    expect(t).toContain('Tel: 99-772-92-77');
  });

  it('falls back to the generic "судга" when the firm has no tuman district', async () => {
    const t = await docText(await renderFarmoyishDocx({ ...input, district: null }));
    expect(t).toContain('бўйича судга суд буйруғи');
    expect(t).not.toContain('туманлараро');
  });
});
