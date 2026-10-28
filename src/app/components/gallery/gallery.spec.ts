import { TestBed } from '@angular/core/testing';
import { Gallery as GalleryService } from '../../services/gallery';
import { Gallery } from './gallery';

describe('Gallery', () => {
  function setup() {
    const api = { load: jest.fn().mockResolvedValue({ albums: [{ id: 'album', name: 'Salão', photos: [{ id: 'photo', url: 'images/photo.jpg', description: 'Interior' }] }] }) };
    TestBed.configureTestingModule({ imports: [Gallery], providers: [{ provide: GalleryService, useValue: api }] });
    const fixture = TestBed.createComponent(Gallery); fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, api, element: fixture.nativeElement as HTMLElement };
  }
  it('exibe álbuns e permite entrar nas fotos e voltar', async () => {
    const { fixture, component, element } = setup();
    await component['load'](); fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.album')!.click(); fixture.detectChanges();
    expect(element.querySelector('h3')!.textContent).toContain('Salão');
    expect(element.querySelector('app-photo-viewer img')!.getAttribute('src')).toBe('images/photo.jpg');
    element.querySelector<HTMLButtonElement>('nav button')!.click(); fixture.detectChanges();
    expect(element.querySelector('.album')).not.toBeNull();
  });
  it('mostra erro recuperável sem expor detalhes do servidor', async () => {
    const { fixture, component, api, element } = setup();
    api.load.mockRejectedValue(new Error('private detail'));
    await component['load'](); fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')!.textContent).toContain('Não foi possível');
    expect(element.textContent).not.toContain('private detail');
    api.load.mockResolvedValue({ albums: [] });
    await component['load'](); fixture.detectChanges();
    expect(element.querySelector('[role="status"]')!.textContent).toContain('Em breve');
  });
});
