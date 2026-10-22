import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AdminAuth } from '../../services/admin-auth';
import { Painel } from '../painel/painel';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Painel],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  protected readonly auth = inject(AdminAuth);
  private readonly fb = inject(FormBuilder);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly credentials = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    password: ['', [Validators.required, Validators.maxLength(128)]],
  });
  protected readonly secondFactor = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  protected async signIn(): Promise<void> {
    this.credentials.markAllAsTouched();
    if (this.credentials.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const { email, password } = this.credentials.getRawValue();
      await this.auth.signIn(email, password);
    } catch {
      this.error.set('Não foi possível entrar. Confira as credenciais e sua conexão. Se houver muitas tentativas, aguarde antes de tentar novamente.');
    } finally {
      this.credentials.controls.password.reset();
      this.busy.set(false);
    }
  }

  protected async verify(): Promise<void> {
    this.secondFactor.markAllAsTouched();
    if (this.secondFactor.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.verify(this.secondFactor.controls.code.value);
    } catch {
      this.error.set('Não foi possível validar o acesso. Confira o código atual do Authenticator e tente novamente.');
    } finally {
      this.secondFactor.reset();
      this.busy.set(false);
    }
  }

  protected async signOut(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.signOut();
    } catch {
      this.error.set('Não foi possível concluir a saída no servidor. Feche esta aba para descartar a sessão deste navegador.');
    } finally {
      this.secondFactor.reset();
      this.busy.set(false);
    }
  }
}
