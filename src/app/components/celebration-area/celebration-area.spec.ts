import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CelebrationArea } from './celebration-area';

describe('CelebrationArea', () => {
  let component: CelebrationArea;
  let fixture: ComponentFixture<CelebrationArea>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CelebrationArea]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CelebrationArea);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
