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
import { finalize, timeout } from 'rxjs';
import { EmailService } from '../../shared/email/email.service';
import { reservationLink } from '../../services/reservation-link';
/** Recebe o contrato PDF após validar o link individual da reserva. */
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
  private readonly delivery = inject(EmailService);
  private link: { id: string; token: string } | null = null;
  private attachment: File | null = null;
  private readonly destroyRef = inject(DestroyRef);
  protected readonly visible = signal(false);
  protected readonly returned = signal(false);
  protected readonly loaded = signal(false);
  protected readonly sending = signal(false);
  protected readonly fileValid = signal(false);
  protected readonly error = signal('');
  /** Confere o link individual no servidor antes de habilitar o envio do contrato. */
  constructor() {
    afterNextRender(() => {
      const link = reservationLink(this.document, 'enviar-contrato');
      if (!link) return;
      this.link = link;
      this.visible.set(true);
      this.api
        .ownedReservation(link.id, link.token)
        .pipe(timeout(15000), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => this.loaded.set(true),
          error: () =>
            this.error.set(
              'O link é inválido ou a pré-reserva foi cancelada. Entre em contato com a equipe.',
            ),
        });
    });
  }
  /** A validação local de PDF melhora o retorno; o servidor repete a validação e a autorização. */
  protected async selectFile(event: Event): Promise<void> {
    this.attachment = null;
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
      this.attachment = file;
      this.fileValid.set(true);
    } catch {
      if (input.files?.[0] === file)
        this.error.set('Não foi possível ler o arquivo. Selecione o PDF novamente.');
    }
  }

  /** Envia o PDF selecionado somente após validar a propriedade da reserva. */
  protected submit(event: Event): void {
    event.preventDefault();
    if (!this.link || !this.loaded() || !this.attachment || !this.fileValid() || this.sending()) return;
    this.sending.set(true);
    this.error.set('');
    this.delivery
      .send({ kind: 'contract', ...this.link, attachment: this.attachment })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.sending.set(false)),
      )
      .subscribe({
        next: () => this.returned.set(true),
        error: () =>
          this.error.set('Não foi possível enviar o contrato por e-mail. Tente novamente.'),
      });
  }
}
