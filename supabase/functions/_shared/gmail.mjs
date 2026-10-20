/** SMTP transport only: receives a complete message and sends it through Gmail. */
function gmailTransport(env, createTransport) {
  if (
    env.GMAIL_HOST !== 'smtp.gmail.com' ||
    env.GMAIL_PORT !== '465' ||
    !/^[^\s@]+@gmail\.com$/.test(env.GMAIL_USER || '') ||
    !env.GMAIL_APP_PASSWORD?.trim()
  ) {
    throw new Error('Configure o Gmail SMTP nas variáveis privadas.');
  }
  return createTransport({
    host: env.GMAIL_HOST,
    port: 465,
    secure: true,
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD.replace(/\s/g, '') },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 45000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

async function withTimeout(transport, operation) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Tempo limite do SMTP.')), 40000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    transport.close?.();
  }
}

export function verifyGmailConnection(env, createTransport) {
  const transport = gmailTransport(env, createTransport);
  return withTimeout(transport, () => transport.verify());
}

export function createGmailSender(env, createTransport) {
  const transport = gmailTransport(env, createTransport);
  return async (message) => {
    const result = await withTimeout(transport, () => transport.sendMail({
      ...message,
      from: { name: 'Espaço TX', address: env.GMAIL_USER },
    }));
    if (!result.accepted?.length || result.rejected?.length)
      throw new Error('SMTP não aceitou o destinatário.');
  };
}
