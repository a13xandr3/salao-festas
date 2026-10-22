const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const QRCode = require('qrcode');

const root = resolve(__dirname, '..');
const field = (id, value) => id + String(Buffer.byteLength(value)).padStart(2, '0') + value;
function crc16(value) {
  let crc = 0xffff;
  for (const byte of Buffer.from(value)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++)
      crc = ((crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

(async () => {
  const options = [];
  let firstCode;
  for (let days = 1; days <= 10; days++) {
    const amount = days * 400;
    const body = field('00', '01') +
      field('26', field('00', 'br.gov.bcb.pix') + field('01', '29385898833')) +
      field('52', '0000') + field('53', '986') + field('54', amount.toFixed(2)) +
      field('58', 'BR') + field('59', 'KEILA APARECIDA TEIXEIRA CHAVES ESTEVES'.slice(0, 25)) +
      field('60', 'TEODORO SAMPAIO') + field('62', field('05', '***')) + '6304';
    const code = body + crc16(body);
    firstCode ??= code;
    const image = `images/pix-qr${days === 1 ? '' : '-' + days}.png`;
    await QRCode.toFile(resolve(root, 'public', image), code, { errorCorrectionLevel: 'M', margin: 4, width: 424 });
    options.push(`      <option value="${days}" data-amount="${amount}" data-code="${code}" data-qr="${image}">${days} ${days === 1 ? 'diária' : 'diárias'}</option>`);
  }
  const page = resolve(root, 'public/pix.html');
  const html = readFileSync(page, 'utf8')
    .replace(/<!-- PIX_OPTIONS_START -->[\s\S]*?<!-- PIX_OPTIONS_END -->/,
      `<!-- PIX_OPTIONS_START -->\n${options.join('\n')}\n      <!-- PIX_OPTIONS_END -->`)
    .replace(/(<textarea id="pix-code"[^>]*>)[\s\S]*?(<\/textarea>)/, `$1${firstCode}$2`)
    .replace(/class="pix-qr" src="images\/pix-qr.png" width="\d+" height="\d+"/,
      'class="pix-qr" src="images/pix-qr.png" width="424" height="424"');
  writeFileSync(page, html);
  console.log('Gerados 10 QR Codes Pix: R$ 400,00 a R$ 4.000,00.');
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
