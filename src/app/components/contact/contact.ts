import { FormSubmitDelivery } from '../../services/formsubmit-delivery';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
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
  private readonly delivery = inject(FormSubmitDelivery);
  private sentPayload = '';
  private readonly api = inject(SupabaseApi);
  private readonly builder = inject(FormBuilder);
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

  protected invalid(field: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[field];
    return control.invalid && control.touched;
  }

  protected async submit(): Promise<void> {
    if (this.sending()) return;
    this.form.markAllAsTouched();
    this.feedback.set('');
    this.result.set('');
    if (this.form.invalid) return;
    this.sending.set(true);
    const payload = this.form.getRawValue();
    const signature = JSON.stringify(payload);
    let emailAccepted = this.sentPayload === signature;

    try {
      if (!emailAccepted) {
        const endpoint = await firstValueFrom(this.api.contactEndpoint().pipe(timeout(10000)));
        await this.delivery.sendContact(endpoint, payload);
        this.sentPayload = signature;
        emailAccepted = true;
      }

      await firstValueFrom(this.api.createContact(payload).pipe(timeout(15000)));
      this.result.set('success');
      this.feedback.set(
        'Sua mensagem foi encaminhada para envio por e-mail e registrada. Obrigado pelo contato!',
      );
      this.form.reset();
      this.sentPayload = '';
    } catch {
      this.result.set(emailAccepted ? 'warning' : 'error');
      this.feedback.set(
        emailAccepted
          ? 'Sua mensagem foi encaminhada para envio por e-mail, mas não foi possível salvar o contato. Clique em enviar novamente para tentar apenas o registro, sem repetir o e-mail.'
          : 'Não foi possível enviar sua mensagem. Seus campos foram preservados; tente novamente.',
      );
    } finally {
      this.sending.set(false);
    }
  }
}
