// Ismni moslashtirish uchun normalizatsiya — diakritika olib tashlash, apostroflarni birlashtirish,
// X→H, o'zbek/qoraqalpoq kirillini asos harflarga yig'ish. Latin + Kirill xavfsiz.
// 2026-09-21: alohida toza faylga chiqarildi (client bundle prisma tortmasin — status-ingest.ts
// server-only, u fuzzy.ts orqali client tomonga kirib borgan edi va webpack node:crypto/etc.
// bilan yiqilardi).
export function normName(s: string): string {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[‘’`ʻ']/g, '').replace(/X/g, 'H')
    // Fold Uzbek/Karakalpak Cyrillic to base letters BEFORE the keep-class strip —
    // else Ў Қ Ғ Ҳ Ҷ Ё (outside А-Я) are deleted, collapsing ҒАНИЕВ→АНИЕВ and
    // false-matching a different АНИЕВ (→ wrong client's PINFL on a court case).
    .replace(/Ў/g, 'У').replace(/Қ/g, 'К').replace(/Ғ/g, 'Г').replace(/Ҳ/g, 'Х').replace(/Ҷ/g, 'Ч').replace(/Ё/g, 'Е')
    // Э↔Е: so'z boshidagi /e/ tovushi ismlarda ham Э (ЭРГАШЕВ), ham Е (ЕРГАШЕВ) yoziladi;
    // latinToCyrillic doim Е-shakl beradi, shuning uchun ikkalasini Е ga keltiramiz.
    // Ъ/Ь — tashlaymiz.
    .replace(/Э/g, 'Е').replace(/[ЪЬ]/g, '')
    .replace(/[^A-ZА-Я ]/g, '').replace(/\s+/g, ' ').trim();
}
