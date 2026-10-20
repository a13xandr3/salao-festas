import { EmailService } from '../../shared/email/email.service';
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
  private readonly delivery = inject(EmailService);
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
    let registered = false;
    try {
      const { id, deliveryToken } = await firstValueFrom(
        this.api.createContact(payload).pipe(timeout(15000)),
      );
      registered = true;
      const result = await firstValueFrom(
        this.delivery.send({ kind: 'contact', id, token: deliveryToken }),
      );
      this.result.set('success');
      this.feedback.set(
        result.sent
          ? 'Sua mensagem foi registrada e enviada por e-mail. Obrigado pelo contato!'
          : 'Sua mensagem foi registrada e será enviada por e-mail. Obrigado pelo contato!',
      );
      this.form.reset();
    } catch {
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
