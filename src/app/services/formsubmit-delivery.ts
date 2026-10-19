import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
export interface FormSubmitSubmission { action: string; fields: Record<string, string>; }
@Injectable({ providedIn: 'root' })
export class FormSubmitDelivery {
  private readonly document = inject(DOCUMENT);
  submit(submission: FormSubmitSubmission): void {
    const action = new URL(submission.action);
    if (action.origin !== 'https://formsubmit.co' || action.pathname.startsWith('/ajax/')) throw new Error('Destino FormSubmit inválido');
    const form = this.document.createElement('form');
    form.method = 'POST'; form.action = action.href; form.target = '_self'; form.hidden = true;
    for (const [name, value] of Object.entries(submission.fields)) {
      const input = this.document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.appendChild(input);
    }
    this.document.body.appendChild(form);
    try { form.submit(); } finally { form.remove(); }
  }
}
