import { ComponentFixture, TestBed } from '@angular/core/testing';

import { version } from '../../../../package.json';
import { Footer } from './footer';

describe('Footer', () => {
  let component: Footer;
  let fixture: ComponentFixture<Footer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Footer],
    }).compileComponents();

    fixture = TestBed.createComponent(Footer);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
  it('shows the current copyright year and the site navigation anchors', () => {
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.footer-bottom')!.textContent).toContain(String(new Date().getFullYear()));
    expect(Array.from(element.querySelectorAll('nav a'), a => a.getAttribute('href'))).toEqual(['#espacos', '#celebracoes', '#servicos', '#contato', '#agenda']);
    expect(element.querySelector('.footer-brand')!.getAttribute('href')).toBe('#inicio');
  });

  it('renders the version from package.json in the copyright footer', () => {
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.footer-bottom small')!.textContent).toContain(`v.${version}`);
  });

});
