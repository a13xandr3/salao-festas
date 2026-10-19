import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OurServices } from './our-services';

describe('OurServices', () => {
  let component: OurServices;
  let fixture: ComponentFixture<OurServices>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OurServices]
    })
    .compileComponents();

    fixture = TestBed.createComponent(OurServices);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
