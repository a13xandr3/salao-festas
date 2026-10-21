function publicUrl(value, base) {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('URL inválida.');
  return url.href;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
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
  const links = [
    ['Baixar Contrato em PDF', publicUrl(env.CONTRACT_URL, site)],
    ['Chave Pix', publicUrl(env.PIX_URL, site)],
    ['Enviar contrato assinado', individual('enviar-contrato')],
    ['Cancelar pré-reserva', individual('cancelar-pre-reserva')],
  ];
  const actions = links.map(([label, href], index) => `
    <tr><td style="padding:6px 0;">
      <a href="${escapeHtml(href)}" style="display:block;padding:14px 20px;border:1px solid #62694d;border-radius:12px;text-align:center;text-decoration:none;font-size:15px;line-height:1.5;${index === 0 ? 'background:#303b2c;color:#ffffff;' : 'color:#303b2c;'}">${label}</a>
    </td></tr>`).join('');
  const html = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sua pré-reserva — Espaço TX</title></head>
<body style="margin:0;padding:0;background:#eeece4;color:#293126;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" style="width:100%;border-collapse:collapse;background:#eeece4;"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" style="width:100%;max-width:560px;border-collapse:collapse;background:#ffffff;">
      <tr><td style="padding:28px 24px;background:#303b2c;color:#ffffff;">
        <p style="margin:0 0 12px;font-size:12px;letter-spacing:2px;">ESPAÇO TX · FAMÍLIA TEIXEIRA</p>
        <h1 style="margin:0;font-size:26px;line-height:1.3;">Seu encontro está mais perto.</h1>
      </td></tr>
      <tr><td style="padding:28px 24px;">
        <p style="margin:0 0 16px;font-size:18px;line-height:1.5;">Olá, ${escapeHtml(record.name)}!</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;">Sua pré-reserva foi registrada e aguarda confirmação de pagamento.</p>
        <table role="presentation" style="width:100%;border-collapse:collapse;background:#f4f3ed;"><tr><td style="padding:18px;font-size:14px;line-height:1.8;overflow-wrap:anywhere;word-break:break-word;">
          <strong>Protocolo</strong><br>${escapeHtml(record.id)}<br><br>
          <strong>Período · horário de Brasília</strong><br>${escapeHtml(format(record.startAt))} até ${escapeHtml(format(record.endAt))}
        </td></tr></table>
        <p style="margin:24px 0 12px;font-size:15px;line-height:1.7;">Acesse o contrato, consulte a chave Pix e envie o documento assinado pelos links abaixo.</p>
        <table role="presentation" style="width:100%;border-collapse:collapse;">${actions}</table>
        <p style="margin:24px 0 0;font-size:12px;line-height:1.7;color:#62694d;">Os links de envio e cancelamento são individuais. Guarde este e-mail e evite compartilhá-los.</p>
      </td></tr>
      <tr><td style="padding:20px 24px;border-top:1px solid #e5e5da;font-size:13px;line-height:1.7;color:#62694d;">Família TX · Um espaço para celebrar bons momentos.</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return {
    to: record.email,
    replyTo: manager,
    subject: 'Sua pré-reserva — Espaço TX',
    html,
    text: `Olá, ${record.name}!\nSua pré-reserva foi registrada e aguarda confirmação de pagamento.\n\n${details}\n\n${links.map(([label, href]) => `${label}: ${href}`).join('\n')}`,
  };
}
