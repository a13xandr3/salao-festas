import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminAuth } from './admin-auth';
import { Gallery, GalleryManifest } from './gallery';
import { provideTestConfig, testSupabaseUrl } from '../testing/supabase';
import { compressPhoto, decompressPhoto } from './gallery-codec';
jest.mock('./gallery-codec', () => ({ compressPhoto: jest.fn(), decompressPhoto: jest.fn() }));

describe('Gallery service', () => {
  function setup() {
    const rpc = jest.fn().mockResolvedValue({ data: 1, error: null });
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideTestConfig(), {
      provide: AdminAuth, useValue: { runAuthorized: (operation: (client: { rpc: typeof rpc }) => unknown) => operation({ rpc }) },
    }] });
    return { api: TestBed.inject(Gallery), http: TestBed.inject(HttpTestingController), rpc };
  }
  afterEach(() => { TestBed.inject(HttpTestingController).verify(); jest.clearAllMocks(); });
  it('lê registros públicos, descompacta o gzip e agrupa por álbum', async () => {
    const { api, http } = setup();
    jest.mocked(decompressPhoto).mockResolvedValue('data:image/png;base64,photo');
    let manifest: GalleryManifest | undefined;
    const pending = api.load().then(value => manifest = value); await Promise.resolve();
    const request = http.expectOne(req => req.url === `${testSupabaseUrl}/rest/v1/gallery_images` && req.params.get('offset') === '0');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush([{ id: 'photo', album_id: 'album', album_name: 'Salão', path: 'images/photo.png', mime_type: 'image/png', original_size: 12, gzip_data: '\\x1f8b08', description: 'Interior' }]);
    await new Promise(resolve => setTimeout(resolve, 0));
    http.expectOne(req => req.params.get('offset') === '1').flush([]); await pending;
    expect(decompressPhoto).toHaveBeenCalledWith('\\x1f8b08', 'image/png', 12);
    expect(manifest?.albums[0].photos[0].url).toBe('data:image/png;base64,photo');
  });
  it('exclui pela RPC autorizada e rejeita respostas sem confirmação', async () => {
    const { api, rpc } = setup();
    rpc.mockResolvedValue({ data: true, error: null });
    await api.deletePhoto('photo-id');
    expect(rpc).toHaveBeenCalledWith('booking_gallery_delete', { p_id: 'photo-id' });
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(api.deletePhoto('photo-id')).rejects.toThrow('Não foi possível excluir');
  });
  it('envia o conteúdo gzip na RPC autorizada, sem upload local ou Storage', async () => {
    const { api, rpc } = setup();
    jest.mocked(compressPhoto).mockResolvedValue('1f8b08');
    const result = await api.upload('', 'Salão', [new File(['photo'], 'foto.png', { type: 'image/png' })]);
    expect(result.count).toBe(1);
    expect(rpc).toHaveBeenCalledWith('booking_gallery_upload', { p_album: null, p_name: 'Salão', p_photos: [{ description: 'foto', mime_type: 'image/png', original_size: 5, gzip_hex: '1f8b08' }] });
    rpc.mockResolvedValue({ data: null, error: { message: 'private detail' } });
    await expect(api.upload('', 'Salão', [new File(['photo'], 'foto.png', { type: 'image/png' })])).rejects.toThrow('Não foi possível salvar');
  });
});
