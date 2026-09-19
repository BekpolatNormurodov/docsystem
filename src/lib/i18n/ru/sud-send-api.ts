// «Sudga o'tkazish» (/sud 3-tab) backend — /konveyer/sud-send, court-queue/resume va
// court-send-suits.ts xabarlari RU tarjimalari (2026-09-19). Kalit = aynan manba (o'zbekcha) matn.
// Mavjud kalitlar ('firmId kerak', 'Firma topilmadi', 'Tugashini kuting.', 'Firmada STIR yoʻq — …')
// routes.ts'da — bu yerda takrorlanmaydi.
export const sudSendApi: Record<string, string> = {
  "Ish tanlanmagan": "Не выбрано ни одного дела",
  "Bir partiyada eng ko‘pi 100 ta ish yuboriladi": "За одну партию можно отправить не более 100 дел",
  "Real yuborish serverda o‘chirilgan (CABINET_ALLOW_SEND_TO_COURT≠1)": "Реальная отправка отключена на сервере (CABINET_ALLOW_SEND_TO_COURT≠1)",
  "Firma nofaol": "Фирма неактивна",
  "Pauza holatini o‘qib bo‘lmadi — xavfsizlik uchun yuborilmaydi": "Не удалось прочитать состояние паузы — в целях безопасности отправка не выполняется",
  "Sudga yuborish umumiy pauzada. Avval pauzani oching.": "Отправка в суд на общей паузе. Сначала снимите паузу.",
  "Bu firma pauzada. Avval firma pauzasini oching.": "Эта фирма на паузе. Сначала снимите паузу фирмы.",
  "E-IMZO tasdig‘i yo‘q yoki eskirgan (10 daqiqadan oshgan). Firma kaliti bilan qayta tasdiqlang.": "Подтверждение E-IMZO отсутствует или устарело (более 10 минут). Подтвердите заново ключом фирмы.",
  "E-IMZO tasdig‘i boshqa foydalanuvchiga tegishli. O‘zingiz qayta tasdiqlang.": "Подтверждение E-IMZO принадлежит другому пользователю. Подтвердите сами.",
  "E-IMZO imzo egasi tasdiqlanmagan — real yuborish uchun tasdiqlangan imzo kerak.": "Владелец подписи E-IMZO не подтверждён — для реальной отправки нужна подтверждённая подпись.",
  "Boshqa sud partiyasi ketmoqda": "Выполняется другая судебная партия",
  "Yuborishga yaroqsiz ishlar": "Дела, непригодные к отправке",
  "Ro‘yxatni yangilab, qaytadan tanlang.": "Обновите список и выберите заново.",
  "Bugun yuboriladigan ish qolmadi — sud oynasi yopiq, kunlik limit tugagan yoki sud firmaga biriktirilmagan.": "Сегодня отправлять нечего — окно суда закрыто, дневной лимит исчерпан или суд не привязан к фирме.",
  "Bir vaqtda boshqa partiya yaratildi — qaytadan urinib ko‘ring.": "Одновременно была создана другая партия — попробуйте ещё раз.",
  "Real (sudga) yuborish endi faqat «Sudga o‘tkazish» bo‘limida — navbatdagi real ishlar avtomat davom ettirilmaydi.": "Реальная отправка в суд теперь только в разделе «Передача в суд» — реальные дела из очереди автоматически не продолжаются.",
};
