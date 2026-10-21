import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { RenderMode } from '@angular/ssr';
import { appConfig } from './app.config';
import { config } from './app.config.server';
import { routes } from './app.routes';
import { serverRoutes } from './app.routes.server';

describe('Application configuration', () => {
  it('provides the HTTP client and router used by the standalone application', () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    expect(TestBed.inject(HttpClient)).toBeInstanceOf(HttpClient);
    expect(TestBed.inject(Router).config).toEqual(routes);
    expect(routes).toEqual([]);
  });
  it('prerenders every route and retains browser providers in the server configuration', () => {
    expect(serverRoutes).toEqual([{ path: '**', renderMode: RenderMode.Prerender }]);
    for (const provider of appConfig.providers) expect(config.providers).toContain(provider);
    expect(config.providers.length).toBeGreaterThan(appConfig.providers.length);
  });
});
