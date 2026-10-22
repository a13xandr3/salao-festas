import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AdminAuth, AdminList, AdminListRow } from '../../services/admin-auth';

@Component({
  selector: 'app-painel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './painel.html',
  imports: [DatePipe],
})
export class Painel {
  protected readonly auth = inject(AdminAuth);
  protected readonly statusLabels: Record<string, string> = { pending_payment: 'Aguardando pagamento', confirmed: 'Reservado', cancelled: 'Cancelado' };
  readonly busy = input(false);
  readonly signOut = output<void>();
  protected readonly selectedList = signal<AdminList | null>(null);
  protected readonly rows = signal<AdminListRow[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  protected async load(type: AdminList): Promise<void> {
    if (this.busy() || this.loading() || !this.auth.authorized()) return;
    this.selectedList.set(type);
    this.rows.set([]);
    this.error.set('');
    this.loading.set(true);
    try {
      this.rows.set(await this.auth.list(type));
    } catch {
      this.error.set('Não foi possível carregar a lista. Tente novamente.');
    } finally {
      this.loading.set(false);
    }
  }
}
