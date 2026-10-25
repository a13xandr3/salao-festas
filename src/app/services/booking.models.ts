/** Dados enviados pelo formulário público de contato. */
export interface ContactInput {
  name: string;
  phone: string;
  email: string;
  message: string;
}

/** Dados do cliente e período solicitado para criar uma pré-reserva. */
export interface ReservationInput extends Omit<ContactInput, 'message'> {
  startDate: string;
  endDate: string;
}

/** Registro de reserva retornado pelas operações autorizadas do banco. */
export interface ReservationRecord extends Omit<ContactInput, 'message'> {
  id: string;
  startAt: string;
  endAt: string;
  status: 'pending_payment' | 'confirmed';
  notificationToken: string;
}

/** Recibo utilizado pelo cliente para retomar a reserva e acessar seus recursos. */
export interface ReservationReceipt {
  id: string;
  status: string;
  startAt: string;
  endAt: string;
  cancellationToken: string;
  links: { contract: string; pix: string };
}

/** Dias e estados de disponibilidade pública de um mês. */
export interface Availability {
  month: string;
  days: { date: string; status: 'free' | 'pre_reserved' | 'reserved' }[];
}

/** Identificador do contato gravado e token usado para solicitar sua notificação. */
export interface ContactReceipt {
  id: string;
  deliveryToken: string;
}
