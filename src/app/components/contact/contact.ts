import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom, timeout } from 'rxjs';

interface ContactResponse {
  id: string;
}

@Component({
  selector: 'app-contact',
  imports: [ReactiveFormsModule],
  templateUrl: './contact.html',
  styleUrl: './contact.scss',
})
export class Contact {
  private readonly http = inject(HttpClient);
  private sentPayload = '';
  private readonly emailEndpoint = 'https://formsubmit.co/ajax/a13xandr3ea@gmail.com';
  private readonly builder = inject(FormBuilder);
  protected readonly sending = signal(false);
  protected readonly feedback = signal('');
  protected readonly result = signal<'success' | 'warning' | 'error' | ''>('');
  protected readonly form = this.builder.nonNullable.group({
    name: ['', [Validators.required, Validators.pattern(/\S/), Validators.minLength(2), Validators.maxLength(120)]],
    phone: ['', [Validators.required, Validators.pattern(/^(?=(?:\D*\d){10,15}\D*$)[+()\d\s.-]+$/), Validators.maxLength(30)]],
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
    const payload = Object.fromEntries(Object.entries(this.form.getRawValue()).map(([key, value]) => [key, value.trim()]));
    const signature = JSON.stringify(payload);
    let emailAccepted = this.sentPayload === signature;

    try {
      // As in the reference component, FormSubmit receives FormData directly from the browser.
      if (!emailAccepted) {
        const data = new FormData();
        for (const [key, value] of Object.entries(payload)) data.append(key, value);
        data.append('_subject', 'Novo contato — Família Tx');
        data.append('_template', 'table');
        data.append('_replyto', payload['email']);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
          const response = await fetch(this.emailEndpoint, {
            method: 'POST',
            headers: { Accept: 'application/json' },
            body: data,
            signal: controller.signal,
          });
          if (!response.ok) throw new Error('Falha ao enviar formulário');
          const result: { success?: boolean | string } = await response.json();
          if (result.success === false || result.success === 'false') throw new Error('FormSubmit recusou o envio');
        } finally {
          clearTimeout(timer);
        }
        this.sentPayload = signature;
        emailAccepted = true;
      }

      // Only persist here: the API does not send another email.
      await firstValueFrom(this.http.post<ContactResponse>('/api/contacts', payload).pipe(timeout(15000)));
      this.result.set('success');
      this.feedback.set('Sua mensagem foi encaminhada para envio por e-mail e registrada. Obrigado pelo contato!');
      this.form.reset();
      this.sentPayload = '';
    } catch {
      this.result.set(emailAccepted ? 'warning' : 'error');
      this.feedback.set(emailAccepted
        ? 'Sua mensagem foi encaminhada para envio por e-mail, mas não foi possível salvar o contato. Clique em enviar novamente para tentar apenas o registro, sem repetir o e-mail.'
        : 'Não foi possível enviar sua mensagem. Seus campos foram preservados; tente novamente.');
    } finally {
      this.sending.set(false);
    }
  }
}
