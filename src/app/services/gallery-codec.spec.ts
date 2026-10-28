/** @jest-environment node */
import { File as NodeFile } from 'node:buffer';
import { gzipSync, gunzipSync } from 'node:zlib';
import { compressPhoto, decompressPhoto } from './gallery-codec';

const image = Buffer.from([137,80,78,71,13,10,26,10,0,1,2,3]);
const file = (bytes: Buffer, mime = 'image/png') => new NodeFile([bytes], 'foto.png', { type: mime }) as unknown as File;

describe('Gallery gzip', () => {
  it('compacta a imagem real em gzip e descompacta sem alterar os bytes', async () => {
    const hex = await compressPhoto(file(image));
    expect(hex.startsWith('1f8b08')).toBe(true);
    expect(gunzipSync(Buffer.from(hex, 'hex'))).toEqual(image);
    const url = await decompressPhoto('\\x' + hex, 'image/png', image.length);
    expect(url).toBe('data:image/png;base64,' + image.toString('base64'));
  });
  it('rejeita MIME inválido, conteúdo falso, gzip corrompido e expansão excessiva', async () => {
    await expect(compressPhoto(file(image, 'image/svg+xml'))).rejects.toThrow();
    await expect(compressPhoto(file(Buffer.from('fake')))).rejects.toThrow();
    await expect(decompressPhoto('\\x' + '00'.repeat(20), 'image/png', 12)).rejects.toThrow();
    await expect(decompressPhoto('\\x' + gzipSync(image).toString('hex'), 'image/png', 1)).rejects.toThrow('excede');
    await expect(decompressPhoto('\\x' + gzipSync(image).toString('hex'), 'image/png', 5242881)).rejects.toThrow();
    await expect(decompressPhoto('\\x' + gzipSync(image).toString('hex'), 'image/png', image.length + 1)).rejects.toThrow('incompleta');
  });
});
