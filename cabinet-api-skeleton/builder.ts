// cabinet-api-skeleton/builder.ts
// docsystem ma'lumotlarini cabinet.sud.uz rasmiy JSON payloadlariga aylantiruvchi adapter.

import { CABINET_CATEGORIES, CABINET_COURT_IDS } from './constants';
import type {
  CreateDraftPayload,
  AddParticipantPayload,
  OrganizationEntityData,
  PersonEntityData,
  SaveSuitPayload,
} from './types';

export interface SourceCaseData {
  courtId?: string; // portal court GUID
  firm: {
    name: string;
    shortName?: string;
    stir: string;
    address: string;
    bankAccount: string;
    mfo?: string;
    phone: string;
    director: string;
  };
  debtor: {
    pinfl: string;
    fullName: string;
    firstName?: string;
    lastName?: string;
    middleName?: string;
    passportSn: string;
    birthDate?: string;
    address: string;
    phone?: string;
  };
  debt: {
    principal: number; // asosiy qarz
    interest: number;  // foiz
    penalty: number;   // penya
    total: number;     // jami qarz
  };
  receiptNumber?: string;
  contractNumber?: string;
  contractDate?: string;
}

export class CabinetPayloadBuilder {
  /**
   * 1-bosqich: Qoralama (Draft) yaratish payload (portal {} qabul qiladi)
   */
  static buildDraft(_courtGuid = CABINET_COURT_IDS.UCHTEPA_CIVIL): CreateDraftPayload {
    return {} as any;
  }

  /**
   * 2-bosqich: Da'vogar (Firma / MMT) ishtirokchisi payload
   */
  static buildClaimant(draftId: string, firm: SourceCaseData['firm']): AddParticipantPayload {
    const orgDetails: OrganizationEntityData = {
      name: firm.name,
      short_name: firm.shortName,
      tin: firm.stir.replace(/\D/g, ''),
      director: firm.director,
      address: firm.address,
      bank_account: firm.bankAccount,
      bank_mfo: firm.mfo,
      phone: firm.phone.replace(/\D/g, ''),
      org_type: 'LOCAL_ORG',
    };

    return {
      draft_id: draftId,
      type: 'CLAIMANT',
      is_main: true,
      entity_type: 'ORGANIZATION',
      entity: {
        tin: Number(orgDetails.tin) || firm.stir,
        pinfl: null,
        not_citizen: false,
      },
      entity_details: orgDetails,
    };
  }

  /**
   * 3-bosqich: Javobgar (Qarzdor) ishtirokchisi payload
   */
  static buildDefendant(draftId: string, debtor: SourceCaseData['debtor']): AddParticipantPayload {
    const parts = (debtor.fullName || '').trim().split(/\s+/);
    const lastName = debtor.lastName || parts[0] || 'QARZDOR';
    const firstName = debtor.firstName || parts[1] || 'SHAXS';
    const middleName = debtor.middleName || parts.slice(2).join(' ') || undefined;

    const passportSnClean = debtor.passportSn.replace(/\s+/g, '').toUpperCase();
    const passportSerial = passportSnClean.slice(0, 2);
    const passportNumber = passportSnClean.slice(2);

    const personDetails: PersonEntityData = {
      pinfl: debtor.pinfl.replace(/\D/g, ''),
      first_name: firstName,
      last_name: lastName,
      middle_name: middleName,
      passport_serial: passportSerial,
      passport_number: passportNumber,
      birth_date: debtor.birthDate,
      address: debtor.address,
      phone: debtor.phone,
      citizenship: 'UZB_CITIZEN',
    };

    return {
      draft_id: draftId,
      type: 'DEFENDANT',
      is_main: true,
      entity_type: 'PERSON',
      entity: {
        pinfl: Number(personDetails.pinfl) || debtor.pinfl,
        tin: null,
        not_citizen: false,
      },
      entity_details: personDetails,
    };
  }

  /**
   * 4-bosqich: Da'voni yakuniy saqlash (Save Suit) payload
   */
  static buildSaveSuit(
    draftId: string,
    courtGuid: string,
    data: SourceCaseData,
    uploadedFileIds: string[],
  ): SaveSuitPayload {
    const debt = data.debt;

    const claimStatement =
      `Qarzdor ${data.debtor.fullName} (JShShIR: ${data.debtor.pinfl}) dan ` +
      `"${data.firm.name}" foydasiga tuzilgan mikroqarz shartnomasi bo'yicha ` +
      `jami ${debt.total.toLocaleString('uz-UZ')} so'm qarzni (asosiy qarz: ${debt.principal.toLocaleString('uz-UZ')}, ` +
      `foiz: ${debt.interest.toLocaleString('uz-UZ')}, penya: ${debt.penalty.toLocaleString('uz-UZ')}) ` +
      `undirish to'g'risida sud buyrug'i chiqarish so'raladi.`;

    return {
      draft_id: draftId,
      court_id: courtGuid,
      category_id: CABINET_CATEGORIES.CIVIL_DECREE_WRITTEN_CONTRACT,
      claim_type: 'CIVIL',
      claim_kind: 'DECREE',
      amount_principal: debt.principal,
      amount_interest: debt.interest,
      amount_penalty: debt.penalty,
      amount_total: debt.total,
      receipt_number: data.receiptNumber,
      uploaded_file_ids: uploadedFileIds,
      claim_statement: claimStatement,
    };
  }
}
