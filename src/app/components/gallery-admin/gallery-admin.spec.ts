import { TestBed } from '@angular/core/testing';
import { Gallery } from '../../services/gallery';
import { GalleryAdmin } from './gallery-admin';

describe('GalleryAdmin', () => {
  function setup() {
    const api = { deletePhoto: jest.fn().mockResolvedValue(undefined), load: jest.fn().mockResolvedValue({ albums: [{ id: 'album', name: 'Salão', photos: [] }] }), upload: jest.fn().mockResolvedValue({ count: 1, manifest: { albums: [] } }) };
    TestBed.configureTestingModule({ imports: [GalleryAdmin], providers: [{ provide: Gallery, useValue: api }] });
    const fixture = TestBed.createComponent(GalleryAdmin); fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, api, element: fixture.nativeElement as HTMLElement };
  }
  it('navega até o álbum e bloqueia navegação durante o envio', async () => {
    const { fixture, component, element } = setup();
    await component['load'](); fixture.detectChanges();
    const album = component['albums']()[0]; component['open'](album); fixture.detectChanges();
    expect(element.querySelector('nav')!.textContent).toContain('Salão');
    expect(element.querySelector<HTMLInputElement>('#gallery-album-name')!.readOnly).toBe(true);
    component['uploading'].set(true); component['open'](null);
    expect(component['selected']()).toBe(album);
  });
  it('remove somente a foto excluída e preserva a grade em caso de erro', async () => {
    const { component, api } = setup();
    await component['load']();
    const first = { id: 'one', url: 'data:image/png;base64,a', description: 'Uma' };
    const second = { id: 'two', url: 'data:image/png;base64,b', description: 'Duas' };
    const album = { id: 'album', name: 'Salão', photos: [first, second] };
    component['albums'].set([album]); component['open'](album);
    api.deletePhoto.mockRejectedValueOnce(new Error('Não foi possível excluir.'));
    await component['deletePhoto']('one'); expect(component['selected']()!.photos).toHaveLength(2);
    await component['deletePhoto']('one'); expect(component['selected']()!.photos).toEqual([second]);
    component['uploading'].set(true); await component['deletePhoto']('two'); expect(api.deletePhoto).toHaveBeenCalledTimes(2);
    component['uploading'].set(false); await component['deletePhoto']('two');
    expect(component['selected']()).toBeNull(); expect(component['albums']()).toEqual([]);
    expect(component['notice']()).toContain('Foto excluída');
  });
  it('rejeita formatos e tamanhos inválidos antes de chamar o backend', () => {
    const { component, api } = setup();
    const file = new File(['<svg/>'], 'test.svg', { type: 'image/svg+xml' });
    component['choose']({ target: { files: [file], value: 'test' } } as unknown as Event);
    expect(component['error']()).toContain('JPG, PNG ou WebP');
    expect(component['files']()).toHaveLength(0);
    expect(api.upload).not.toHaveBeenCalled();
  });
  it('envia lote e confirma armazenamento gzip, emitindo o bloqueio de navegação', async () => {
    const { component, api } = setup();
    await component['load']();
    component['form'].controls.name.setValue('Novo álbum');
    component['files'].set([new File(['photo'], 'foto.png', { type: 'image/png' })]);
    const writing = jest.fn(); component.writing.subscribe(writing);
    const input = document.createElement('input');
    await component['submit'](input);
    expect(api.upload).toHaveBeenCalledWith('', 'Novo álbum', expect.any(Array));
    expect(writing.mock.calls).toEqual([[true], [false]]);
    expect(component['notice']()).toContain('salva(s) em gzip no Supabase');
    expect(component['files']()).toHaveLength(0);
  });
});
