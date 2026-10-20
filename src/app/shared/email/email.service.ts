import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable, switchMap, timeout } from 'rxjs';
import { SiteConfig } from '../../services/site-config';

export type EmailRequest = {
  kind: 'contact' | 'reservation' | 'contract';
  id: string;
  token: string;
  attachment?: File;
};

export type EmailResult = { sent: boolean; queued?: boolean };

/** Sends email requests. SMTP credentials exist only in the Supabase function. */
@Injectable({ providedIn: 'root' })
export class EmailService {
  private readonly http = inject(HttpClient);
  private readonly settings = inject(SiteConfig);

  send(request: EmailRequest): Observable<EmailResult> {
    const body = new FormData();
    body.set('kind', request.kind);
    body.set('id', request.id);
    body.set('token', request.token);
    if (request.attachment) body.set('attachment', request.attachment);
    return this.settings.config$.pipe(
      switchMap((config) =>
        this.http.post<EmailResult>(`${config.supabaseUrl}/functions/v1/send-email`, body, {
          headers: { apikey: config.supabasePublishableKey },
        }),
      ),
      timeout(30000),
      map((result) => {
        if (result.sent !== true && result.queued !== true)
          throw new Error('O servidor não confirmou o recebimento do e-mail para envio.');
        return result;
      }),
    );
  }
}
