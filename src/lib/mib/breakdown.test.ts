import { describe, it, expect } from 'vitest';
import { decodeEntities, isPersonName, bestFio } from './breakdown';

describe('mib name helpers', () => {
  it('decodes HTML entities left by mib.uz', () => {
    expect(decodeEntities('BOZOROV JAMSHID FAZLIDDIN O&#039;G&#039;LI')).toBe("BOZOROV JAMSHID FAZLIDDIN O'G'LI");
    expect(decodeEntities('&quot;BRIGHT&quot; &amp; Co &#x41;')).toBe('"BRIGHT" & Co A');
    expect(decodeEntities('A &unknown; B')).toBe('A &unknown; B');
  });
  it('rejects amounts, masks and placeholders as names', () => {
    expect(isPersonName('21 630.00')).toBe(false);
    expect(isPersonName('34 663 039.95')).toBe(false);
    expect(isPersonName('AB***OV I**M')).toBe(false);
    expect(isPersonName('Nomaʼlum')).toBe(false);
    expect(isPersonName(null)).toBe(false);
    expect(isPersonName('ҚЎЗИЕВ БАХТИЁР ОЛИМБАЕВИЧ')).toBe(true);
  });
  it('picks full MIB name, then portfolio name, then masked name — never an amount', () => {
    const cases = [{ personFullName: '21 630.00' }, { personFullName: 'NAZAROV ELYORBEK AKBARALIYEVICH' }];
    expect(bestFio({ fio: 'X Y Z', fio2: 'NA***OV', cases })).toBe('NAZAROV ELYORBEK AKBARALIYEVICH');
    expect(bestFio({ fio: 'ABDIYEV UKTAM', fio2: 'U**M AB***EV', cases: [{ personFullName: '21 630.00' }] })).toBe('ABDIYEV UKTAM');
    expect(bestFio({ fio: null, fio2: 'BU***OD O&#039;***LI', cases: [] })).toBe("BU***OD O'***LI");
    expect(bestFio({ fio: null, fio2: null, cases: [{ personFullName: '5 608 092.00' }] })).toBe('');
  });
});

import { parseSimSlot } from './config';
describe('parseSimSlot', () => {
  it('reads the phone SIM slot from forwarder text', () => {
    expect(parseSimSlot('{"subject":"У вас новое SMS на номер SIM 2","message":"Kod:12345"}')).toBe(2);
    expect(parseSimSlot('SIM1 incoming')).toBe(1);
    expect(parseSimSlot('sim slot 2')).toBe(2);
    expect(parseSimSlot('Kod:12345 mib.uz')).toBeNull();
    expect(parseSimSlot(null)).toBeNull();
  });
});
