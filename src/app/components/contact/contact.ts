import { maskPhone } from '../../shared/formats/input-masks';
import { ContactReceipt } from '../../services/booking.models';
import { EmailResult, EmailService } from '../../shared/email/email.service';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom, timeout } from 'rxjs';
import { SupabaseApi } from '../../services/supabase-api';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-contact',
  imports: [ReactiveFormsModule],
  templateUrl: './contact.html',
  styleUrl: './contact.scss',
})
export class Contact {
  private readonly delivery = inject(EmailService);
  private readonly api = inject(SupabaseApi);
  private readonly builder = inject(FormBuilder);
  private snackbarTimer?: ReturnType<typeof setTimeout>;
  private readonly destroyRef = inject(DestroyRef);
  protected readonly sending = signal(false);
  protected readonly feedback = signal('');
  protected readonly result = signal<'success' | 'warning' | 'error' | ''>('');
  protected readonly form = this.builder.nonNullable.group({
    name: [
      '',
      [
        Validators.required,
        Validators.pattern(/\S/),
        Validators.minLength(2),
        Validators.maxLength(120),
      ],
    ],
    phone: [
      '',
      [
        Validators.required,
        Validators.pattern(/^(?=(?:\D*\d){10,15}\D*$)[+()\d\s.-]+$/),
        Validators.maxLength(30),
      ],
    ],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    message: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(2000)]],
  });

  constructor() {
    this.destroyRef.onDestroy(() => clearTimeout(this.snackbarTimer));
  }

  protected dismissSuccess(): void {
    clearTimeout(this.snackbarTimer);
    this.feedback.set('');
    this.result.set('');
  }

  protected maskPhone(event: Event): void {
    this.form.controls.phone.setValue(maskPhone(event.target as HTMLInputElement));
  }

  protected invalid(field: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[field];
    return control.invalid && control.touched;
  }

  private async sendRegistered(receipt: ContactReceipt): Promise<EmailResult | undefined> {
    if (this.destroyRef.destroyed) return undefined;
    return firstValueFrom(this.delivery.send({ kind: 'contact', id: receipt.id, token: receipt.deliveryToken })
      .pipe(takeUntilDestroyed(this.destroyRef)));
  }

  private showSuccess(result: EmailResult | undefined): void {
    if (!result || this.destroyRef.destroyed) return;
    this.result.set('success');
    this.feedback.set(result.sent
      ? 'Sua mensagem foi registrada e enviada por e-mail. Obrigado pelo contato!'
      : 'Sua mensagem foi registrada e será enviada por e-mail. Obrigado pelo contato!');
    this.form.reset();
    this.snackbarTimer = setTimeout(() => this.dismissSuccess(), 6000);
  }

  /** Cancela requisições pendentes e evita criar timers após destruir o componente. */
  protected async submit(): Promise<void> {
    if (this.sending()) return;
    this.form.markAllAsTouched();
    this.dismissSuccess();
    if (this.form.invalid) return;
    this.sending.set(true);
    const payload = this.form.getRawValue();
    let registered = false;
    try {
      const receipt = await firstValueFrom(
        this.api.createContact(payload).pipe(timeout(15000), takeUntilDestroyed(this.destroyRef)),
      );
      registered = true;
      this.showSuccess(await this.sendRegistered(receipt));
    } catch {
      if (this.destroyRef.destroyed) return;
      this.result.set(registered ? 'warning' : 'error');
      this.feedback.set(
        registered
          ? 'Contato registrado. O envio está na fila e será retomado automaticamente.'
          : 'Não foi possível registrar sua mensagem. Seus campos foram preservados; tente novamente.',
      );
      if (registered) this.form.reset();
    } finally {
      this.sending.set(false);
    }
  }
}
