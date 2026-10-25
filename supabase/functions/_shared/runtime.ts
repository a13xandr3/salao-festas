export const env = Deno.env.toObject();
/** Uma configuração de segredo inválida não deve impedir a inicialização da função. */
function backendKey(): string | undefined {
  if (env.SUPABASE_SERVICE_ROLE_KEY) return env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const secrets: unknown = JSON.parse(env.SUPABASE_SECRET_KEYS || '{}');
    if (typeof secrets !== 'object' || secrets === null) return undefined;
    const key = (secrets as Record<string, unknown>)['default'];
    return typeof key === 'string' ? key : undefined;
  } catch { return undefined; }
}

function errorStatus(data: unknown, status: number): number {
  const code = (data as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^PT(400|403|404|409|413|429)$/.test(code) ? status : 503;
}

/** RPC interna do servidor; não expõe credenciais nem mensagens internas do banco. */
export async function rpc(name: string, input: object): Promise<unknown> {
  const key = backendKey();
  if (!key) throw new Error('Credencial interna indisponível.');
  const headers: Record<string, string> = {
    apikey: key,
    'Content-Type': 'application/json',
  };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15000),
  });
  const data: unknown = await response.json();
  if (!response.ok)
    throw Object.assign(new Error('Solicitação não autorizada ou indisponível.'), {
      status: errorStatus(data, response.status),
    });
  return data;
}
