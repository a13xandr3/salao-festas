/** Testa autenticação, cadastro TOTP e autorização sem usar contas reais. */
import { TestBed } from '@angular/core/testing';
import { createClient } from '@supabase/supabase-js';
import { of, throwError } from 'rxjs';
import { AdminAuth } from './admin-auth';
import { SiteConfig } from './site-config';
import { testConfig } from '../testing/supabase';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

describe('AdminAuth', () => {
  /** Monta uma resposta de sucesso do SDK sem consultar o Supabase real. */
  const ok = (data: unknown = {}) => ({ data, error: null });
  /** Monta uma resposta de falha do SDK para testar o tratamento de erros. */
  const failure = () => ({ data: null, error: new Error('private server detail') });
  let service: AdminAuth;
  let client: any;
  let authEvent: (event: string, session: unknown) => void;
  beforeEach(() => {
    client = {
      rpc: jest.fn().mockResolvedValue(ok(true)),
      auth: {
        signInWithPassword: jest.fn().mockResolvedValue(ok({ user: { email: 'admin@example.com' } })),
        signOut: jest.fn().mockResolvedValue(ok()),
        onAuthStateChange: jest.fn(callback => { authEvent = callback; }),
        mfa: {
          listFactors: jest.fn().mockResolvedValue(ok({ totp: [{ id: 'verified-id', status: 'verified' }], all: [] })),
          enroll: jest.fn().mockResolvedValue(ok({ id: 'new-id', totp: { qr_code: 'data:image/svg+xml,test', secret: 'TESTSECRET' } })),
          unenroll: jest.fn().mockResolvedValue(ok()),
          challengeAndVerify: jest.fn().mockResolvedValue(ok()),
          getAuthenticatorAssuranceLevel: jest.fn().mockResolvedValue(ok({ currentLevel: 'aal2' })),
        },
      },
    };
    (createClient as jest.Mock).mockReset().mockReturnValue(client);
    TestBed.configureTestingModule({ providers: [{ provide: SiteConfig, useValue: { config$: of(testConfig) } }] });
    service = TestBed.inject(AdminAuth);
  });
  /** Inicia o login com credenciais fictícias usadas pelos testes. */
  const signIn = () => service.signIn(' admin@example.com ', 'a long test passphrase');

  it('keeps the session in memory and requires a fresh TOTP before granting access', async () => {
    expect(service.authorized()).toBe(false);
    await signIn();
    expect(createClient).toHaveBeenCalledWith(testConfig.supabaseUrl, testConfig.supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
    });
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'admin@example.com', password: 'a long test passphrase' });
    expect(service.stage()).toBe('totp'); expect(service.authorized()).toBe(false);
    await service.verify('012345');
    expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'verified-id', code: '012345' });
    expect(client.rpc).toHaveBeenLastCalledWith('booking_admin_access');
    expect(service.authorized()).toBe(true); expect(service.email()).toBe('admin@example.com');
    expect(createClient).toHaveBeenCalledTimes(1);
    await service.signOut();
    expect(service.authorized()).toBe(false); expect(service.email()).toBe('');
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('enrolls the first TOTP, removing only unfinished TOTP enrollments', async () => {
    client.auth.mfa.listFactors.mockResolvedValue(ok({ totp: [], all: [
      { id: 'unfinished', factor_type: 'totp', status: 'unverified' },
      { id: 'phone', factor_type: 'phone', status: 'unverified' },
      { id: 'existing', factor_type: 'totp', status: 'verified' },
    ] }));
    client.auth.signInWithPassword.mockResolvedValue(ok({ user: {} }));
    await signIn();
    expect(service.stage()).toBe('enroll'); expect(service.email()).toBe('admin@example.com');
    expect(client.auth.mfa.unenroll).toHaveBeenCalledTimes(1);
    expect(client.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'unfinished' });
    expect(service.enrollment()).toEqual({ qrCode: 'data:image/svg+xml,test', secret: 'TESTSECRET' });
    expect(service.authorized()).toBe(false);
    await service.verify('123456');
    expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'new-id', code: '123456' });
    expect(service.enrollment()).toBeNull(); expect(service.authorized()).toBe(true);
  });
  it('does not reuse a client initialization failure', async () => {
    let calls = 0;
    TestBed.resetTestingModule();
    const { defer } = await import('rxjs');
    TestBed.configureTestingModule({ providers: [{ provide: SiteConfig, useValue: {
      config$: defer(() => ++calls === 1 ? throwError(() => new Error('config')) : of(testConfig)),
    } }] });
    service = TestBed.inject(AdminAuth);
    await expect(signIn()).rejects.toThrow('config');
    await signIn(); expect(service.stage()).toBe('totp');
  });
  it('rejects incorrect credentials without calling authorization or enrollment', async () => {
    client.auth.signInWithPassword.mockResolvedValue(failure());
    await expect(signIn()).rejects.toThrow();
    expect(client.rpc).not.toHaveBeenCalled(); expect(service.authorized()).toBe(false);
  });
  it.each(['error', 'not-allowed'])('rejects ineligible users: %s', async mode => {
    client.rpc.mockResolvedValue(mode === 'error' ? failure() : ok(false));
    await expect(signIn()).rejects.toThrow();
    expect(client.auth.signOut).toHaveBeenCalled();
    expect(client.auth.mfa.listFactors).not.toHaveBeenCalled(); expect(service.stage()).toBe('credentials');
  });
  it.each(['list', 'remove', 'enroll'])('closes a partial login after a %s failure', async mode => {
    client.auth.mfa.listFactors.mockResolvedValue(mode === 'list' ? failure() : ok({ totp: [], all: [{ id: 'old', factor_type: 'totp', status: 'unverified' }] }));
    if (mode === 'remove') client.auth.mfa.unenroll.mockResolvedValue(failure());
    if (mode === 'enroll') client.auth.mfa.enroll.mockResolvedValue(failure());
    await expect(signIn()).rejects.toThrow();
    expect(service.stage()).toBe('credentials'); expect(service.enrollment()).toBeNull();
  });
  it('only marks the session authorized after both AAL2 and allowlist verification', async () => {
    await signIn();
    const access=jest.fn(async () => { expect(service.authorized()).toBe(false);return ok(true); });
    client.rpc.mockImplementation(access);
    await service.verify('123456');
    expect(access).toHaveBeenCalledWith('booking_admin_access');expect(service.authorized()).toBe(true);
  });
  it('requires a factor and exactly six digits even when invoked outside the form', async () => {
    await expect(service.verify('123456')).rejects.toThrow();
    await signIn();
    for (const code of ['12345', '1234567', 'abcdef']) await expect(service.verify(code)).rejects.toThrow();
    expect(client.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });
  it('allows retrying an incorrect TOTP without exposing the panel', async () => {
    await signIn(); client.auth.mfa.challengeAndVerify.mockResolvedValueOnce(failure());
    await expect(service.verify('123456')).rejects.toThrow();
    expect(service.stage()).toBe('totp'); expect(service.authorized()).toBe(false);
    await service.verify('654321'); expect(service.authorized()).toBe(true);
  });
  it.each(['assurance-error', 'aal1', 'access-error', 'not-admin'])('rejects verification without both AAL2 and server permission: %s', async mode => {
    await signIn();
    if (mode === 'assurance-error') client.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(failure());
    if (mode === 'aal1') client.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(ok({ currentLevel: 'aal1' }));
    if (mode === 'access-error') client.rpc.mockResolvedValue(failure());
    if (mode === 'not-admin') client.rpc.mockResolvedValue(ok(false));
    await expect(service.verify('123456')).rejects.toThrow();
    expect(service.authorized()).toBe(false); expect(client.auth.signOut).toHaveBeenCalled();
  });
  it('clears panel access when the SDK reports sign-out or session loss', async () => {
    await signIn(); await service.verify('123456');
    authEvent('TOKEN_REFRESHED', { access_token: 'test' }); expect(service.authorized()).toBe(true);
    authEvent('SIGNED_OUT', { access_token: 'old' }); expect(service.authorized()).toBe(false);
    await signIn(); await service.verify('123456');
    authEvent('INITIAL_SESSION', null); expect(service.authorized()).toBe(false);
  });
  it('only passes the SDK client to data operations after full authorization', async () => {
    const operation=jest.fn(async ()=>'result');
    await expect(service.runAuthorized(operation)).rejects.toThrow('Acesso restrito');expect(operation).not.toHaveBeenCalled();
    await signIn();await expect(service.runAuthorized(operation)).rejects.toThrow('Acesso restrito');
    await service.verify('123456');expect(await service.runAuthorized(operation)).toBe('result');expect(operation).toHaveBeenCalledWith(client);
    await service.signOut();await expect(service.runAuthorized(operation)).rejects.toThrow('Acesso restrito');
  });
  it('hides the panel even if server sign-out fails', async () => {
    await signIn(); await service.verify('123456');
    client.auth.signOut.mockResolvedValue(failure());
    await expect(service.signOut()).rejects.toThrow(); expect(service.authorized()).toBe(false);
  });
});
