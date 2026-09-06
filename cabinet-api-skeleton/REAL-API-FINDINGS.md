# ADOLAT (cabinet.sud.uz) — haqiqiy yuborish oqimi

2026-09-06 da portal frontend bundle'i (`cabinet.sud.uz` Angular chunk
`2959.8f296987efaf1cc5dee9.js`) va jonli `draftList` javoblari asosida aniqlangan.

## Eng muhim xulosa: bizning kodda BUTUN BIR BOSQICH yo'q

Bizning `submitter.ts` shunday ishlaydi:

```
draftCreate → PUT details → fayllarni yuklash → sendToCourt(draftId)
```

Portalning haqiqiy oqimi esa:

```
draftCreate → PUT details (wizard holati) → fayllarni yuklash
           → POST /api/cabinet/case/civil/save-suit   ← BIZDA YO'Q
           → sendToCourt(caseId)                      ← draftId EMAS, save-suit qaytargan id
```

`pub-user-draft-cases` — bu shunchaki **wizard qoralamasi** (foydalanuvchi to'ldirayotgan
forma holati). Undan sud ishi avtomatik yaralmaydi. Haqiqiy ish `save-suit` bilan yaraladi:
wizard `details`ni butunlay boshqa shakldagi payloadga **aylantirib** yuboradi.

Shu sababli hozirgi kod bilan yuborilgan da'vo:
- hujjatsiz bo'lardi (`case_documents` hech qachon yuborilmaydi), va
- umuman ish yaralmagani uchun `sendToCourt(draftId)` kutilgan natija bermasdi.

## save-suit payload (`formToCaseCreate`, CIVIL SUIT)

```js
{
  case: {
    doc_date:       new Date(baseInfo.registry_dt),
    doc_number:     baseInfo.case_number,
    court_id:       createApplication.court,
    duty_reason_id: courtCosts.duty_reason_id || null,
  },
  claim_categories: baseInfo.claim_categories,
  receipts:         courtCosts.receipts || [],
  case_documents:   P0(fileUpload),              // pastga qarang
  case_participants: [
    { entity: { id: createApplication.claimant },
      participant: { type: 'CLAIMANT', is_main: true, is_appellant: false },
      entity_details: { is_small_business: !!createApplication.small_business,
                        ...createApplication.claimant_details } },
    // + javobgarlar getParticipant(x, 'DEFENDANT') orqali qo'shiladi
  ],
  claim_amounts_with_parts: /* baseInfo dagi summalar, string'ga aylantirilgan */,
  claim:        { claim_kind: courtInfo.claim_kind },     // DECREE
  case_details: { state_duty_amount: +courtCosts.customStateFee || +courtCosts.stateFee },
}
```

**Diqqat:** `courtCosts` MAJBURIY — `case_details.state_duty_amount` o'shandan o'qiladi.
Bizning kod uni `null` qoldiradi, ya'ni bu yerda yiqiladi.

## `details.fileUpload` shakli (wizard forma guruhidan)

```js
{
  claimApplication: { file_id, mime_type, size, name, type_id, label },  // MAJBURIY
  lawyer_order:     { file_id, mime_type, size, name, type_id, label },  // ixtiyoriy
  category_files:   [{ category_id, label, mime_type, size, name, file_id, type_id }],
  additional_files: [{ ... }],
}
```

`file_id` — `POST /api/cabinet/case/file/upload` qaytargan id.
`P0(fileUpload)` shu tuzilmani `case_documents` ro'yxatiga yassilaydi (aniq mantiqи hali
o'qilmagan — u boshqa, umumiy chunk'da).

## `details` ning 11 bo'limi

`baseInfo, courtInfo, caseSelect, courtCosts, fileUpload, defendantInfo, selectDocuments,
materialBaseInfo, createApplication, administrativeBaseInfo, materialCreateApplication`

- `courtInfo` — `{instance:'FIRST', claim_kind:'DECREE', claim_type:'CIVIL',
  claimant_entity_type:'ORGANIZATION'}` (qo'shildi)
- `selectDocuments` — apellyatsiya uchun, bizga kerak emas
- Bizning kod avval faqat 6 tasini bilardi

## Qolgan aniqlanmaganlar

1. `P0` ning aniq yassilash mantiqi (umumiy chunk'da)
2. `courtCosts` to'liq shakli — `duty_reason_id`, `receipts[]`, `stateFee`/`customStateFee`
3. Javobgarning `getParticipant(...,'DEFENDANT')` orqali to'liq shakli
4. `save-suit` javobidagi id maydoni nomi (sendToCourt shuni oladi)

Bularni aniqlashning eng ishonchli yo'li — ADOLAT UI'sida bitta arizani hujjatlari bilan
oxirigacha to'ldirib, tarmoq so'rovlarini kuzatish (bitta real yuborish).
