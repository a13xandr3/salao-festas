/** Configurações e registros fictícios compartilhados pelos testes; não usa credenciais reais. */
import { of } from 'rxjs';
import { SiteConfig, SupabaseConfig } from '../services/site-config';

export const testSupabaseUrl = 'https://example.supabase.co';
export const testSite = 'https://www.salaoespacotx.com.br/';
export const testConfig: SupabaseConfig = {
  supabaseUrl: testSupabaseUrl,
  supabasePublishableKey: 'sb_publishable_test',
  contractUrl: `${testSite}documents/contrato.pdf`,
  pixUrl: `${testSite}pix.html`,
};
/** Fornece a configuração fictícia do Supabase aos testes Angular. */
export const provideTestConfig = () => ({
  provide: SiteConfig,
  useValue: { config$: of(testConfig), base: testSite },
});
/** Monta a URL fictícia da RPC esperada pela requisição do teste. */
export const rpcUrl = (name: string) => `${testSupabaseUrl}/rest/v1/rpc/${name}`;
export const testReservation = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Cliente Teste',
  phone: '11999999999',
  email: 'client@example.com',
  status: 'pending_payment' as const,
  notificationToken: 'a'.repeat(64),
  startAt: '2028-02-28T11:00:00Z',
  endAt: '2028-02-29T11:00:00Z',
};

export const emailUrl = `${testSupabaseUrl}/functions/v1/send-email`;
