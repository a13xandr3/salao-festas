import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OurServices } from './our-services';

describe('OurServices', () => {
  let component: OurServices;
  let fixture: ComponentFixture<OurServices>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OurServices],
    }).compileComponents();

    fixture = TestBed.createComponent(OurServices);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
  it('lists the four available services with decorative icons', () => {
    const element = fixture.nativeElement as HTMLElement;
    expect(Array.from(element.querySelectorAll('h3'), node => node.textContent?.trim())).toEqual(['Organização de eventos', 'Ambiente Gourmet', 'Internet WIFI', 'Mesas e cadeiras']);
    expect(element.textContent).not.toContain('Estacionamento');
    expect(element.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(4);
  });

});
