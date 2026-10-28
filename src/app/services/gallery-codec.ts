const MAX_IMAGE = 5 * 1024 * 1024;
const types = ['image/jpeg', 'image/png', 'image/webp'];

function checkImage(bytes: Uint8Array, mime: string): void {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  const valid = mime === 'image/jpeg' ? starts(255, 216, 255)
    : mime === 'image/png' ? starts(137, 80, 78, 71, 13, 10, 26, 10)
    : mime === 'image/webp' && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (!valid) throw new Error('Imagem inválida. Use JPG, PNG ou WebP.');
}

export async function compressPhoto(file: File): Promise<string> {
  if (!types.includes(file.type) || !file.size || file.size > MAX_IMAGE) throw new Error('Selecione uma imagem de até 5 MB.');
  if (typeof CompressionStream === 'undefined') throw new Error('Seu navegador não suporta gzip. Atualize-o para enviar fotos.');
  checkImage(new Uint8Array(await file.slice(0, 12).arrayBuffer()), file.type);
  const compressed = await new Response(file.stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const bytes = new Uint8Array(compressed);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    hex += Array.from(bytes.subarray(i, i + 8192), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return hex;
}

export async function decompressPhoto(hex: string, mime: string, size: number): Promise<string> {
  if (typeof DecompressionStream === 'undefined') throw new Error('Seu navegador não suporta gzip. Atualize-o para visualizar as fotos.');
  if (!types.includes(mime) || !Number.isInteger(size) || size < 1 || size > MAX_IMAGE || hex.length < 38 || hex.length > 10600002 || hex.length % 2 !== 0 || !/^\\x[a-f0-9]+$/i.test(hex)) throw new Error('Registro de imagem inválido.');
  const bytes = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > size) throw new Error('Imagem descompactada excede o tamanho informado.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  if (length !== size) throw new Error('Imagem incompleta.');
  const image = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { image.set(chunk, offset); offset += chunk.length; }
  checkImage(image, mime);
  let binary = '';
  for (let i = 0; i < image.length; i += 8192) binary += String.fromCharCode(...image.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
