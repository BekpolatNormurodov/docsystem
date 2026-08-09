import React from 'react';
import { dmy, formatSumDecimal, uzLongDateLatin, arizaHeaderDate, type DocContract } from '../core/document';
import { CHAMBER } from '../core/chamber';
import { CHAMBER_EMBLEM_DATA_URL } from './chamber-emblem.data';
import type { CertFirm } from './firm-types';

/**
 * «14.04.2026-yildagi 22548-sonli, …» — the ariza lists contracts inline in Latin. Unlike the
 * maʼlumotnoma, the number is not bold here.
 */
function ArizaContractList({ contracts }: { contracts: DocContract[] }) {
  return (
    <>
      {contracts.map((c, i) => {
        const d = dmy(c.date);
        return (
          <React.Fragment key={`${c.number}-${i}`}>
            {i > 0 && ', '}
            {d ? `${d}-yildagi ${c.number}-sonli` : `${c.number}-sonli`}
          </React.Fragment>
        );
      })}
    </>
  );
}

/**
 * Turns the ariza's variable slots into editors, in place — the same render-prop shape as
 * `CertificateEdit`, so `@spravka/shared/pdf` renders this component under Node without a browser
 * bundle, and a test can hand the same slots to the document and check editing prints what saving
 * freezes.
 */
export interface CourtArizaEdit {
  text: (
    field:
      | 'courtName' | 'personFullName' | 'personAddress' | 'personPhone'
      | 'contractType' | 'interestRate' | 'asOfText'
      | 'chamberSignerPosition' | 'chamberSignerName' | 'chamberExecutorName' | 'chamberExecutorPhone',
  ) => React.ReactNode;
  value: (
    field:
      | 'issueDate' | 'loanAmount'
      | 'debtPrincipal' | 'debtTermInterest' | 'debtOverduePrincipal' | 'debtOverdueInterest' | 'debtTotal',
  ) => React.ReactNode;
  contracts: () => React.ReactNode;
}

export interface CourtArizaDocumentProps {
  number: string;
  issueDate: Date;
  /** Full court addressee, e.g. «Fuqarolik ishlari boʻyicha Uchtepa tumanlararo sudiga». */
  courtName: string;
  personFullName: string;
  /** Printed as «JShShIR: …». Edited in the toolbar (it drives the client lookup), shown here. */
  personPinfl: string;
  personAddress: string;
  personPhone: string;
  contracts: DocContract[];
  contractType: string;
  /** Yearly rate as typed ('54'); printed with a '%'. */
  interestRate: string;
  /** Total credit issued — «jami … soʻm … ajratilgan». */
  loanAmount: string;
  asOfDate: Date;
  asOfText?: string | null;
  debtPrincipal: string;
  debtTermInterest: string;
  debtOverduePrincipal: string;
  debtOverdueInterest: string;
  debtTotal: string;
  chamberSignerPosition: string;
  chamberSignerName: string;
  chamberExecutorName: string;
  chamberExecutorPhone: string;
  /** Printed as the «undiruvchi» (member on whose behalf the chamber collects). Latin letterhead form. */
  firm: CertFirm;
  edit?: CourtArizaEdit;
}

/**
 * 1:1 replica of «Abdiyeva Muazzamxon Muxsin qizi.docx» — a court petition (sud buyrugʻi berish
 * haqida) filed by the Savdo-sanoat palatasi on behalf of a member firm. Latin Uzbek, two A4 pages.
 *
 * Fidelity notes (measured from the .docx):
 *   Times New Roman; body 14pt; letterhead branch/e-mail 14pt, address/tel 13pt; ijrochi 10pt.
 *   body paragraphs justified, first-line indent 1.25cm (708 twips); attachments 1cm (567 twips).
 *   the logo prints 70.9mm × 25.1mm, top-left; the branch block is right-aligned beside it.
 *   source wording kept verbatim, quirks included («bankning moliyaviy xolatiga», «xududiy»).
 */
