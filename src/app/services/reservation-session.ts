import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { ReservationReceipt } from './booking.models';

const receiptKey = 'familia-tx-pre-reservation';

@Injectable({ providedIn: 'root' })
export class ReservationSession {
  private readonly document = inject(DOCUMENT);

  read(): ReservationReceipt | null {
    try {
      const value = JSON.parse(
        this.document.defaultView?.sessionStorage.getItem(receiptKey) || 'null',
      );
      if (!value || typeof value.id !== 'string' || !/^[a-f0-9]{64}$/.test(value.cancellationToken))
        return null;
      if (
        !value.links ||
        typeof value.links.contract !== 'string' ||
        typeof value.links.pix !== 'string'
      )
        return null;
      return value;
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
