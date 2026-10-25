/** Confere a renderização dos ambientes apresentados no site. */
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TopSpaces } from './top-spaces';

describe('TopSpaces', () => {
  let component: TopSpaces;
  let fixture: ComponentFixture<TopSpaces>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TopSpaces],
    }).compileComponents();

    fixture = TestBed.createComponent(TopSpaces);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
  it('presents three distinct spaces with accessible lazy-loaded images', () => {
    const element = fixture.nativeElement as HTMLElement;
    const articles = Array.from(element.querySelectorAll('article'));
    expect(articles).toHaveLength(3);
    expect(articles.map(article => article.querySelector('h3')!.textContent?.trim())).toEqual(['Piscina para aproveitar', 'Sabores que reúnem', 'Encontros com charme']);
    for (const article of articles) {
      const image = article.querySelector('img')!;
      expect(image.alt.trim()).not.toBe('');
      expect(image.getAttribute('loading')).toBe('lazy');
      expect(article.querySelector('p')!.textContent!.trim().length).toBeGreaterThan(0);
    }
  });

});
