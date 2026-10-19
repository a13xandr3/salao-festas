import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, switchMap, throwError } from 'rxjs';
import {
  Availability,
  ContactInput,
  ReservationInput,
  ReservationReceipt,
  ReservationRecord,
} from './booking.models';
import { FormSubmitSubmission } from './formsubmit-delivery';
import { reservationSubmission } from './reservation-submission';
import { SiteConfig } from './site-config';

@Injectable({ providedIn: 'root' })
export class SupabaseApi {
  private readonly http = inject(HttpClient);
  private readonly settings = inject(SiteConfig);

  contactEndpoint(): Observable<string> {
    return this.settings.config$.pipe(
      map((config) => `https://formsubmit.co/ajax/${encodeURIComponent(config.managerEmail)}`),
    );
  }

  createContact(input: ContactInput): Observable<{ id: string }> {
    return this.rpc('booking_create_contact', { p_input: input });
  }

  availability(month: string): Observable<Availability> {
    return this.rpc('booking_availability', { p_month: month });
  }

  createReservation(input: ReservationInput): Observable<ReservationReceipt> {
    return this.rpc<ReservationRecord>('booking_create_reservation', { p_input: input }).pipe(
      switchMap((record) =>
        this.settings.config$.pipe(
          map((config) => ({
            id: record.id,
            status: record.status,
            startAt: record.startAt,
            endAt: record.endAt,
            cancellationToken: record.notificationToken,
            submission: reservationSubmission(record, config, this.settings.base),
            links: { contract: config.contractUrl, pix: config.pixUrl },
          })),
        ),
      ),
    );
  }

  reservationForm(id: string, token: string, contract = false): Observable<FormSubmitSubmission> {
    return this.rpc<ReservationRecord>('booking_owned_reservation', {
      p_id: id,
      p_token: token,
      p_contract: contract,
    }).pipe(
      switchMap((record) =>
        this.settings.config$.pipe(
          map((config) => reservationSubmission(record, config, this.settings.base, contract)),
        ),
      ),
    );
  }

  cancelReservation(id: string, token: string): Observable<{ cancelled: boolean }> {
    return this.rpc('booking_cancel_reservation', { p_id: id, p_token: token });
  }

  private rpc<T>(name: string, parameters: object): Observable<T> {
    return this.settings.config$.pipe(
      switchMap((config) =>
        this.http.post<T>(`${config.supabaseUrl}/rest/v1/rpc/${name}`, parameters, {
          headers: { apikey: config.supabasePublishableKey },
        }),
      ),
      catchError((error) => {
        if (error instanceof HttpErrorResponse) return throwError(() => error);
        return throwError(
          () =>
            new HttpErrorResponse({
              status: 503,
              error: { message: 'Configuração do Supabase indisponível.' },
            }),
        );
      }),
    );
  }
}
