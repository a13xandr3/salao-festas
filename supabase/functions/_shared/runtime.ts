export const env = Deno.env.toObject();
const backendKey =
  env.SUPABASE_SERVICE_ROLE_KEY || JSON.parse(env.SUPABASE_SECRET_KEYS || '{}').default;

export async function rpc(name: string, input: object) {
  if (!backendKey) throw new Error('Credencial interna indisponível.');
  const headers: Record<string, string> = {
    apikey: backendKey,
    'Content-Type': 'application/json',
  };
  if (backendKey.startsWith('eyJ')) headers.Authorization = `Bearer ${backendKey}`;
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error('Solicitação não autorizada ou indisponível.'), {
      status: /^PT(400|403|404|409|413|429)$/.test(data?.code || '') ? response.status : 503,
    });
  return data;
}
