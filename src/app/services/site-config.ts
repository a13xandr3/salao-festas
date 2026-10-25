import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { defer, map, shareReplay } from 'rxjs';

/** Configuração pública do frontend; não contém senha SMTP ou chave administrativa. */
export interface SupabaseConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  contractUrl: string;
  pixUrl: string;
}

/** Rejeita URLs executáveis, credenciais embutidas e recursos HTTP em produção. */
export function resourceUrl(value: string, base: string): string {
  const url = new URL(value, base);
  const localHttp = url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && new URL(base).protocol === 'http:';
  if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password) {
    throw new Error('Endereço de recurso inválido.');
  }
  return url.href;
}

/** Aceita apenas chave publicável ou JWT legado com papel anon. */
function isPublicKey(key: string): boolean {
  if (key.startsWith('sb_publishable_')) return true;
  try {
    const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).role === 'anon';
  } catch {
    return false;
  }
}

/** Valida a URL do Supabase, a chave pública e os recursos de contrato e Pix. */
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

/** Carrega uma única configuração pública validada para os serviços da aplicação. */
@Injectable({ providedIn: 'root' })
export class SiteConfig {
  private readonly document = inject(DOCUMENT);
  private readonly http = inject(HttpClient);

  /** Retorna a URL base usada para resolver os recursos públicos do site. */
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
