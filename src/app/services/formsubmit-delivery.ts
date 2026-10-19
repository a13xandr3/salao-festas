import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
export interface FormSubmitSubmission {
  action: string;
  fields: Record<string, string>;
}
@Injectable({ providedIn: 'root' })
export class FormSubmitDelivery {
  private readonly document = inject(DOCUMENT);

  async sendContact(
    endpoint: string,
    payload: { name: string; phone: string; email: string; message: string },
  ): Promise<void> {
    const data = new FormData();
    for (const [key, value] of Object.entries(payload)) data.append(key, value.trim());
    data.append('_subject', 'Novo contato — Família Tx');
    data.append('_template', 'table');
    data.append('_replyto', payload.email.trim());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: data,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Falha ao enviar formulário.');
      const result: { success?: boolean | string } = await response.json();
      if (result.success !== true && result.success !== 'true')
        throw new Error('FormSubmit não confirmou o envio.');
    } finally {
      clearTimeout(timer);
    }
  }
  submit(submission: FormSubmitSubmission): void {
    const action = new URL(submission.action);
    if (action.origin !== 'https://formsubmit.co' || action.pathname.startsWith('/ajax/'))
      throw new Error('Destino FormSubmit inválido');
    const form = this.document.createElement('form');
    form.method = 'POST';
    form.action = action.href;
    form.target = '_self';
    form.hidden = true;
    for (const [name, value] of Object.entries(submission.fields)) {
      const input = this.document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    this.document.body.appendChild(form);
    try {
      form.submit();
    } finally {
      form.remove();
    }
  }
}
