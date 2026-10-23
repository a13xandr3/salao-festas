import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { CashFlow } from '../cash-flow/cash-flow';
import { DatePipe } from '@angular/common';
import { AdminAuth, AdminList, AdminListRow } from '../../services/admin-auth';

type PanelList = Exclude<AdminList, 'pre_reservas_canceladas'>;

@Component({
  selector: 'app-painel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './painel.html',
  styleUrl: './painel.scss',
  imports: [DatePipe, CashFlow],
})
export class Painel {
  protected readonly auth = inject(AdminAuth);
  protected readonly year = new Date().getFullYear();
  protected readonly listTitles: Record<PanelList, string> = {
    contacts: 'Lista de contatos',
    preReservations: 'Lista de pré-reservas',
  };
  protected readonly listIds: Record<PanelList, string> = {
    contacts: 'lista-contatos',
    preReservations: 'lista-pre-reservas',
  };
  protected readonly statusLabels: Record<string, string> = { pending_payment: 'Aguardando pagamento', confirmed: 'Reservado', cancelled: 'Cancelado' };
  readonly busy = input(false);
  readonly signOut = output<void>();
  protected readonly selectedList = signal<PanelList | null>(null);
  protected readonly rows = signal<AdminListRow[]>([]);
  protected readonly loading = signal(false);
  protected readonly financeOpen = signal(false);
  protected readonly financeBusy = signal(false);
  protected readonly error = signal('');

  protected openFinance(): void {
    if (this.busy() || this.loading() || this.financeBusy() || !this.auth.authorized()) return;
    this.selectedList.set(null);
    this.error.set('');
    this.financeOpen.set(true);
  }

  protected async load(type: PanelList): Promise<void> {
    if (this.busy() || this.loading() || this.financeBusy() || !this.auth.authorized()) return;
    this.financeOpen.set(false);
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
