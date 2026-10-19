import { SupabaseApi } from '../../services/supabase-api';
import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timeout } from 'rxjs';
import { FormSubmitSubmission } from '../../services/formsubmit-delivery';
import { reservationLink } from '../../services/reservation-link';
@Component({
  selector: 'app-contract-upload',
  templateUrl: './contract-upload.html',
  styles: [
    ':host{display:block} section{margin-top:2rem;padding-top:2rem;border-top:1px solid #29312618} p{line-height:1.8} .form-control{background:#ffffff50;padding:1rem;border-radius:.75rem}',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContractUpload {
  private readonly document = inject(DOCUMENT);
  private readonly api = inject(SupabaseApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly visible = signal(false);
  protected readonly returned = signal(false);
  protected readonly submission = signal<FormSubmitSubmission | null>(null);
  protected readonly fields = signal<[string, string][]>([]);
  protected readonly fileValid = signal(false);
  protected readonly error = signal('');
  constructor() {
    afterNextRender(() => {
      if (this.document.defaultView?.location.hash === '#contrato-enviado') {
        this.visible.set(true);
        this.returned.set(true);
        return;
      }
      const link = reservationLink(this.document, 'enviar-contrato');
      if (!link) return;
      this.visible.set(true);
      this.api
        .reservationForm(link.id, link.token, true)
        .pipe(timeout(15000), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (submission) => {
            this.submission.set(submission);
            this.fields.set(Object.entries(submission.fields));
          },
          error: () =>
            this.error.set(
              'O link é inválido ou a pré-reserva foi cancelada. Entre em contato com a equipe.',
            ),
        });
    });
  }
  protected async selectFile(event: Event): Promise<void> {
    this.fileValid.set(false);
    this.error.set('');
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const header = await file.slice(0, 5).text();
      if (input.files?.[0] !== file) return;
      if (
        file.size > 10 * 1024 * 1024 ||
        !file.name.toLowerCase().endsWith('.pdf') ||
        header !== '%PDF-'
      ) {
        this.error.set('Selecione um PDF válido de até 10 MB.');
        return;
      }
      this.fileValid.set(true);
    } catch {
      if (input.files?.[0] === file)
        this.error.set('Não foi possível ler o arquivo. Selecione o PDF novamente.');
    }
  }

  protected submit(event: Event): void {
    if (!this.fileValid() || !this.submission()) event.preventDefault();
  }
}
