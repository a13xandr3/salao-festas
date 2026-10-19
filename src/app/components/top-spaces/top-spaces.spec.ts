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
});
