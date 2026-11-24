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

import { resolveCreditor } from './companies';
describe('resolveCreditor — mib.uz masks', () => {
  const ours = (s: string) => resolveCreditor(s).isTarget;
  it('recognises every mask variant of our firms (real prod masks)', () => {
    for (const m of [
      'U**N FI***CE SO***NS MI***YA TA***TI', '"U***AN FI***CE SO***NS MI***YA TA***I" MA***TI CH***AN JA***AT',
      '"B***HT FU***RE FI***NG MI***YA TA***I" MA***TI CH***AN JA***AT MI***Y', 'BR***HT FU***RE FI***NG MI***YA TA***TI',
      '"C***TY MI***CE MI***YA TA***I" MA***TI CH***AN JA***AT MI***YA TA***T', 'CO***TY MI***CE MI***YA TA***TI',
      '"F***OW MI***YA TA***I" MA***TI CH***AN JA***AT MI***YA TA***TI', 'FU***OW MI***YA TA***TI', 'FU***OW MI***YA TA***TI M**J',
      '"Z***Y" MA***TI CH***AN JA***AT MI***YA TA***TI', 'ZA***LY', 'MU***AT MI***YA TA***TI',
    ]) expect(ours(m), m).toBe(true);
    expect(resolveCreditor('U**N FI***CE SO***NS MI***YA TA***TI').name).toMatch(/^URBAN/);
  });
  it('does not claim other creditors (real prod masks)', () => {
    for (const m of [
      '«O***in Yu***uz P**s Mi***ya Ta***i» МЧЖ', '"S***A" MA***TI CH***AN JA***AT MI***YA TA***TI', '"T***N" MA***TI CH***AN JA***AT MI***YA TA***TI',
      '"F***NA BI***ES MI***YA TA***I" MA***TI CH***AN JA***AT', '"V***NT RE***IL FI***E" MA***TI CH***AN JA***AT', 'VA***NT RE***IL FI***CE',
      '"**O SO***ON MI***YA TA***I" MA***TI CH***AN JA***AT', '"**C CR***T" MA***TI CH***AN JA***AT MI***YA TA***TI', '"P***ME SA***A" MA***TI CH***AN JA***AT MI***YA TA***TI',
      '"O***OS FI***E" MA***TI CH***AN JA***AT MI***YA TA***TI', '"K***AT TA***NT MI***YA TA***I" M**J', '"B***OR SA***YA G**P MI***YA TA***I" MA***TI CH***AN JA***AT',
      '"O***NT FI***NS B**" AK***IK JA***TI', '"M***UK FI***CE MI***YA TA***I" MA***TI CH***AN JA***AT', '"B***ES FI***NS MI***YA TA***I" MA***TI CH***AN JA***AT',
      '"P***IT T**D MI***YA TA***I" MA***TI CH***AN JA***AT', '"**T FI***NG SE***CE MI***YA TA***I" MA***TI CH***AN JA***AT', '"M***YA TA***TI OA***T" MA***TI CH***AN JA***AT XO***IY KO***NA MI***Y',
      // noaniq / boshqa: bir so'zli maska yoki boshi yashirin — bizniki DEYILMAYDI
      '"**W M**A KR***T" MA***TI CH***AN JA***AT', 'MU***AT KU***OV SA***CH', '"U***AN AI***S" AK***IK JA***TI', '"M***UK FI***CE MI***YA TA***I" MA***TI CH***AN JA***AT',
      '"A***k" ATB Bu***ro fi***li', 'Da***at', 'Да***ат', '"**R B**" AK***IK JA***TI', '"P***R" MA***TI CH***AN JA***AT QO***MA KO***NA MI***YA TA***TI',
      '"E***OM P**S MI***YA TA***I" MA***TI CH***AN JA***AT', '"H***OH MI***YA TA***I" MA***TI CH***AN JA***AT', '"L***IT RE***IL FI***E" MA***TI CH***AN JA***AT',
    ]) expect(ours(m), m).toBe(false);
  });
});

import { creditorIsOurs, firmKeyWords } from './creditor-match';
describe('creditorIsOurs — deep-pull decision (prod firm short names)', () => {
  const W = ['BRIGHT FUTURE FINANCING', 'URBAN FINANCE SOLUTIONS', 'COMMUNITY MMT', 'MUVAFFAQIYAT MMT', 'FUNDFLOW', 'ZAYMLY', 'DARROWMAD', 'DYNAMIC CREDIT SOLUTIONS MIKROMOLIYA TASHKILOTI', '"PRESTIGE MOLIYA" MCHJ MMT'].map(firmKeyWords);
  it('pulls details for our masks', () => {
    for (const m of ['U**N FI***CE SO***NS MI***YA TA***TI', '"B***HT FU***RE FI***NG MI***YA TA***I" MA***TI', 'CO***TY MI***CE MI***YA TA***TI', '"F***OW MI***YA TA***I" MA***TI', '"Z***Y" MA***TI CH***AN', 'MU***AT MI***YA TA***TI']) expect(creditorIsOurs(m, W), m).toBe(true);
  });
  it('does not spend SMS on hidden-start foreign masks', () => {
    for (const m of ['"**T RE***IL T**E CO***Y" MA***TI CH***AN JA***AT', '"**T EL KA***LI IS***GI "H***K" AK***IK TI***AT B**I', '"**D S**T T**E L**" MA***TI CH***AN JA***AT', '"**W M**A KR***T" MA***TI CH***AN JA***AT', '"**R B**" AK***IK JA***TI', 'Da***at']) expect(creditorIsOurs(m, W), m).toBe(false);
  });
});
