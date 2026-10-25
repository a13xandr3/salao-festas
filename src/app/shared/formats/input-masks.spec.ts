import { maskMoney, maskPhone } from './input-masks';

function input(value: string, caret = value.length): HTMLInputElement {
  const element = document.createElement('input');
  element.value = value;
  element.setSelectionRange(caret, caret);
  return element;
}

describe('shared input masks', () => {
  it.each([
    ['', ''], ['1', '(1'], ['18', '(18)'], ['1899', '(18) 99'],
    ['18996555494', '(18) 99655-5494'], ['1833334444', '(18) 3333-4444'],
    ['+55 (18) 99655-5494', '(55) 18996-5554'],
  ])('formats phone %s without changing the stored display format', (value, expected) => {
    const element = input(value);
    expect(maskPhone(element)).toBe(expected);
    expect(element.value).toBe(expected);
  });
  it('keeps the phone caret at the edited digit and handles unavailable selections', () => {
    const element = input('18996555494', 4);
    maskPhone(element); expect(element.selectionStart).toBe(7);
    jest.spyOn(element, 'selectionStart', 'get').mockReturnValue(null);
    expect(maskPhone(element)).toBe('(18) 99655-5494');
  });
  it.each([['', ''], ['abc', ''], ['0', '0,00'], ['1', '0,01'], ['123456', '1.234,56']])('formats money %s as cents', (value, expected) => {
    expect(maskMoney(input(value))).toBe(expected);
  });
  it('preserves editing positions across punctuation and stripped zeros', () => {
    const middle = input('1234', 2); maskMoney(middle);
    expect(middle.value).toBe('12,34'); expect(middle.selectionStart).toBe(3);
    const zeros = input('0000', 0); maskMoney(zeros); expect(zeros.selectionStart).toBe(0);
    const unavailable = input('1234'); jest.spyOn(unavailable, 'selectionStart', 'get').mockReturnValue(null);
    expect(maskMoney(unavailable)).toBe('12,34');
  });
});
