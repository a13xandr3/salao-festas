import { DOCUMENT } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { resourceUrl, SiteConfig } from './site-config';
import { testConfig, testSite } from '../testing/supabase';

describe('SiteConfig', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: DOCUMENT, useValue: { baseURI: testSite } }] }));
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('resolves resources relative to Pages and shares the validated configuration', () => {
    const service = TestBed.inject(SiteConfig), received = jest.fn(), second = jest.fn();
    service.config$.subscribe(received);
    TestBed.inject(HttpTestingController).expectOne(testSite + 'app-config.json').flush({ ...testConfig, contractUrl: 'documents/contract.pdf', pixUrl: 'pix.html' });
    service.config$.subscribe(second);
    expect(received).toHaveBeenCalledWith({ ...testConfig, contractUrl: testSite + 'documents/contract.pdf', pixUrl: testSite + 'pix.html' });
    expect(second).toHaveBeenCalledWith(received.mock.calls[0][0]);
    TestBed.inject(HttpTestingController).expectNone(testSite + 'app-config.json');
  });
  it.each(['http://project.supabase.co', 'https://user@project.supabase.co', 'https://:pass@project.supabase.co', 'https://project.supabase.co/path', 'https://project.supabase.co/?query=1', 'https://project.supabase.co/#hash'])('rejects malformed project URL %s', (supabaseUrl) => {
    const failed = jest.fn(); TestBed.inject(SiteConfig).config$.subscribe({ error: failed });
    TestBed.inject(HttpTestingController).expectOne(testSite + 'app-config.json').flush({ ...testConfig, supabaseUrl });
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('URL HTTPS') }));
  });
  it('accepts the legacy public anon key', () => {
    const received = jest.fn(); TestBed.inject(SiteConfig).config$.subscribe(received);
    const key = 'header.' + btoa(JSON.stringify({ role: 'anon' })) + '.signature';
    TestBed.inject(HttpTestingController).expectOne(testSite + 'app-config.json').flush({ ...testConfig, supabasePublishableKey: key });
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ supabasePublishableKey: key }));
  });
  it.each(['javascript:alert(1)', 'https://user@example.com/file', 'https://:pass@example.com/file'])('rejects unsafe resource %s', (value) => {
    expect(() => resourceUrl(value, testSite)).toThrow('Endereço de recurso inválido.');
  });
  it('supports HTTP resources during local development', () => {
    expect(resourceUrl('/contract.pdf', 'http://localhost:4209/')).toBe('http://localhost:4209/contract.pdf');
  });
  it('loads configuration and payment resources from the custom domain root', () => {
    expect(new URL('app-config.json', testSite).href).toBe('https://www.salaoespacotx.com.br/app-config.json');
    expect(resourceUrl('documents/contrato-de-locacao-espaco-tx.pdf', testSite)).toBe('https://www.salaoespacotx.com.br/documents/contrato-de-locacao-espaco-tx.pdf');
    expect(resourceUrl('pix.html', testSite)).toBe('https://www.salaoespacotx.com.br/pix.html');
  });

});
