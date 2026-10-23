import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { AdminAuth } from '../../services/admin-auth';
import { FinanceDashboard, FinanceReservation } from '../../services/finance.models';
import { CashFlow, entryRequirements, financeError } from './cash-flow';

const id = '00000000-0000-4000-8000-000000000001';
const reservation: FinanceReservation = { reservationId: id, name: '<img src=x onerror=alert(1)>', startDate: '2026-10-25', endDate: '2026-10-27', status: 'pending_payment', stayDays: 2, dailyRate: 400, totalAmount: 800, received: 0, refunded: 0, amountDue: 800, refundableAmount: 0 };
function dashboard(): FinanceDashboard {
  return {
    summary: { openingBalance: 100, income: 800, expenses: 50, closingBalance: 850, amountDue: 800, unpricedCount: 1, unreconciledCount: 1 },
    transactions: [{ id: 'entry', reservationId: id, name: 'Cliente', kind: 'receipt', category: 'locacao', amount: 800, signedAmount: 800, occurredOn: '2026-10-22', createdAt: '2026-10-22T15:00:00Z', createdBy: id, description: '<script>alert(1)</script>', externalReference: 'PIX-1' }],
    reservations: [reservation, { ...reservation, reservationId: 'old', totalAmount: null }, { ...reservation, reservationId: 'cancelled', status: 'cancelled', amountDue: 0, received: 300, refundableAmount: 300 }],
    transactionCount: 60, reservationCount: 60,
  };
}
describe('finance validation', () => {
  it.each([
    ['receipt', '', '', 'reservationRequired'], ['refund', '', '', 'reservationRequired'],
    ['receipt', id, '', 'referenceRequired'], ['receipt', id, '   ', 'referenceRequired'],
    ['receipt', id, 'PIX-1', null], ['refund', id, '', null], ['expense', '', '', null],
  ])('requires the appropriate protocol and bank reference: %s %s %s', (kind, reservationId, reference, error) => {
    const form = new FormGroup({ kind: new FormControl(kind), reservationId: new FormControl(reservationId), reference: new FormControl(reference) });
    expect(entryRequirements(form)).toEqual(error ? { [error]: true } : null);
  });
  it('only exposes friendly errors intentionally emitted by the financial functions', () => {
    for (const code of ['PT400','PT404','PT409']) expect(financeError({ code, message: 'Confira o saldo' })).toBe('Confira o saldo');
    for (const error of [null, undefined, {}, { code: 'PT404' }, { code: '42P01', message: 'private sql details' }]) {
      expect(financeError(error)).toContain('Não foi possível'); expect(financeError(error)).not.toContain('private sql details');
    }
  });
});
describe('CashFlow', () => {
  async function setup(response = dashboard()) {
    const auth = { finance: jest.fn().mockImplementation((action: string) => Promise.resolve(action === 'dashboard' ? response : { id: 'saved' })) };
    TestBed.configureTestingModule({ imports: [CashFlow], providers: [{ provide: AdminAuth, useValue: auth }] });
    const fixture = TestBed.createComponent(CashFlow); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, auth, element: fixture.nativeElement as HTMLElement };
  }
  function validEntry(component: CashFlow) {
    component['entry'].setValue({ kind: 'receipt', reservationId: id, amount: '400,00', occurredOn: component['today'], description: ' Pagamento ', reference: ' PIX-1 ', category: 'locacao' });
  }
  it('loads the monthly summary, warns about legacy records and escapes transaction data', async () => {
    const { component, auth, element, fixture } = await setup();
    expect(auth.finance).toHaveBeenCalledWith('dashboard', { p_month: component['today'].slice(0, 7), p_page: 0, p_reservation_page: 0 });
    expect(element.querySelector('[aria-label="Resumo financeiro"]')!.textContent).toContain('850,00');
    expect(element.textContent).toContain('total a receber está incompleto');
    expect(element.textContent).toContain('confirmada(s) sem recebimento integral');
    expect(element.querySelector('tbody')!.textContent).toContain('<script>alert(1)</script>'); expect(element.querySelector('script')).toBeNull();
    const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>('nav button'));
    buttons[1].click(); fixture.detectChanges();
    expect(element.querySelector('tbody')!.textContent).toContain('Não definido'); expect(element.querySelector('tbody')!.textContent).toContain('Cancelada');
    expect(element.querySelector('img')).toBeNull();
    element.querySelector<HTMLButtonElement>('button.btn-sm')!.click(); fixture.detectChanges();
    expect(component['editing']()).toBe('entry');
    buttons[0].click(); fixture.detectChanges(); expect(component['tab']()).toBe('transactions');
  });
  it('handles empty results, invalid periods, failed reads and disables concurrent refresh', async () => {
    const empty = dashboard(); empty.transactions = []; empty.reservations = []; empty.summary.unpricedCount = 0; empty.summary.unreconciledCount = 0;
    const { component, fixture, element, auth } = await setup(empty);
    expect(element.textContent).toContain('Nenhuma movimentação'); component['tab'].set('reservations'); fixture.detectChanges(); expect(element.textContent).toContain('Nenhuma reserva');
    component['period'].controls.month.setValue('bad'); await component['refresh'](); expect(auth.finance).toHaveBeenCalledTimes(1);
    component['period'].controls.month.setValue('2026-10');
    component['saving'].set(true); await component['refresh'](); component['saving'].set(false);
    fixture.componentRef.setInput('disabled', true); await component['refresh'](); fixture.componentRef.setInput('disabled', false);
    let fail!: (error: Error) => void;
    auth.finance.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const pending = component['refresh'](); fixture.detectChanges();
    expect(element.querySelector('[role=status]')!.textContent).toContain('Consultando'); await component['refresh']();
    fail(new Error('network')); await pending; fixture.detectChanges();
    expect(component['snapshot']()).toBeNull(); expect(element.querySelector('[role=alert]')!.textContent).toContain('Não foi possível');
  });
  it('paginates both lists and resets pages when applying another month', async () => {
    const { component, auth, fixture } = await setup();
    await component['changePage']('transactions', 1); expect(component['page']()).toBe(1);
    await component['changePage']('reservations', 1); expect(component['reservationPage']()).toBe(1);
    expect(auth.finance).toHaveBeenLastCalledWith('dashboard', expect.objectContaining({ p_page: 1, p_reservation_page: 1 }));
    component['loading'].set(true); await component['changePage']('transactions', 1); component['loading'].set(false);
    component['saving'].set(true); await component['changePage']('transactions', 1); component['saving'].set(false);
    fixture.componentRef.setInput('disabled', true); await component['changePage']('transactions', 1); fixture.componentRef.setInput('disabled', false);
    expect(component['page']()).toBe(1);
    await component['applyPeriod'](); expect(component['page']()).toBe(0); expect(component['reservationPage']()).toBe(0);
    await component['changePage']('transactions', -1); expect(component['page']()).toBe(0);
  });
  it('prepares receipts, refunds and legacy price forms without guessing historical prices', async () => {
    const { component, fixture, element } = await setup();
    component['prepare'](reservation, 'receipt'); fixture.detectChanges();
    expect(component['entry'].controls.amount.value).toBe('800'); expect(element.querySelector('#finance-entry')).not.toBeNull();
    component['prepare']({ ...reservation, refundableAmount: 300 }, 'refund'); expect(component['entry'].controls.amount.value).toBe('300'); expect(component['entry'].controls.kind.value).toBe('refund');
    component['prepare']({ ...reservation, totalAmount: null }, 'price'); fixture.detectChanges();
    expect(component['price'].getRawValue()).toEqual({ reservationId: id, dailyRate: '' }); expect(element.querySelector('#finance-daily-rate')).not.toBeNull();
    element.querySelector<HTMLButtonElement>('form.finance-form button[type=button]')!.click(); fixture.detectChanges(); expect(component['editing']()).toBeNull();
  });
  it('registers receipts once, normalizes decimals and reloads the actual payment month', async () => {
    const { component, auth, fixture, element } = await setup();
    component['editing'].set('entry'); await component['submitEntry'](); expect(auth.finance).toHaveBeenCalledTimes(1);
    validEntry(component);
    const events: boolean[] = []; component.writing.subscribe(value => events.push(value));
    let finish!: () => void;
    auth.finance.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = component['submitEntry'](); fixture.detectChanges();
    expect(component['saving']()).toBe(true); await component['submitEntry'](); expect(auth.finance).toHaveBeenCalledTimes(2);
    finish(); await pending; fixture.detectChanges();
    expect(events).toEqual([true, false]);
    expect(auth.finance).toHaveBeenCalledWith('post', { p_input: expect.objectContaining({ amount: '400.00', description: 'Pagamento', reference: 'PIX-1', reservationId: id, key: expect.any(String) }) });
    expect(component['entry'].controls.amount.value).toBe(''); expect(component['editing']()).toBeNull();
    expect(element.textContent).toContain('Movimentação registrada'); expect(component['saving']()).toBe(false);
  });
  it('reuses the same idempotency key after a failed request, but not for a changed intent', async () => {
    const { component, auth } = await setup(); validEntry(component);
    const original = auth.finance.getMockImplementation()!;
    auth.finance.mockImplementation((action: string, args: unknown) => action === 'post' ? Promise.reject({ code: 'PT409', message: 'Referência já utilizada.' }) : original(action, args));
    await component['submitEntry'](); await component['submitEntry']();
    const writes = () => auth.finance.mock.calls.filter(call => call[0] === 'post').map(call => call[1] as any);
    expect(writes()[0].p_input.key).toBe(writes()[1].p_input.key); expect(component['error']()).toBe('Referência já utilizada.');
    component['entry'].controls.amount.setValue('500'); await component['submitEntry']();
    expect(writes()[2].p_input.key).not.toBe(writes()[1].p_input.key);
    expect(component['entry'].controls.amount.value).toBe('500');
  });
  it('honors loading and external locks when submitting entries and prices', async () => {
    const { component, auth, fixture } = await setup(); validEntry(component); component['price'].setValue({ reservationId: id, dailyRate: '250' });
    for (const lock of ['loading', 'saving'] as const) {
      component[lock].set(true); await component['submitEntry'](); await component['submitPrice'](); component[lock].set(false);
    }
    fixture.componentRef.setInput('disabled', true); await component['submitEntry'](); await component['submitPrice']();
    expect(auth.finance).toHaveBeenCalledTimes(1);
  });
  it('validates legacy prices, writes the agreed daily rate and preserves data on rejection', async () => {
    const { component, auth, fixture, element } = await setup();
    component['editing'].set('price'); await component['submitPrice'](); fixture.detectChanges();
    expect(element.querySelector('[role=alert]')!.textContent).toContain('protocolo válido');
    component['price'].setValue({ reservationId: id, dailyRate: '250,00' });
    auth.finance.mockRejectedValueOnce({ code: 'PT409', message: 'Valor já definido.' }); await component['submitPrice'](); expect(component['price'].controls.dailyRate.value).toBe('250,00');
    await component['submitPrice'](); fixture.detectChanges();
    expect(auth.finance).toHaveBeenCalledWith('price', { p_id: id, p_daily_rate: '250.00' });
    expect(component['notice']()).toBe('Valor contratado registrado.'); expect(component['price'].controls.dailyRate.value).toBe('');
  });
  it('supports the actual register and price form submit events', async () => {
    const { component, fixture, element } = await setup();
    const entryButton = Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Registrar movimentação')!;
    component['notice'].set('Anterior'); component['error'].set('Anterior');
    entryButton.click(); fixture.detectChanges();
    expect(component['notice']()).toBe(''); expect(component['error']()).toBe('');
    validEntry(component);
    element.querySelector('#finance-entry')!.dispatchEvent(new Event('submit', { cancelable: true })); await fixture.whenStable(); fixture.detectChanges(); expect(component['notice']()).toBe('Movimentação registrada.');
    Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Definir valor contratado')!.click(); fixture.detectChanges();
    component['price'].setValue({ reservationId: id, dailyRate: '250' });
    element.querySelector('form.finance-form')!.dispatchEvent(new Event('submit', { cancelable: true })); await fixture.whenStable(); fixture.detectChanges(); expect(component['notice']()).toBe('Valor contratado registrado.');
    element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await fixture.whenStable();
  });
});
