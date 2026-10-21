import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { PNG } = require('pngjs');
const decodeQr = require('jsqr');
const page = readFileSync(resolve(process.cwd(), 'public/pix.html'), 'utf8');
const script = page.match(/<script>([\s\S]*?)<\/script>/)![1];

function fields(payload: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (let offset = 0; offset < payload.length;) {
    const id = payload.slice(offset, offset + 2);
    const length = Number(payload.slice(offset + 2, offset + 4));
    result[id] = payload.slice(offset + 4, offset + 4 + length);
    offset += 4 + length;
  }
  return result;
}

// Independent polynomial division checks the BR Code checksum, including the 6304 marker.
function checksum(payload: string): string {
  let register = 0xffff;
  for (const character of payload) {
    register ^= character.charCodeAt(0) << 8;
    for (let bit = 0; bit < 8; bit++) {
      register *= 2;
      if (register > 0xffff) register ^= 0x11021;
    }
  }
  return register.toString(16).toUpperCase().padStart(4, '0');
}

describe('Pix payment page', () => {
  let originalBody: string;
  let clipboard: PropertyDescriptor | undefined;
  const writeText = jest.fn(() => Promise.resolve());
  beforeEach(() => {
    originalBody = document.body.innerHTML;
    clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    writeText.mockReset().mockResolvedValue(undefined);
    document.body.innerHTML = page.match(/<body>([\s\S]*?)<\/body>/)![1];
    new Function(script)();
  });
  afterEach(() => {
    document.body.innerHTML = originalBody;
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  });
  function selectDays(days: number) {
    const select = document.querySelector<HTMLSelectElement>('#pix-days')!;
    select.value = String(days);
    select.dispatchEvent(new Event('change'));
    return select.selectedOptions[0];
  }
  it('offers exactly one through ten daily stays and defaults to R$ 400.00', () => {
    const select = document.querySelector<HTMLSelectElement>('#pix-days')!;
    expect(Array.from(select.options, option => Number(option.value))).toEqual([1,2,3,4,5,6,7,8,9,10]);
    expect(select.disabled).toBe(false);
    expect(document.querySelector('#pix-total')!.textContent).toMatch(/400,00/);
  });
  it.each(Array.from({ length: 10 }, (_, index) => index + 1))('updates and decodes the QR Code for %s days', (days) => {
    const option = selectDays(days);
    const code = document.querySelector<HTMLInputElement>('#pix-code')!.value;
    const image = document.querySelector<HTMLImageElement>('.pix-qr')!;
    expect(image.getAttribute('src')).toBe(option.dataset['qr']);
    expect(image.hidden).toBe(true);
    image.dispatchEvent(new Event('load'));
    expect(image.hidden).toBe(false);
    const png = PNG.sync.read(readFileSync(resolve(process.cwd(), 'public', option.dataset['qr']!)));
    const decoded = decodeQr(new Uint8ClampedArray(png.data), png.width, png.height);
    expect(decoded.data).toBe(code);
    const data = fields(decoded.data);
    expect(data['54']).toBe((days * 400).toFixed(2));
    expect(fields(data['26'])['01']).toBe('29385898833');
    expect(data['53']).toBe('986');
    expect(data['59']).toBe('KEILA APARECIDA TEIXEIRA CHAVES ESTEVES'.slice(0, 25));
    expect(data['63']).toBe(checksum(code.slice(0, -4)));
    expect(Number(option.dataset['amount'])).toBe(days * 400);
  });
  it('copies the selected total as a Pix payload and keeps key-only copying available', async () => {
    selectDays(10);
    document.querySelector<HTMLButtonElement>('#copy-code')!.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenLastCalledWith(document.querySelector<HTMLInputElement>('#pix-code')!.value);
    expect(document.querySelector('#copy-status')!.textContent).toContain('com o valor');
    document.querySelector<HTMLButtonElement>('#copy-key')!.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenLastCalledWith('29385898833');
    expect(document.querySelector('#copy-status')!.textContent).toContain('manualmente');
  });
  it('selects the full Pix payload for manual copying if clipboard access is denied', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    selectDays(3);
    document.querySelector<HTMLButtonElement>('#copy-code')!.click();
    await Promise.resolve();
    const input = document.querySelector<HTMLInputElement>('#pix-code')!;
    expect(document.activeElement).toBe(input);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(document.querySelector('#copy-status')!.textContent).toContain('copiar manualmente');
  });
  it('keeps a failed image hidden and offers the equivalent payment code', () => {
    const image = document.querySelector<HTMLImageElement>('.pix-qr')!;
    image.dispatchEvent(new Event('error'));
    expect(image.hidden).toBe(true);
    expect(document.querySelector('#copy-status')!.textContent).toContain('Copiar Pix com o valor');
    selectDays(2);
    expect(document.querySelector('#copy-status')!.textContent).toBe('');
  });
});
