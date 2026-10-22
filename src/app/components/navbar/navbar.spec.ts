import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Navbar } from './navbar';

describe('Navbar', () => {
  let component: Navbar;
  let fixture: ComponentFixture<Navbar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Navbar],
    }).compileComponents();

    fixture = TestBed.createComponent(Navbar);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
    const restricted = fixture.nativeElement.querySelector('a[href="?area=restrita"]');
    expect(restricted.textContent).toContain('Área restrita');
    expect(restricted.getAttribute('target')).toBe('_blank');
    expect(restricted.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('toggles the menu, closes on navigation and returns focus on Escape', () => {
    const element = fixture.nativeElement as HTMLElement;
    const toggle = element.querySelector<HTMLButtonElement>('.navbar-toggler')!;
    const menu = element.querySelector<HTMLElement>('#primary-navigation')!;
    const link = menu.querySelector<HTMLAnchorElement>('a')!;
    link.addEventListener('click', (event) => event.preventDefault());

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(menu.classList.contains('show')).toBe(true);

    link.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(menu.classList.contains('show')).toBe(false);

    toggle.click();
    fixture.detectChanges();
    link.focus();
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });
  it('closes the expanded menu for every destination including the brand', () => {
    const element = fixture.nativeElement as HTMLElement;
    const toggle = element.querySelector<HTMLButtonElement>('.navbar-toggler')!;
    expect(toggle.getAttribute('aria-controls')).toBe('primary-navigation');
    for (const link of Array.from(element.querySelectorAll<HTMLAnchorElement>('a'))) {
      link.addEventListener('click', event => event.preventDefault());
      toggle.click(); fixture.detectChanges();
      expect(toggle.getAttribute('aria-label')).toBe('Fechar menu de navegação');
      link.click(); fixture.detectChanges();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.getAttribute('aria-label')).toBe('Abrir menu de navegação');
    }
  });

});
