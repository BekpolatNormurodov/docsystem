// /sud «Qaytganlar» tab'i (ReturnsTab + /konveyer/sud-returns/* route'lari) RU tarjimalari — 2026-09-19.
// Faqat YANGI kalitlar: boshqa bo'limlarda allaqachon bor kalitlar (Yangilash, Hujjatlar, Ajrim, …)
// bu yerda takrorlanmaydi (takrorlansa SECTIONS tartibi bo'yicha biri ikkinchisini bosib ketadi).
// 2026-09-20: HeaderShell/FirmQueue uchun umumiy vokabulyar (Ketmoqda/Navbatda/Sudda/To'siq) —
// stat sondagi va sub filter chip'idagi so'z bir xil bo'lishi shart (operator shikoyati).
export const sudReturns: Record<string, string> = {
  // ── 2026-09-20 yangi qobiq (HeaderShell + FirmQueue) ──
  'Qaytganlar': 'Возвраты',
  'Sud qaytargan ishlarni sababiga qarab tuzatib, qayta qoralamaga o‘tkazing': 'Возвращённые судом дела — исправьте по причине и передайте в повторный черновик',
  'Firmalar bo‘yicha qaytganlar': 'Возвраты по фирмам',
  // 'Jami' → common.ts da bor («Итого»), takrorlamaymiz (common ustun keladi).
  'Ushlangan': 'Придержаны',
  'Navbatda': 'В очереди',
  'Tayyorlangan': 'Подготовлены',
  // CourtQueueState labels (sud/forma Excel «Navbat holati» ustuni + boshqa joylar)
  'Ketmoqda': 'Идёт',
  'Yuborildi': 'Отправлено',
  'Xato': 'Ошибка',
  'Oʻtkazib yuborildi': 'Пропущено',
  // Sud formasi Excel — PINFL boʻyicha varag'i
  'PINFL boʻyicha': 'По ПИНФЛ',
  'PINFL BOʻYICHA (kishi darajasida)': 'ПО ПИНФЛ (на уровне человека)',
  'FIRMA BOʻYICHA JAMLASH (kishi + kredit + summa)': 'СВОДКА ПО ФИРМАМ (люди + кредиты + сумма)',
  'Firma(lar)': 'Фирма(-ы)',
  'Firmalar soni': 'Кол-во фирм',
  'Kreditlar soni': 'Кол-во кредитов',
  'Yopiq kreditlar': 'Закрытые',
  'Palata skani': 'Скан палаты',
  'Kishilar': 'Люди',
  'Kishilar_p': 'Людей',
  'Shartnomalar': 'Договоры',
  'Kreditlar': 'Кредиты',
  'Yuklab olingan': 'Скачано',
  'Firmalar boʻyicha oqim': 'Поток по фирмам',
  'Sud statuslari (firma boʻyicha)': 'Статусы суда (по фирмам)',
  'Bosqichlar (funnel)': 'Этапы (воронка)',
  'Umumiy koʻrsatkichlar': 'Общие показатели',
  'Viloyatlar boʻyicha': 'По областям',
  'Firma boʻyicha yoyilgan': 'По фирмам (развёрнуто)',
  'Mijozlar holati': 'Статус клиентов',
  'firma': 'фирм',
  'Firma bo‘yicha': 'По фирме',
  'Portaldagi ro‘yxat': 'Список на портале',
  'Portaldagi qaytganlar': 'Возвраты на портале',
  'Sabablar olinmoqda…': 'Получение причин…',
  'Tayyor qaytgan ish yo‘q': 'Нет готовых возвращённых дел',
  'Bir vaqtda bitta partiya — ketayotgani tugagach boshlanadi.': 'Одновременно одна партия — начнётся после завершения текущей.',
  'qayta qoralama': 'повторный черновик',
  'qaytganlardan qoralama': 'черновик из возвратов',
  'qoralama': 'черновик',
  'sudga o‘tkazish': 'передача в суд',
  'qaytgan': 'возвращ.',
  'tayyor': 'готово',
  'Sabab kutilmoqda': 'Ожидание причины',
  'Sababi hali olinmagan — «Sabablarni yangilash»ni bosing': 'Причина ещё не получена — нажмите «Обновить причины»',
  'ta xato — pastdagi ro‘yxatdan sababini ko‘ring': 'с ошибкой — причину смотрите в списке ниже',
  'Qaysi firma uchun qayta qoralama?': 'Для какой фирмы повторный черновик?',
  'Bir vaqtda bitta firma — bittasini tanlang.': 'Одновременно только одна фирма — выберите одну.',
  'Firma': 'Фирма',
  'Bekor': 'Отмена',
  'Yopish': 'Закрыть',


  // ── tab sarlavhasi, izoh, qadamlar ──
  'Qaytganlar — sud qaytargan ishlarni qayta tayyorlash': 'Возвраты — повторная подготовка дел, возвращённых судом',
  'Sud qaytargan (rad etgan yoki ko‘rmasdan qaytargan) arizalar shu yerda. Har bir ishning sababini ko‘ring, hujjatini tuzating yoki paket tuzatilguncha ushlab turing, so‘ng qayta qoralama tayyorlang. Bu bo‘limdan sudga hech narsa yuborilmaydi — tayyorlangan ish «Sudga o‘tkazish» bo‘limiga o‘tadi.':
    'Здесь заявления, которые суд вернул (отклонил или вернул без рассмотрения). Посмотрите причину по каждому делу, исправьте документы или придержите дело до исправления пакета, затем подготовьте новый черновик. Из этого раздела в суд ничего не отправляется — подготовленное дело переходит в раздел «Передача в суд».',
  'Sudga o‘tkazish': 'Передача в суд',
  'Portal holati avtomatik tekshiriladi; qaytgan ish shu ro‘yxatga tushadi.': 'Статус на портале проверяется автоматически; возвращённое дело попадает в этот список.',
  'Sababini ko‘rib, hujjatni tuzating': 'Посмотрите причину и исправьте документы',
  'Sabab chipi, «Hujjatlar» va «Ajrim» orqali. Tuzatilguncha «Ushlab turish» mumkin.': 'Через метку причины, «Документы» и «Определение». До исправления можно «Придержать».',
  'Qayta qoralama': 'Повторный черновик',
  'Tayyor ishlar uchun ADOLAT’da yangi qoralama (Murojaatlarim) tayyorlanadi.': 'Для готовых дел в ADOLAT готовится новый черновик («Мои обращения»).',
  'Yurist portaldan yuborgan va sud qaytargan qoralamalar har 20 daqiqada avtomatik shu ro‘yxatga o‘tkaziladi.':
    'Черновики, отправленные юристом с портала и возвращённые судом, автоматически переносятся в этот список каждые 20 минут.',
  'Avto-aniqlash sinov rejimida: portal qaytargan qoralamalar faqat hisoblanadi, ro‘yxatga avtomatik o‘tkazilmaydi (Setting court_declined_reset).':
    'Автоопределение в тестовом режиме: возвращённые порталом черновики только подсчитываются и не переносятся в список автоматически (Setting court_declined_reset).',
  'Avto-aniqlash: yoqilgan': 'Автоопределение: включено',
  'Avto-aniqlash: sinov rejimi': 'Автоопределение: тестовый режим',

  // ── ro'yxat, filtrlar, holatlar ──
  'Qaytgan ishlar': 'Возвращённые дела',
  'Qaytgan ish yo‘q': 'Возвращённых дел нет',
  'Sud qaytargan ishlar shu yerda paydo bo‘ladi. Portal holati worker tomonidan muntazam tekshiriladi.':
    'Дела, возвращённые судом, появятся здесь. Статус на портале регулярно проверяется фоновым процессом.',
  'Kutmoqda': 'Ожидает',
  'Hali qayta tayyorlanmagan — sababini ko‘rib, hujjatni tuzating.': 'Ещё не подготовлено повторно — посмотрите причину и исправьте документы.',
  'Qayta qoralama urinishi o‘tmadi — xato matnini o‘qing.': 'Попытка повторного черновика не прошла — прочитайте текст ошибки.',
  'Ushlab turilgan': 'Придержано',
  'Paket tuzatilguncha qayta qoralamaga olinmaydi (Go ham olmaydi).': 'Не берётся в повторный черновик до исправления пакета (Go тоже не берёт).',
  'Qayta qoralama partiyasida — ADOLAT’da tayyorlanmoqda.': 'В партии повторных черновиков — готовится в ADOLAT.',
  'Qayta tayyorlandi': 'Подготовлено повторно',
  'Yangi qoralama tayyor — «Sudga o‘tkazish» bo‘limida yuboriladi.': 'Новый черновик готов — отправляется в разделе «Передача в суд».',
  'Sabab': 'Причина',
  'Sabab:': 'Причина:',
  'Xato:': 'Ошибка:',
  'Yetishmaydi:': 'Не хватает:',
  'yetkazilganlik isboti': 'подтверждение вручения',
  'Tartibsiz / teskari': 'Беспорядок / перевёрнуты',
  'Hujjatlar tartibsiz yoki teskari — paket tartibi 2026-09-18 da tuzatilgan; qayta qoralama yangi paket bilan ketadi.':
    'Документы в беспорядке или перевёрнуты — порядок пакета исправлен 18.09.2026; повторный черновик уйдёт с новым пакетом.',
  'Varaqlar to‘liq emas': 'Листы неполные',
  'Hujjat varaqlari to‘liq emas — skan va ofertalarni tekshiring.': 'Листы документов неполные — проверьте сканы и оферты.',
  'Yetkazilganlik isboti yo‘q': 'Нет подтверждения вручения',
  'Qarzdor talabnomani olgani isbotlanmagan — yetkazilgan (to‘ldirilgan) check kerak.': 'Не подтверждено, что должник получил требование — нужен заполненный чек о вручении.',
  'JShShIR ma’lumoti': 'Данные ПИНФЛ',
  'Javobgar JShShIR (PINFL) ma’lumotlari to‘liq emas.': 'Данные ПИНФЛ ответчика неполные.',
  'Boshqa sabab': 'Другая причина',
  'Sabab matnini o‘qing.': 'Прочитайте текст причины.',
  'Sabab olinmagan': 'Причина не получена',
  '«Sabablarni yangilash» tugmasi ADOLAT’dan sababni olib keladi.': 'Кнопка «Обновить причины» получает причину из ADOLAT.',
  'Qaytgan sana': 'Дата возврата',
  'Portalda ochiq ish bor': 'На портале есть открытое дело',
  'Portalda shu odamga shu firma nomidan boshqa ochiq ish bor (ko‘pincha eski CREATED qoralama). Qayta qoralama ikkinchi da’vo ochadi — avval portaldagi ortiqchasini o‘chiring.':
    'На портале у этого человека уже есть другое открытое дело от этой фирмы (обычно старый черновик CREATED). Повторный черновик откроет второй иск — сначала удалите лишний на портале.',
  'F.I.O, PINFL, firma, sud yoki ish raqami…': 'Ф.И.О., ПИНФЛ, фирма, суд или номер дела…',
  'Hujjatlar to‘liq': 'Документы полные',
  'Check bor, lekin yetkazilganlik isboti yo‘q': 'Чек есть, но нет подтверждения вручения',
  // Tayyorlik plitkalari (qisqartmalar): Talabnoma · Check · Skan · Oferta · Boji
  'T': 'Т',
  'C': 'Ч',
  'S': 'С',
  'O': 'О',
  'B': 'П',

  // ── qator amallari ──
  'Portal ish raqami topilmadi': 'Номер дела на портале не найден',
  'Ushlab turish': 'Придержать',
  'Qo‘yib yuborish': 'Отпустить',
  'Qayta qoralamaga qo‘yib yuborish': 'Вернуть в повторный черновик',
  'Paket tuzatilguncha qayta qoralamaga olinmasin': 'Не брать в повторный черновик, пока пакет не исправлен',
  'Sud ajrimi': 'Определение суда',
  'Sud qaytarish sababi': 'Причина возврата судом',
  'Bu ish ro‘yxatga olishda (devonxonada) qaytarilgan — bunday ishga ajrim chiqarilmaydi. Sabab yuqoridagi «Sabab» bo‘limida.':
    'Дело возвращено при регистрации (канцелярией) — по таким делам определение не выносится. Причина указана выше в разделе «Причина».',

  // ── ommaviy amallar ──
  'Qayta qoralamaga tayyor:': 'Готово к повторному черновику:',
  'Qayta qoralama tayyorlash': 'Подготовить повторный черновик',
  'Hozir qayta qoralamaga tayyor ish yo‘q — hujjati to‘liq, ushlab turilmagan va navbatda bo‘lmagan qaytgan ishlar shu yerda chiqadi.':
    'Сейчас нет дел, готовых к повторному черновику — здесь появятся возвращённые дела с полными документами, не придержанные и не в очереди.',
  'ta tayyor ish olinmaydi: portalda shu odamga boshqa ochiq ish bor («Portalda ochiq ish bor»). Avval ortiqchasini portalda o‘chiring.':
    'готовых дел не будут взяты: на портале у этого человека есть другое открытое дело («На портале есть открытое дело»). Сначала удалите лишнее на портале.',
  'Qayta qoralama tayyorlansinmi?': 'Подготовить повторный черновик?',
  'ta qaytgan ish uchun ADOLAT’da yangi qoralama («Murojaatlarim») tayyorlanadi. Sudga YUBORILMAYDI — buni keyin «Sudga o‘tkazish» bo‘limida qilasiz. Hujjati to‘liq bo‘lmagan, ushlab turilgan, navbatdagi va portalda boshqa ochiq ishi bor ishlar olinmaydi.':
    'возвращённых дел: в ADOLAT будет подготовлен новый черновик («Мои обращения»). В суд НЕ ОТПРАВЛЯЕТСЯ — это делается позже в разделе «Передача в суд». Дела с неполными документами, придержанные, в очереди и с другим открытым делом на портале не берутся.',
  'ta ish qayta qoralamaga navbatga qo‘yildi. Holat shu ro‘yxatda yangilanib boradi.': 'дел поставлено в очередь на повторный черновик. Статус будет обновляться в этом списке.',
  'ta ish ushlab turildi.': 'дел придержано.',
  'ta ish qo‘yib yuborildi.': 'дел отпущено.',
  'ta tanlandi': 'выбрано',
  'Qayta qoralama bir vaqtda bitta firma uchun — bitta firmaning ishlarini tanlang.': 'Повторный черновик — по одной фирме за раз: выберите дела одной фирмы.',
  'Tanlanganlar orasida qayta qoralamaga tayyor ish yo‘q.': 'Среди выбранных нет дел, готовых к повторному черновику.',
  'Qaytganlardan qayta qoralama partiyasi ketmoqda': 'Идёт партия повторных черновиков из возвратов',
  'Qoralama partiyasi ketmoqda': 'Идёт партия черновиков',
  'Sud partiyasi ketmoqda': 'Идёт судебная партия',
  'Bir vaqtda bitta partiya — yangisi shu tugagach boshlanadi.': 'Одновременно только одна партия — новая начнётся после её завершения.',
  'Sababini olish': 'Получить причину',
  'Ko‘rinayotganlarni belgilash': 'Выбрать видимые',
  'Yana ko‘rsatish': 'Показать ещё',

  // ── sabablarni olish ──
  'Sabablarni yangilash': 'Обновить причины',
  'Sababi olinmagan yoki eskirgan ishlar uchun ADOLAT’dan sababni olish': 'Получить причину из ADOLAT для дел без причины или с устаревшей причиной',
  'Hamma ishning sababi olingan': 'Причины получены по всем делам',
  'Sabablarni ADOLAT’dan olish': 'Получение причин из ADOLAT',
  'ta ish uchun rad etish sababi ADOLAT’dan birma-bir olinadi (har biri ~4 soniya, IP bloklanmasligi uchun sekin). Bir urinishda 30 tadan; oyna ochiq tursa qolgani o‘zi davom etadi. To‘xtatish mumkin.':
    'дел: причина отказа будет получена из ADOLAT по одному (≈4 секунды на дело, медленно, чтобы не заблокировали IP). По 30 за раз; пока окно открыто, остальное продолжится само. Можно остановить.',
  'Sabablar olinmoqda:': 'Получение причин:',
  'Cabinet sessiyasi tugagan:': 'Сессия Cabinet истекла:',
  '«Ulanishlar» orqali E-IMZO bilan qayta ulang.': 'Переподключите через «Подключения» с помощью E-IMZO.',
  'ADOLAT ketma-ket javob bermadi — to‘xtatildi. Birozdan keyin qayta urinib ko‘ring.': 'ADOLAT несколько раз подряд не ответил — остановлено. Попробуйте чуть позже.',
  'ta ish uchun sabab olinmadi (portal id topilmadi yoki ish o‘chirilgan).': 'дел: причина не получена (ID на портале не найден или дело удалено).',
  'Sabablar olinmadi': 'Причины не получены',

  // ── portal ro'yxati (yig'ma) ──
  'Portaldagi barcha qaytganlar': 'Все возвраты на портале',
  'cabinet.sud.uz natijasi bo‘yicha (ajrim bilan qaytarilganlar ham) — faqat ko‘rish va Excel.': 'По результату cabinet.sud.uz (включая возвращённые определением) — только просмотр и Excel.',

  // ── route xabarlari ──
  'Qaytganlar yuklanmadi': 'Не удалось загрузить возвраты',
  'Bu amal uchun «Sudga yuborish» ruxsati kerak.': 'Для этого действия нужно право «Отправка в суд».',
  'hold (true/false) kerak': 'Нужен hold (true/false)',
  'Saqlanmadi — qayta urinib ko‘ring.': 'Не сохранено — попробуйте ещё раз.',
  'firmId kerak (har firma alohida)': 'Нужен firmId (каждая фирма отдельно)',
  'Qayta qoralama partiyasi yaratilmadi.': 'Партия повторных черновиков не создана.',
  'Sabablar olinmadi — keyinroq qayta urinib ko‘ring.': 'Причины не получены — попробуйте позже.',
  'Hozir boshqa sud partiyasi ketmoqda — tugashini kuting.': 'Сейчас идёт другая судебная партия — дождитесь её завершения.',
  'Firma topilmadi yoki nofaol.': 'Фирма не найдена или неактивна.',
  'Firmada STIR yo‘q.': 'У фирмы нет ИНН.',
  'Bu firma to‘xtatilgan (pauza) — avval davom ettiring.': 'Эта фирма на паузе — сначала возобновите.',
  'Qayta qoralamaga tayyor qaytgan ish yo‘q (hujjati to‘liq, ushlab turilmagan, navbatda emas).': 'Нет возвращённых дел, готовых к повторному черновику (с полными документами, не придержанных, не в очереди).',
  'Ishlarga sud biriktirib bo‘lmadi (firma sudlari sozlanmagan).': 'Не удалось назначить суд делам (суды фирмы не настроены).',
  'tasi navbatda — o‘zgartirilmadi.': 'в очереди — не изменены.',
};
