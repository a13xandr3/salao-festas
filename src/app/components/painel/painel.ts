import { GalleryAdmin } from '../gallery-admin/gallery-admin';
import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { CashFlow } from '../cash-flow/cash-flow';
import { DatePipe } from '@angular/common';
import { AdminAuth } from '../../services/admin-auth';
import { AdminData, AdminList, AdminListRow } from '../../services/admin-data';

/** Listas do painel; relatórios financeiros ficam nas abas do cash-flow. */
type PanelList = Exclude<AdminList, 'pre_reservas_canceladas'>;

/** Organiza a navegação administrativa e as consultas de contatos e reservas. */
@Component({
  selector: 'app-painel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './painel.html',
  styleUrl: './painel.scss',
  imports: [DatePipe, CashFlow, GalleryAdmin],
})
export class Painel {
  protected readonly auth = inject(AdminAuth);
  private readonly api = inject(AdminData);
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
  protected readonly galleryOpen = signal(false);
  protected readonly galleryBusy = signal(false);
  protected readonly financeOpen = signal(false);
  protected readonly financeBusy = signal(false);
  protected readonly error = signal('');

  /** Abre o financeiro quando a sessão está autorizada e não há operação em andamento. */
  protected openFinance(): void {
    if (this.busy() || this.loading() || this.financeBusy() || this.galleryBusy() || !this.auth.authorized()) return;
    this.selectedList.set(null);
    this.error.set('');
    this.galleryOpen.set(false);
    this.financeOpen.set(true);
  }

  protected openGallery(): void {
    if (this.busy() || this.loading() || this.financeBusy() || this.galleryBusy() || !this.auth.authorized()) return;
    this.selectedList.set(null); this.financeOpen.set(false); this.error.set(''); this.galleryOpen.set(true);
  }

  /** Consulta a lista administrativa escolhida e apresenta os dados ou uma mensagem de erro. */
  protected async load(type: PanelList): Promise<void> {
    if (this.busy() || this.loading() || this.financeBusy() || this.galleryBusy() || !this.auth.authorized()) return;
    this.galleryOpen.set(false);
    this.financeOpen.set(false);
    this.selectedList.set(type);
    this.rows.set([]);
    this.error.set('');
    this.loading.set(true);
    try {
      this.rows.set(await this.api.list(type));
    } catch {
      this.error.set('Não foi possível carregar a lista. Tente novamente.');
    } finally {
      this.loading.set(false);
    }
  }
}