export function CourtArizaDocument(p: CourtArizaDocumentProps) {
  const { firm, edit } = p;
  // The ariza is Latin, so prefer the firm's Latin ariza name/address; fall back to the letterhead form.
  const firmName = firm.arizaName || firm.letterheadName || firm.name;
  const firmAddress = firm.arizaAddress || firm.address;

  /** A justified body paragraph, first-line indented as the blank has it. */
  const para: React.CSSProperties = {
    fontSize: '14pt', textAlign: 'justify', textIndent: '1.25cm', margin: 0, lineHeight: 1.45,
  };
  /** Parties form-table cells — borderless, label right-aligned/top, value left. */
  const partyLabelTd: React.CSSProperties = {
    width: '40%', padding: '8pt 6pt', textAlign: 'right', verticalAlign: 'top', fontSize: '11pt',
  };
  const partySpacerTd: React.CSSProperties = {
    width: '5%', padding: '8pt 6pt',
  };
  const partyValueTd: React.CSSProperties = {
    padding: '8pt 6pt', verticalAlign: 'top', lineHeight: 1.32,
  };
  /** A money slot: an editor while writing, the grouped-and-comma'd figure otherwise. */
  const money = (field: Parameters<CourtArizaEdit['value']>[0], raw: string) =>
    (edit ? edit.value(field) : formatSumDecimal(raw));

  const collectorRekvizit = [
    firmAddress && `${firmAddress}.`,
    firm.bankAccount && `X/R: ${firm.bankAccount},`,
    firm.mfo && `MFO: ${firm.mfo},`,
    firm.stir && `STIR: ${firm.stir}`,
  ].filter(Boolean).join(' ');

  return (
    <div className="cert-sheet" style={{ fontFamily: '"Times New Roman", Times, serif', color: '#000' }}>
      {/*
        ── Letterhead ──
        The emblem and «Oʻzbekiston Savdo-sanoat palatasi» wordmark are the one part that must stay an
        image (CHAMBER_EMBLEM_DATA_URL, cropped from the blank). The branch name and contacts are HTML
        text from CHAMBER, so «hududiy» is spelled correctly and the blank's English/Russian strip and
        the chamber's own QR — neither wanted here — are simply not drawn. The old approach printed the
        whole letterhead as one flat image, which baked «boshqarmasi» (no «hududiy») into pixels.
      */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10mm', paddingBottom: '4pt' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={CHAMBER_EMBLEM_DATA_URL}
          alt="Oʻzbekiston Savdo-sanoat palatasi"
          style={{ height: '24mm', width: 'auto', display: 'block', flexShrink: 0 }}
        />
        <div style={{ textAlign: 'right', fontSize: '10pt', lineHeight: 1.35 }}>
          <div style={{ fontSize: '13pt', fontWeight: 700, marginBottom: '2pt' }}>{CHAMBER.branchName}</div>
          {CHAMBER.contact.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      </header>

      {/* ── Date / number (left) ── */}
      <div style={{ fontSize: '12pt', lineHeight: 1.4, marginTop: '12pt' }}>
        <div>{edit ? edit.value('issueDate') : arizaHeaderDate(p.issueDate)}</div>
        {/* Register number — a manual fill-in blank on the printed sheet. */}
        <div>{p.number ? `№ ${p.number}` : '№_____________'}</div>
      </div>

      {/*
        ── Parties block ──
        A bordered 3-column form table (label | narrow spacer | party details), matching the blank.
        Mirrors the docx `partyTable`.
      */}
      <table
        style={{
          width: '100%',
          marginTop: '10pt',
          borderCollapse: 'collapse',
          fontSize: '12pt',
          lineHeight: 1.3,
        }}
      >
        <tbody>
          <tr>
            <td style={partyLabelTd} />
            <td style={partySpacerTd} />
            <td style={partyValueTd}>
              <div style={{ fontSize: '14pt', fontWeight: 700, fontStyle: 'italic' }}>{edit ? edit.text('courtName') : p.courtName}</div>
            </td>
          </tr>
          <tr>
            <td style={partyLabelTd}>Arizachi:</td>
            <td style={partySpacerTd} />
            <td style={partyValueTd}>
              <div style={{ fontSize: '14pt', fontWeight: 700, fontStyle: 'italic' }}>{CHAMBER.applicantName}</div>
              {CHAMBER.applicantAddress.map((line, i) => (
                <div key={i} style={{ fontStyle: 'italic' }}>{line}</div>
              ))}
              <div style={{ fontStyle: 'italic' }}>STIR {CHAMBER.applicantStir}.</div>
              <div>&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style={partyLabelTd}>{CHAMBER.collectorLabel.join(' ')}</td>
            <td style={partySpacerTd} />
            <td style={partyValueTd}>
              <div style={{ fontSize: '13pt', fontWeight: 700, fontStyle: 'italic' }}>{firmName}</div>
              {collectorRekvizit && <div style={{ fontStyle: 'italic' }}>{collectorRekvizit}</div>}
              <div>&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style={partyLabelTd}>Qarzdor:</td>
            <td style={partySpacerTd} />
            <td style={partyValueTd}>
              <div style={{ fontSize: '14pt', fontWeight: 700, fontStyle: 'italic' }}>{edit ? edit.text('personFullName') : p.personFullName}</div>
              <div style={{ fontStyle: 'italic' }}>{edit ? edit.text('personAddress') : p.personAddress}</div>
              <div style={{ fontStyle: 'italic' }}>JShShIR: {p.personPinfl}</div>
              <div style={{ fontStyle: 'italic' }}>Tel:&nbsp; {edit ? edit.text('personPhone') : p.personPhone}</div>
              <div>&nbsp;</div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── Title ── */}
      <h1 style={{ fontSize: '14pt', fontWeight: 700, textAlign: 'center', letterSpacing: '0.05em', margin: '16pt 0 0' }}>
        A R I Z A
      </h1>
      <div style={{ fontSize: '12pt', textAlign: 'center', margin: '0 0 10pt' }}>(Sud buyrugʻi berish haqida)</div>

      {/* ── Body ── */}
      <p style={para}>
        Oʻzbekiston Respublikasi «Savdo-sanoat palatasi toʻgʻrisida»gi Qonunning 21-moddasi hamda
        Oʻzbekiston Respublikasi “Davlat boji toʻgʻrisida”gi Qonuni 8-9-moddasida Oʻzbekiston
        Savdo-sanoat palatasi va uning hududiy boshqarmalari-palata aʼzolarining manfaatlarini koʻzlab
        qilingan daʼvolar yuzasidan davlat boji toʻlashdan ozod etilgan.
      </p>
      <p style={para}>Ish hujjatlari oʻrganilganda quyidagilar maʼlum boʻldi:</p>
      <p style={para}>
        <b>{firmName}</b> va fuqaro oʻrtasida{' '}
        {edit ? edit.contracts() : <ArizaContractList contracts={p.contracts} />}{' '}
        “{edit ? edit.text('contractType') : p.contractType}” shartnomalariga asosan, yillik{' '}
        {edit ? edit.text('interestRate') : p.interestRate}% ustama haq toʻlash sharti bilan jami{' '}
        {money('loanAmount', p.loanAmount)} soʻm miqdorida kredit mablagʻi ajratilgan.
      </p>
      <p style={para}>
        Qarzdor tomonidan shartnomaga muvofiq qarzning asosiy qismini va foiz toʻlovlarini grafik asosida
        amalga oshirish majburiyatini oʻz zimmasiga olgan.
      </p>
      <p style={para}>
        Mikro moliya tashkiloti tomonidan qarzdorga muddati oʻtgan qarzdorligi toʻgʻrisida rasmiy
        ogohlantirish xati yuborilgan boʻlishiga qaramasdan hozirgi kunga qadar toʻlovni ixtiyoriy
        ravishda amalga oshirmagan.
      </p>
      <p style={para}>
        Shunga koʻra, qarzdor oʻz majburiyatlarini bajarmasligi natijasida{' '}
        {edit ? edit.text('asOfText') : (p.asOfText || uzLongDateLatin(p.asOfDate))} holatiga koʻra mikro
        moliya tashkiloti oldidagi qarzdorligi quyidagicha:
      </p>
      <p style={{ ...para, margin: '8pt 0' }}>
        Jami qarzdorligi&nbsp;<b>{money('debtTotal', p.debtTotal)} soʻm</b>ni tashkil etadi.
      </p>
      <p style={para}>
        Shuningdek, qarzdor tomonidan yuqorida koʻrsatib oʻtilgan kredit qarzi toʻlovlarini oʻz vaqtida
        amalga oshirilmaganligi sababli, bankning moliyaviy xolatiga jiddiy taʼsir qilmoqda.
      </p>
      <p style={para}>
        Yuqorida keltirilganlariga hamda Oʻzbekiston Respublikasi FKning tegishli moddalari talablariga
        asosan, Sizdan quyidagilarni
      </p>

      <div style={{ fontSize: '14pt', textAlign: 'center', letterSpacing: '0.05em', margin: '8pt 0' }}>
        S Oʻ R A Y M I Z:
      </div>

      <p style={para}>1. Mazkur arizani davlat bojisiz ish yurituvingizga qabul qilishingizni;</p>
      <p style={para}>
        2. Qarzdor <b>{edit ? edit.text('personFullName') : p.personFullName}</b>dan <b>{firmName}</b>{' '}
        foydasiga jami boʻlib <b>{money('debtTotal', p.debtTotal)} soʻm</b> qarzdorlik va pochta
        xarajatlari toʻlovini undirish boʻyicha sud buyrugʻini chiqarishingizni;
      </p>

      {/* ── Attachments (1cm first-line indent) ── */}
      <div style={{ marginTop: '6pt' }} className="ariza-attachments">
        <p style={{ fontSize: '14pt', textIndent: '1cm', margin: 0, lineHeight: 1.4 }}>
          Ilova qilingan hujjatlar roʻyxati:
        </p>
        {CHAMBER.attachments.map((a, i) => (
          <p key={i} style={{ fontSize: '14pt', textIndent: '1cm', margin: 0, lineHeight: 1.4 }}>{i + 1}. {a}</p>
        ))}
      </div>

      {/* ── Signature (position left, name right — leaves room for the wet signature) ── */}
      <div style={{ marginTop: '24pt', breakInside: 'avoid' }}>
        <div
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
            fontSize: '14pt', fontWeight: 700, gap: '8mm',
          }}
        >
          <span>{edit ? edit.text('chamberSignerPosition') : p.chamberSignerPosition}</span>
          <span>{edit ? edit.text('chamberSignerName') : p.chamberSignerName}</span>
        </div>

        {/* ── Ijrochi footer ── */}
        <div
          style={{
            marginTop: '14pt',
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '8mm',
          }}
        >
          <div style={{ fontSize: '10pt', lineHeight: 1.4 }}>
            <div>Ijrochi: {edit ? edit.text('chamberExecutorName') : p.chamberExecutorName}</div>
            <div>Telefon: {edit ? edit.text('chamberExecutorPhone') : p.chamberExecutorPhone}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
