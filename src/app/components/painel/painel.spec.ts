import { signal } from '@angular/core';
import { DeferBlockState } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { AdminAuth } from '../../services/admin-auth';
import { Painel } from './painel';

describe('Painel', () => {
  it('requires authorization and emits logout only from the authorized view', () => {
    const authorized = signal(false);
    TestBed.configureTestingModule({ imports: [Painel], providers: [{ provide: AdminAuth, useValue: { authorized, email: () => '<img src=x onerror=alert(1)>' } }] });
    const fixture = TestBed.createComponent(Painel); fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h1')).toBeNull(); expect(element.querySelector('[role=alert]')).not.toBeNull();
    authorized.set(true); fixture.detectChanges();
    expect(element.querySelector('h1')!.textContent).toBe('Painel');
    expect(element.querySelectorAll('img')).toHaveLength(1);
    expect(element.querySelector('img')!.getAttribute('src')).toBe('images/familia-tx-96.png'); expect(element.textContent).toContain('<img src=x onerror=alert(1)>');
    const emit = jest.fn(); fixture.componentInstance.signOut.subscribe(emit);
    const button = element.querySelector<HTMLButtonElement>('button')!;
    expect(button.textContent).toBe('Logout');
    expect(button.classList.contains('ms-auto')).toBe(true);
    button.click(); expect(emit).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('busy', true); fixture.detectChanges(); expect(button.disabled).toBe(true);
    authorized.set(false); fixture.detectChanges(); expect(element.querySelector('button')).toBeNull();
  });
  function setup() {
    const authorized = signal(true);
    const auth = { authorized, email: () => 'admin@example.com', list: jest.fn().mockResolvedValue([]), finance: jest.fn().mockRejectedValue(new Error('offline')) };
    TestBed.configureTestingModule({ imports: [Painel], providers: [{ provide: AdminAuth, useValue: auth }] });
    const fixture = TestBed.createComponent(Painel); fixture.detectChanges();
    return { fixture, auth, component: fixture.componentInstance, element: fixture.nativeElement as HTMLElement };
  }
  it('navigates to contacts and pre-reservations without reloading the authenticated page', async () => {
    const { fixture, auth, element } = setup();
    const links = element.querySelectorAll<HTMLAnchorElement>('nav a');
    expect(Array.from(links, link => link.textContent)).toEqual(['Contatos', 'Pré-reservas', 'Cancelados', 'Financeiro']);
    expect(auth.list).not.toHaveBeenCalled();
    expect(element.querySelector('.panel-empty')!.textContent).toContain('Aqui será exibido o resultado');
    expect(element.querySelector('.panel-footer')!.textContent).toContain('Desenvolvido por Alexandre Esteves Alves');
    expect(element.querySelector('.panel-footer')!.textContent).toContain(String(new Date().getFullYear()));
    auth.list.mockResolvedValueOnce([{ id: 'contact', name: 'Cliente', email: 'client@example.com', phone: '11999999999', message: '<img src=x onerror=alert(1)>', createdAt: '2026-10-22T15:00:00Z' }]);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true }); links[0].dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    await fixture.whenStable(); fixture.detectChanges();
    expect(element.querySelector('.panel-empty')).toBeNull();
    expect(element.querySelector('.panel-results #lista-contatos')).not.toBeNull(); expect(links[0].getAttribute('aria-current')).toBe('page');
    expect(element.querySelector('tbody')!.textContent).toContain('<img src=x onerror=alert(1)>'); expect(element.querySelectorAll('img')).toHaveLength(1);
    expect(element.querySelector('img')!.getAttribute('src')).toBe('images/familia-tx-96.png');
    expect(element.querySelector('tbody')!.textContent).toContain('22/10/2026 12:00');
    auth.list.mockResolvedValueOnce([{ id: 'reservation', name: 'Cliente', email: 'client@example.com', phone: '11999999999', startDate: '2026-10-25', endDate: '2026-10-26', status: 'pending_payment', createdAt: '2026-10-22T15:00:00Z' }]);
    links[1].click(); await fixture.whenStable(); fixture.detectChanges();
    expect(auth.list).toHaveBeenLastCalledWith('preReservations');
    expect(element.querySelector('#lista-pre-reservas')).not.toBeNull(); expect(element.querySelector('#lista-contatos')).toBeNull();
    expect(element.querySelector('tbody')!.textContent).toContain('25/10/2026 a 26/10/2026');
    expect(element.querySelector('tbody')!.textContent).toContain('Aguardando pagamento');
  });
  it('opens the financial view and prevents leaving it during a financial write', async () => {
    const { fixture, auth, component, element } = setup();
    auth.authorized.set(false); component['openFinance'](); expect(component['financeOpen']()).toBe(false);
    auth.authorized.set(true); fixture.componentRef.setInput('busy', true); component['openFinance'](); expect(component['financeOpen']()).toBe(false);
    fixture.componentRef.setInput('busy', false); component['loading'].set(true); component['openFinance'](); expect(component['financeOpen']()).toBe(false);
    component['loading'].set(false);
    element.querySelector<HTMLAnchorElement>('a[href="#financeiro"]')!.click(); fixture.detectChanges();
    for (const block of await fixture.getDeferBlocks()) await block.render(DeferBlockState.Complete);
    await fixture.whenStable(); fixture.detectChanges();
    expect(element.querySelector('app-cash-flow')).not.toBeNull();
    component['financeBusy'].set(true); fixture.detectChanges();
    expect(element.querySelector<HTMLButtonElement>('.panel-logout')!.disabled).toBe(true);
    component['openFinance'](); await component['load']('contacts'); expect(auth.list).not.toHaveBeenCalled();
    component['financeBusy'].set(false); await component['load']('contacts'); fixture.detectChanges();
    expect(element.querySelector('app-cash-flow')).toBeNull();
  });
  it('loads cancelled reservations from the Supabase view in the central area', async () => {
    const { fixture, auth, element } = setup();
    auth.list.mockResolvedValueOnce([{
      id: 'cancelled', name: 'Cliente cancelado', email: 'cancelled@example.com', phone: '11999999999',
      startDate: '2026-10-25', endDate: '2026-10-26', status: 'cancelled', createdAt: '2026-10-22T15:00:00Z',
    }]);
    const link = element.querySelector<HTMLAnchorElement>('a[href="#lista-cancelados"]')!;
    link.click(); await fixture.whenStable(); fixture.detectChanges();
    expect(auth.list).toHaveBeenCalledWith('pre_reservas_canceladas');
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(element.querySelector('.panel-results #lista-cancelados h2')!.textContent).toBe('Cancelados');
    expect(element.querySelector('tbody')!.textContent).toContain('Cliente cancelado');
    expect(element.querySelector('tbody')!.textContent).toContain('Cancelado');
    expect(element.querySelector('tbody')!.textContent).toContain('25/10/2026 a 26/10/2026');
    expect(element.querySelector('.panel-empty')).toBeNull();
  });
  it('shows loading and empty states, blocks overlapping requests and honors logout activity', async () => {
    const { fixture, auth, component, element } = setup();
    fixture.componentRef.setInput('busy', true); await component['load']('contacts'); expect(auth.list).not.toHaveBeenCalled();
    fixture.componentRef.setInput('busy', false);
    let finish!: (rows: []) => void;
    auth.list.mockImplementationOnce(() => new Promise<[]>(resolve => { finish = resolve; }));
    const pending = component['load']('contacts'); fixture.detectChanges();
    expect(element.querySelector('[role=status]')!.textContent).toContain('Carregando');
    expect(element.querySelector('nav a')!.getAttribute('aria-disabled')).toBe('true');
    await component['load']('preReservations'); expect(auth.list).toHaveBeenCalledTimes(1);
    finish([]); await pending; fixture.detectChanges();
    expect(element.querySelector('[role=status]')!.textContent).toContain('Nenhum registro');
    auth.authorized.set(false); await component['load']('contacts'); expect(auth.list).toHaveBeenCalledTimes(1);
  });
  it('clears prior rows on failure and allows retrying without exposing server errors', async () => {
    const { fixture, auth, component, element } = setup();
    auth.list.mockRejectedValueOnce(new Error('private database details'));
    await component['load']('contacts'); fixture.detectChanges();
    expect(element.querySelector('[role=alert]')!.textContent).toContain('Não foi possível carregar');
    expect(element.textContent).not.toContain('private database details');
    expect(element.querySelector('table')).toBeNull();
    await component['load']('contacts'); fixture.detectChanges();
    expect(element.querySelector('[role=alert]')).toBeNull(); expect(element.querySelector('[role=status]')!.textContent).toContain('Nenhum registro');
  });
});
