import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { defer, map, shareReplay } from 'rxjs';

export interface SupabaseConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  contractUrl: string;
  pixUrl: string;
}

export function resourceUrl(value: string, base: string): string {
  const url = new URL(value, base);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Endereço de recurso inválido.');
  }
  return url.href;
}

function isPublicKey(key: string): boolean {
  if (key.startsWith('sb_publishable_')) return true;
  try {
    const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).role === 'anon';
  } catch {
    return false;
  }
}

function validateConfig(config: SupabaseConfig, base: string): SupabaseConfig {
  const url = new URL(config.supabaseUrl);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Configure a URL HTTPS do projeto Supabase em app-config.json.');
  }
  if (!isPublicKey(config.supabasePublishableKey)) {
    throw new Error('Use somente uma chave publishable ou anon.');
  }
  return {
    ...config,
    supabaseUrl: url.origin,
    contractUrl: resourceUrl(config.contractUrl, base),
    pixUrl: resourceUrl(config.pixUrl, base),
  };
}

@Injectable({ providedIn: 'root' })
export class SiteConfig {
  private readonly document = inject(DOCUMENT);
  private readonly http = inject(HttpClient);

  get base(): string {
    return this.document.baseURI;
  }

  readonly config$ = defer(() =>
    this.http.get<SupabaseConfig>(new URL('app-config.json', this.base).href),
  ).pipe(
    map((config) => validateConfig(config, this.base)),
    shareReplay({ bufferSize: 1, refCount: false }),
  );
}
