import { describe, it, expect } from 'vitest';
import { buildArizaDocx } from './ariza-docx';
import type { CourtArizaDocumentProps } from '@/ui/CourtArizaDocument';

const sampleProps: CourtArizaDocumentProps = {
  number: '',
  issueDate: new Date('2026-07-09'),
  courtName: 'Test sudi',
  personFullName: 'TEST AAA',
  personPinfl: '123',
  personAddress: 'Addr',
  personPhone: '998',
  contracts: [{ number: '2244', date: new Date('2026-05-12') }],
  contractType: 'ONLAYN',
  interestRate: '54',
  loanAmount: '1000000',
  asOfDate: new Date('2026-07-09'),
  debtPrincipal: '1',
  debtTermInterest: '2',
  debtOverduePrincipal: '3',
  debtOverdueInterest: '4',
  debtTotal: '10',
  chamberSignerPosition: 'X',
  chamberSignerName: 'Y',
  chamberExecutorName: 'Z',
  chamberExecutorPhone: '1',
  firm: { name: 'BRIGHT FUTURE FINANCING' },
};

describe('buildArizaDocx', () => {
  it('produces a real .docx (zip) buffer', async () => {
    const buffer = await buildArizaDocx(sampleProps);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(5000);
    // ZIP magic bytes "PK\x03\x04" — a .docx is a zip archive.
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
    expect(buffer[2]).toBe(0x03);
    expect(buffer[3]).toBe(0x04);
  });
});
