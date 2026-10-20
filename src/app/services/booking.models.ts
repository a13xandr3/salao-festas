export interface ContactInput {
  name: string;
  phone: string;
  email: string;
  message: string;
}

export interface ReservationInput extends Omit<ContactInput, 'message'> {
  startDate: string;
  endDate: string;
}

export interface ReservationRecord extends Omit<ContactInput, 'message'> {
  id: string;
  startAt: string;
  endAt: string;
  status: 'pending_payment' | 'confirmed';
  notificationToken: string;
}

export interface ReservationReceipt {
  id: string;
  status: string;
  startAt: string;
  endAt: string;
  cancellationToken: string;
  links: { contract: string; pix: string };
}

export interface Availability {
  month: string;
  days: { date: string; status: 'free' | 'reserved' }[];
}

export interface ContactReceipt {
  id: string;
  deliveryToken: string;
}
