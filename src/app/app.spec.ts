import { provideTestConfig, rpcUrl } from './testing/supabase';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTestConfig(),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    for (const request of TestBed.inject(HttpTestingController).match(
      (req) => req.url === rpcUrl('booking_availability'),
    )) {
      request.flush({}, { status: 503, statusText: 'Unavailable' });
    }
    TestBed.inject(HttpTestingController).verify();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the router outlet', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });
  it('renders every public navigation destination inside the application', () => {
    const fixture = TestBed.createComponent(App); fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    for (const link of Array.from(element.querySelectorAll<HTMLAnchorElement>('app-navbar a, app-footer a'))) {
      const href = link.getAttribute('href')!;
      expect(href.startsWith('#')).toBe(true);
      expect(element.querySelector(href)).not.toBeNull();
    }
    expect(element.querySelectorAll('main')).toHaveLength(1);
    expect(element.querySelector('app-pre-reservation form')).not.toBeNull();
  });

});
