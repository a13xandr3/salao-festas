function publicUrl(value, base) {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('URL inválida.');
  return url.href;
}

export function messageFor(record, kind, role, token, env, attachment) {
  const manager = env.MAIL_MANAGER_EMAIL;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(manager || '')) throw new Error('Gestor não configurado.');
  const identity = `Nome: ${record.name}\nTelefone: ${record.phone}\nE-mail: ${record.email}`;
  if (kind === 'contact')
    return {
      to: manager,
      replyTo: record.email,
      subject: 'Novo contato — Espaço TX',
      text: `${identity}\n\n${record.message}`,
    };
  const site = publicUrl(env.PUBLIC_SITE_URL);
  const format = (value) =>
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  const details = `Protocolo: ${record.id}\n${identity}\nPeríodo: ${format(record.startAt)} até ${format(record.endAt)} (Brasília).`;
  if (kind === 'contract')
    return {
      to: manager,
      replyTo: record.email,
      subject: 'Contrato assinado — Espaço TX',
      text: details,
      attachments: [
        { filename: 'contrato-assinado.pdf', content: attachment, contentType: 'application/pdf' },
      ],
    };
  if (role === 'manager')
    return {
      to: manager,
      replyTo: record.email,
      subject: 'Nova pré-reserva — Espaço TX',
      text: details,
    };
  const individual = (action) =>
    `${site}#${action}?${new URLSearchParams({ id: record.id, token })}`;
  return {
    to: record.email,
    replyTo: manager,
    subject: 'Sua pré-reserva — Espaço TX',
    text: `Olá, ${record.name}!\nSua pré-reserva foi registrada e aguarda confirmação de pagamento.\n\n${details}\n\nBaixar contrato PDF: ${publicUrl(env.CONTRACT_URL, site)}\nPix: ${publicUrl(env.PIX_URL, site)}\nEnviar contrato assinado: ${individual('enviar-contrato')}\nCancelar pré-reserva: ${individual('cancelar-pre-reserva')}`,
  };
}
