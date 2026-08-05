// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { CourtArizaDocument } from './index';
import { formatSumDecimal } from '../core/document';

describe('ui copy', () => {
  it('formats sums like spravka', () => {
    expect(formatSumDecimal('11665392.28')).toContain('11');
  });
  it('renders the ariza with no QR', () => {
    const html = renderToStaticMarkup(
      <CourtArizaDocument
        number="" issueDate={new Date('2026-07-09')} courtName="Test sudi"
        personFullName="TEST AAA" personPinfl="123" personAddress="Addr" personPhone="998"
        contracts={[{ number: '2244', date: new Date('2026-05-12') }]}
        contractType="ONLAYN" interestRate="54" loanAmount="1000000"
        asOfDate={new Date('2026-07-09')} debtPrincipal="1" debtTermInterest="2"
        debtOverduePrincipal="3" debtOverdueInterest="4" debtTotal="10"
        chamberSignerPosition="X" chamberSignerName="Y" chamberExecutorName="Z"
        chamberExecutorPhone="1" firm={{ name: 'BRIGHT FUTURE FINANCING' }} />,
    );
    expect(html).toContain('A R I Z A');
    // Bare 'QR' collides with the base64 CHAMBER_EMBLEM_DATA_URL image bytes (unrelated to the QR
    // feature); check the actual QR footer label instead, same as spravka's own court-ariza.test.ts.
    expect(html).not.toContain('QR кодни сканерланг');
  });
});
