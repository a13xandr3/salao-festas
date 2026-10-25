/** Testa valores monetários, mensagens públicas e reutilização de chaves de reenvio. */
import { expenseError, financeError, moneyPattern, moneyValue, RequestKey } from './finance-utils';

describe('finance utilities', () => {
  it('normalizes money without introducing binary rounding', () => {
    expect(moneyValue('1.234,56')).toBe('1234.56');
    expect(moneyValue('80,00')).toBe('80.00');
    expect(moneyValue('80.01')).toBe('80.01');
    expect(moneyPattern.test('1.234,56')).toBe(true);
    for (const amount of ['0', '-1', '80.001', 'abc']) expect(moneyPattern.test(amount)).toBe(false);
  });
  it('does not expose raw infrastructure errors', () => {
    for (const code of ['PT400', 'PT404', 'PT409']) expect(financeError({code, message:'Confira os dados'})).toBe('Confira os dados');
    for (const error of [null, undefined, {}, {code:'PT404'}, {code:'42P01', message:'private sql'}, {code:'PT400',message:123}, {code:'PT400',message:''}]) expect(financeError(error)).not.toContain('private sql');
    expect(expenseError({code:'PGRST202'})).toContain('migração');
    for (const code of ['PT403', '42501']) expect(expenseError({code})).toContain('segundo fator');
    expect(expenseError(null)).toBe(financeError(null));
  });
  it('reuses request keys for unchanged retries, replacing them after edits or success', () => {
    const request = new RequestKey();
    const first = request.forPayload({amount:'80', reference:'one'});
    expect(request.forPayload({amount:'80', reference:'one'})).toBe(first);
    const changed = request.forPayload({amount:'90', reference:'one'});
    expect(changed).not.toBe(first);
    request.clear(); expect(request.forPayload({amount:'90', reference:'one'})).not.toBe(changed);
  });
});
