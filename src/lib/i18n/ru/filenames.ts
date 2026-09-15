// Yuklab olinadigan HISOBOT/EKSPORT fayllari nomlari (Content-Disposition + client `a.download`).
// Faqat sayt hisobotlari/ro'yxatlari tarjima qilinadi; yuridik hujjatlar (ariza/oferta/talabnoma
// hujjati, sud hujjatlari, skanlar, kvitansiya PDF) fayl nomi rasmiy o'zbekchada qoladi.
// Kalit = o'zbek (lotin) manba. uz-cyrl avtomatik transliteratsiya qiladi, faqat RU shu yerda.
export const filenames: Record<string, string> = {
  "Mijozlar holati": "Статусы клиентов",
  "Sud firma statistikasi": "Судебная статистика по фирмам",
  "Talabnoma reyestr": "Реестр требований",
  "Talabnoma umumiy": "Требования (сводно)",
  "Sud formasi": "Судебная форма",
  "kvitansiyalar": "квитанции",
  "roʻyxat": "список",
  "namuna": "образец",
  "arizasi topilmaganlar": "без заявления",
};
