import { TestBed } from '@angular/core/testing';
import { PhotoViewer } from './photo-viewer';

describe('PhotoViewer', () => {
  it('amplia a primeira foto, navega circularmente e restaura foco ao fechar', () => {
    const fixture = TestBed.createComponent(PhotoViewer);
    fixture.componentRef.setInput('photos', [
      { id: '1', url: '/images/one.jpg', description: 'Salão' },
      { id: '2', url: '/images/two.jpg', description: 'Jardim' },
    ]);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const dialog = element.querySelector('dialog')!;
    dialog.showModal = jest.fn();
    dialog.close = jest.fn(() => dialog.dispatchEvent(new Event('close')));
    const thumbnail = element.querySelector<HTMLButtonElement>('.photo-thumbnail')!;
    const focus = jest.spyOn(thumbnail, 'focus');
    thumbnail.click(); fixture.detectChanges();
    expect(dialog.showModal).toHaveBeenCalled();
    expect(dialog.querySelector('figcaption')!.textContent).toContain('Salão · 1 / 2');
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    fixture.detectChanges();
    expect(dialog.querySelector('figcaption')!.textContent).toContain('Jardim · 2 / 2');
    dialog.querySelector<HTMLButtonElement>('[aria-label="Próxima foto"]')!.click();
    fixture.detectChanges();
    expect(dialog.querySelector('figcaption')!.textContent).toContain('Salão · 1 / 2');
    dialog.querySelector<HTMLButtonElement>('[aria-label="Fechar visualização"]')!.click();
    fixture.detectChanges();
    expect(focus).toHaveBeenCalled();
    expect(dialog.querySelector('figure')).toBeNull();
  });
  it('mostra X somente no modo administrativo e exclui sem abrir o visualizador', () => {
    const fixture = TestBed.createComponent(PhotoViewer);
    const photo = { id: 'photo', url: '/images/photo.png', description: 'Salão' };
    fixture.componentRef.setInput('photos', [photo]); fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.photo-remove')).toBeNull();
    fixture.componentRef.setInput('removable', true); fixture.detectChanges();
    const remove = jest.fn(); fixture.componentInstance.remove.subscribe(remove);
    const button = element.querySelector<HTMLButtonElement>('.photo-remove')!;
    button.click(); expect(remove).toHaveBeenCalledWith(photo);
    expect(fixture.componentInstance['selected']()).toBeNull();
    fixture.componentRef.setInput('disabled', true); fixture.detectChanges();
    expect(button.disabled).toBe(true); button.click(); expect(remove).toHaveBeenCalledTimes(1);
  });
  it('apresenta estado vazio e não cria botões de fotos', () => {
    const fixture = TestBed.createComponent(PhotoViewer);
    fixture.componentRef.setInput('photos', []);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('[role="status"]')!.textContent).toContain('Nenhuma foto');
    expect(element.querySelector('.photo-thumbnail')).toBeNull();
  });
});
