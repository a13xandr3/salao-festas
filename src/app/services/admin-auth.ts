import { inject, Injectable, signal, computed } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { firstValueFrom } from 'rxjs';
import { SiteConfig } from './site-config';

type LoginStage = 'credentials' | 'totp' | 'enroll' | 'authenticated';

/** Mantém a sessão em memória; allowlist e AAL2 são verificados no servidor. */
@Injectable({ providedIn: 'root' })
export class AdminAuth {
  private readonly settings = inject(SiteConfig);
  private clientPromise?: Promise<SupabaseClient>;
  private factorId = '';
  private readonly currentStage = signal<LoginStage>('credentials');
  private readonly currentEnrollment = signal<{ qrCode: string; secret: string } | null>(null);
  private readonly currentEmail = signal('');
  readonly stage = this.currentStage.asReadonly();
  readonly enrollment = this.currentEnrollment.asReadonly();
  readonly email = this.currentEmail.asReadonly();
  readonly authorized = computed(() => this.stage() === 'authenticated');

  private client(): Promise<SupabaseClient> {
    this.clientPromise ??= firstValueFrom(this.settings.config$).then(config => {
      const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
      });
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' || !session) this.clear();
      });
      return client;
    }).catch(error => {
      this.clientPromise = undefined;
      throw error;
    });
    return this.clientPromise;
  }

  async signIn(email: string, password: string): Promise<void> {
    this.clear();
    const client = await this.client();
    const login = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (login.error) throw login.error;
    try {
      const eligible = await client.rpc('booking_admin_eligible');
      if (eligible.error || eligible.data !== true) throw new Error('Acesso restrito.');
      this.currentEmail.set(login.data.user.email ?? email.trim());
      await this.prepareFactor(client);
    } catch (error) {
      await this.signOut();
      throw error;
    }
  }

  /** Reutiliza TOTP verificado e remove apenas cadastros TOTP ainda não concluídos. */
  private async prepareFactor(client: SupabaseClient): Promise<void> {
    const factors = await client.auth.mfa.listFactors();
    if (factors.error) throw factors.error;
    const verified = factors.data.totp.find(factor => factor.status === 'verified');
    if (verified) {
      this.factorId = verified.id;
      this.currentStage.set('totp');
      return;
    }
    for (const factor of factors.data.all.filter(factor => factor.factor_type === 'totp' && factor.status === 'unverified')) {
      const removed = await client.auth.mfa.unenroll({ factorId: factor.id });
      if (removed.error) throw removed.error;
    }
    const enrolled = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Espaço TX', issuer: 'Espaço TX' });
    if (enrolled.error) throw enrolled.error;
    this.factorId = enrolled.data.id;
    this.currentEnrollment.set({ qrCode: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret });
    this.currentStage.set('enroll');
  }

  async verify(code: string): Promise<void> {
    if (!this.factorId || !/^\d{6}$/.test(code)) throw new Error('Código inválido.');
    const client = await this.client();
    const verified = await client.auth.mfa.challengeAndVerify({ factorId: this.factorId, code });
    if (verified.error) throw verified.error;
    try {
      await this.checkAccess(client);
      this.currentEnrollment.set(null);
      this.factorId = '';
      this.currentStage.set('authenticated');
    } catch (error) {
      await this.signOut();
      throw error;
    }
  }

  private async checkAccess(client: SupabaseClient): Promise<void> {
    const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error || assurance.data.currentLevel !== 'aal2') throw new Error('Segundo fator obrigatório.');
    const access = await client.rpc('booking_admin_access');
    if (access.error || access.data !== true) throw new Error('Acesso restrito.');
  }

  /** Libera o cliente para operações de dados somente após concluir o fluxo de MFA. */
  async runAuthorized<T>(operation: (client: SupabaseClient) => Promise<T>): Promise<T> {
    if (!this.authorized()) throw new Error('Acesso restrito.');
    return operation(await this.client());
  }

  async signOut(): Promise<void> {
    this.clear();
    const client = await this.client();
    const result = await client.auth.signOut({ scope: 'local' });
    if (result.error) throw result.error;
  }

  private clear(): void {
    this.currentStage.set('credentials');
    this.currentEnrollment.set(null);
    this.currentEmail.set('');
    this.factorId = '';
  }
}
