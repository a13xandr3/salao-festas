import { ReservationRecord } from './booking.models';
import { FormSubmitSubmission } from './formsubmit-delivery';
import { resourceUrl, SupabaseConfig } from './site-config';

/** Builds native FormSubmit forms; the database never claims email delivery. */
export function reservationSubmission(
  record: ReservationRecord,
  config: SupabaseConfig,
  base: string,
  contract = false,
): FormSubmitSubmission {
  const site = new URL(base);
  site.hash = '';
  site.search = '';
  const individualLink = (action: string) =>
    `${site.href}#${action}?${new URLSearchParams({ id: record.id, token: record.notificationToken })}`;
  const format = (value: string) =>
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  const details = `Protocolo: ${record.id}\nNome: ${record.name}\nTelefone: ${record.phone}\nE-mail: ${record.email}\nPeríodo: ${format(record.startAt)} até ${format(record.endAt)} (Brasília).`;
  const fields: Record<string, string> = {
    name: record.name,
    phone: record.phone,
    email: record.email,
    message: `${contract ? 'Contrato assinado referente à pré-reserva.' : 'Uma nova pré-reserva foi registrada na Família Tx.'}\n\n${details}`,
    _subject: contract ? 'Contrato assinado — Família Tx' : 'Nova pré-reserva — Família Tx',
    _template: 'table',
    _replyto: record.email,
    _next: `${site.href}#${contract ? 'contrato-enviado' : 'pre-reserva'}`,
  };
  if (!contract) {
    fields['_autoresponse'] =
      `Olá, ${record.name}!\nSua pré-reserva foi feita com sucesso e aguarda confirmação de pagamento.\n\n${details}\n\nBaixar contrato PDF: ${resourceUrl(config.contractUrl, base)}\nPix / chave para pagamento: ${resourceUrl(config.pixUrl, base)}\nApós o pagamento, assine digitalmente o contrato e envie o PDF por este link: ${individualLink('enviar-contrato')}\nCancelar sua pré-reserva: ${individualLink('cancelar-pre-reserva')}`;
  }
  return { action: `https://formsubmit.co/${encodeURIComponent(config.managerEmail)}`, fields };
}
