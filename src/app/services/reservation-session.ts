import { DateTime } from 'luxon';
import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { resourceUrl } from './site-config';
import { ReservationReceipt } from './booking.models';

function hasIdentity(value: Partial<ReservationReceipt> | null): value is Partial<ReservationReceipt> {
  return !!value && typeof value.id === 'string' && value.id.length > 0 && /^[a-f0-9]{64}$/.test(value.cancellationToken ?? '');
}

function hasLinks(value: Partial<ReservationReceipt>): value is Partial<ReservationReceipt> & Pick<ReservationReceipt, 'links'> {
  return typeof value.links?.contract === 'string' && typeof value.links.pix === 'string';
}

function validPeriod(value: Partial<ReservationReceipt>): boolean {
  if (typeof value.startAt !== 'string' || typeof value.endAt !== 'string') return false;
  const start = DateTime.fromISO(value.startAt);
  const end = DateTime.fromISO(value.endAt);
  return start.isValid && end.isValid && end.toMillis() > start.toMillis();
}

const receiptKey = 'familia-tx-pre-reservation';

@Injectable({ providedIn: 'root' })
export class ReservationSession {
  private readonly document = inject(DOCUMENT);

  /** Valida o armazenamento local; a propriedade da reserva é conferida novamente no servidor. */
  read(): ReservationReceipt | null {
    try {
      const value: Partial<ReservationReceipt> | null = JSON.parse(
        this.document.defaultView?.sessionStorage.getItem(receiptKey) || 'null',
      );
      if (!hasIdentity(value) || !hasLinks(value)) return null;
      if (!validPeriod(value) || !['pending_payment', 'confirmed'].includes(value.status ?? '')) return null;
      return {
        ...value,
        links: {
          contract: resourceUrl(value.links.contract, this.document.baseURI),
          pix: resourceUrl(value.links.pix, this.document.baseURI),
        },
      } as ReservationReceipt;
    } catch {
      return null;
    }
  }

  save(receipt: ReservationReceipt): void {
    try {
      this.document.defaultView?.sessionStorage.setItem(receiptKey, JSON.stringify(receipt));
    } catch {
      /* The visible receipt remains available when storage is disabled. */
    }
  }

  clear(id: string): void {
    if (this.read()?.id !== id) return;
    try {
      this.document.defaultView?.sessionStorage.removeItem(receiptKey);
    } catch {
      /* Storage can be disabled by the browser. */
    }
  }
}
