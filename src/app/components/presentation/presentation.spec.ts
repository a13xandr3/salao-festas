import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Presentation } from './presentation';

describe('Presentation', () => {
  let component: Presentation;
  let fixture: ComponentFixture<Presentation>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Presentation],
    }).compileComponents();

    fixture = TestBed.createComponent(Presentation);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
  it('introduces the venue location and links to spaces and availability', () => {
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('h1')).toHaveLength(1);
    expect(element.textContent).toContain('salão de festas em Teodoro Sampaio');
    expect(Array.from(element.querySelectorAll('a'), link => link.getAttribute('href'))).toEqual(['#espacos', '#agenda']);
    const image = element.querySelector('img')!;
    expect(image.alt).toContain('Piscina e área gourmet');
    expect(image.getAttribute('fetchpriority')).toBe('high');
  });

});
