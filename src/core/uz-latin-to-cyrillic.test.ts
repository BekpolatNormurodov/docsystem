import { describe, it, expect } from 'vitest';
import { latinToCyrillic as t } from './uz-latin-to-cyrillic';

describe('latinToCyrillic', () => {
  it('handles the verified BRIGHT-style samples', () => {
    expect(t('RAVSHANOV SHAHBOZ SHUXRATOVICH')).toBe('РАВШАНОВ ШАҲБОЗ ШУХРАТОВИЧ');
    expect(t("O'RINBAYEV O'G'LI")).toBe('ЎРИНБАЕВ ЎҒЛИ');
  });

  it("does not let the 'yo' digraph swallow the o of a yo' sequence", () => {
    // regression: "YO'LDOSHEV" must be ЙЎЛДОШЕВ (Й+Ў), not ЁЛДОШЕВ.
    expect(t("YO'LDOSHEV")).toBe('ЙЎЛДОШЕВ');
    expect(t("Yo'ldoshev")).toBe('Йўлдошев');
    expect(t("yo'q")).toBe('йўқ');
  });

  it("keeps 'yo' as ё when there is no apostrophe", () => {
    expect(t('YODGOROV')).toBe('ЁДГОРОВ');
    expect(t('yozgi')).toBe('ёзги');
  });

  it('tolerates empty / null-ish input', () => {
    expect(t('')).toBe('');
    expect(t(undefined as unknown as string)).toBe('');
  });
});
