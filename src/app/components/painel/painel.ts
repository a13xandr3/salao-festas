import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AdminAuth, AdminList, AdminListRow } from '../../services/admin-auth';

@Component({
  selector: 'app-painel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './painel.html',
  styleUrl: './painel.scss',
  imports: [DatePipe],
})
export class Painel {
  protected readonly auth = inject(AdminAuth);
  protected readonly year = new Date().getFullYear();
  protected readonly listTitles: Record<AdminList, string> = {
    contacts: 'Lista de contatos',
    preReservations: 'Lista de pré-reservas',
    pre_reservas_canceladas: 'Cancelados',
  };
  protected readonly listIds: Record<AdminList, string> = {
    contacts: 'lista-contatos',
    preReservations: 'lista-pre-reservas',
    pre_reservas_canceladas: 'lista-cancelados',
  };
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
