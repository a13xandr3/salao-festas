import { DateTime } from 'luxon';
import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { resourceUrl } from './site-config';
import { ReservationReceipt } from './booking.models';

/** Confere se o recibo possui identificador e token no formato esperado. */
function hasIdentity(value: Partial<ReservationReceipt> | null): value is Partial<ReservationReceipt> {
  return !!value && typeof value.id === 'string' && value.id.length > 0 && /^[a-f0-9]{64}$/.test(value.cancellationToken ?? '');
}

/** Confere se os links de contrato e Pix estão presentes como texto. */
function hasLinks(value: Partial<ReservationReceipt>): value is Partial<ReservationReceipt> & Pick<ReservationReceipt, 'links'> {
  return typeof value.links?.contract === 'string' && typeof value.links.pix === 'string';
}

/** Valida as datas do recibo e exige que o término seja posterior ao início. */
function validPeriod(value: Partial<ReservationReceipt>): boolean {
  if (typeof value.startAt !== 'string' || typeof value.endAt !== 'string') return false;
  const start = DateTime.fromISO(value.startAt);
  const end = DateTime.fromISO(value.endAt);
  return start.isValid && end.isValid && end.toMillis() > start.toMillis();
}

const receiptKey = 'familia-tx-pre-reservation';

/** Valida e mantém o recibo do cliente na sessão do navegador. */
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

  /** Salva o recibo na sessão do navegador quando o armazenamento está disponível. */
  save(receipt: ReservationReceipt): void {
    try {
      this.document.defaultView?.sessionStorage.setItem(receiptKey, JSON.stringify(receipt));
    } catch {
      /* O recibo continua disponível na tela quando o armazenamento está desabilitado. */
    }
  }

  /** Remove apenas o recibo correspondente à reserva informada. */
  clear(id: string): void {
    if (this.read()?.id !== id) return;
    try {
      this.document.defaultView?.sessionStorage.removeItem(receiptKey);
    } catch {
      /* O navegador pode bloquear o armazenamento da sessão. */
    }
  }
}
