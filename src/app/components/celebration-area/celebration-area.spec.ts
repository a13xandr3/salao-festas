/** Confere a renderização e o conteúdo da seção de celebrações. */
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CelebrationArea } from './celebration-area';

describe('CelebrationArea', () => {
  let component: CelebrationArea;
  let fixture: ComponentFixture<CelebrationArea>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CelebrationArea],
    }).compileComponents();

    fixture = TestBed.createComponent(CelebrationArea);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
  it('describes the celebration space with an accessible image and heading', () => {
    const element = fixture.nativeElement as HTMLElement;
    const section = element.querySelector('section')!;
    expect(element.querySelector('#' + section.getAttribute('aria-labelledby'))?.textContent).toContain('Memórias que ficam');
    const image = element.querySelector('img')!;
    expect(image.alt).toContain('Casal celebrando');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(element.textContent).toContain('casamentos, aniversários, encontros corporativos');
  });

});
