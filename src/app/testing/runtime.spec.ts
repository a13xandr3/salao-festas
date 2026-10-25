import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

/** Exercises the Deno boundary in a VM; no credentials or real requests are used. */
function runtime(env: Record<string, string>, response = { ok: true, status: 200, code: '' }, body?: unknown) {
  const source = readFileSync(resolve(process.cwd(), 'supabase/functions/_shared/runtime.ts'), 'utf8');
  const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } });
  const exported = {} as { rpc: (name: string, parameters: object) => Promise<unknown> };
  const fetch = jest.fn(async (_url: string, _options: RequestInit) => ({ ok: response.ok, status: response.status, json: async () => body === undefined ? { code: response.code, result: 'ok' } : body }));
  const timeout = jest.fn(() => 'abort-signal');
  runInNewContext(compiled.outputText, { exports: exported, Deno: { env: { toObject: () => env } }, fetch, AbortSignal: { timeout } });
  return { ...exported, fetch, timeout };
}

describe('Deno runtime RPC boundary', () => {
  it('keeps JWT credentials server-side and applies the request timeout', async () => {
    const { rpc, fetch, timeout } = runtime({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'eyJ.test-server-only' });
    await rpc('test_operation', { id: 'test-id' });
    expect(fetch).toHaveBeenCalledWith('https://test.supabase.co/rest/v1/rpc/test_operation', expect.objectContaining({
      headers: { apikey: 'eyJ.test-server-only', Authorization: 'Bearer eyJ.test-server-only', 'Content-Type': 'application/json' }, body: '{"id":"test-id"}', signal: 'abort-signal',
    }));
    expect(timeout).toHaveBeenCalledWith(15000);
  });
  it('supports secret keys without placing them in a JWT Authorization header', async () => {
    const {rpc,fetch}=runtime({SUPABASE_SECRET_KEYS:'{"default":"sb_secret_test"}'});
    await rpc('test',{});
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });
  it.each([undefined,'{bad','null','false','{}','{"default":123}'])('fails closed for unavailable or malformed key configuration: %s', async secret => {
    const {rpc,fetch}=runtime(secret===undefined?{}:{SUPABASE_SECRET_KEYS:secret});
    await expect(rpc('test',{})).rejects.toThrow('Credencial interna indisponível');expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['PT400','PT403','PT404','PT409','PT413','PT429','42P01',''])('sanitizes infrastructure errors for code %s', async code => {
    const {rpc}=runtime({SUPABASE_SERVICE_ROLE_KEY:'sb_secret_test'},{ok:false,status:409,code});
    await expect(rpc('test',{})).rejects.toMatchObject({message:'Solicitação não autorizada ou indisponível.',status:code.startsWith('PT')?409:503});
  });  it.each([null,false,123,'unexpected',{}, {code:123}])('sanitizes nonstandard JSON error bodies: %s', async body => {
    const {rpc}=runtime({SUPABASE_SERVICE_ROLE_KEY:'sb_secret_test'},{ok:false,status:500,code:''},body);
    await expect(rpc('test',{})).rejects.toMatchObject({status:503});
  });

});
