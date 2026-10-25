/** Testa abas, validações, recebimentos, despesas e reprovações com serviços simulados. */
import { TestBed } from '@angular/core/testing';
import { AdminData } from '../../services/admin-data';
import { FinanceDashboard, FinanceReservation } from '../../services/finance.models';
import { CashFlow } from './cash-flow';
import { financeError } from '../../services/finance-utils';

const id = '00000000-0000-4000-8000-000000000001';
const reservation: FinanceReservation = { reservationId: id, name: '<img src=x onerror=alert(1)>', startDate: '2026-10-25', endDate: '2026-10-27', status: 'pending_payment', stayDays: 2, dailyRate: 400, totalAmount: 800, received: 0, refunded: 0, amountDue: 800, refundableAmount: 0 };
/** Monta o retorno financeiro fictício usado pelos testes. */
function dashboard(): FinanceDashboard {
  return {
    summary: { openingBalance: 100, income: 800, expenses: 50, closingBalance: 850, amountDue: 800, unpricedCount: 1, unreconciledCount: 1 },
    transactions: [{ id: 'entry', reservationId: id, name: 'Cliente', kind: 'receipt', category: 'locacao', amount: 800, signedAmount: 800, occurredOn: '2026-10-22', createdAt: '2026-10-22T15:00:00Z', createdBy: id, description: '<script>alert(1)</script>', externalReference: 'PIX-1' }],
    reservations: [reservation, { ...reservation, reservationId: 'old', totalAmount: null }, { ...reservation, reservationId: 'confirmed', status: 'confirmed', amountDue: 0, received: 300, refundableAmount: 300 }],
    transactionCount: 60, reservationCount: 60,
  };
}
describe('CashFlow', () => {
  /** Cria o componente com dependências simuladas para o teste. */
  async function setup(response = dashboard()) {
    const auth = { list: jest.fn().mockResolvedValue([]), finance: jest.fn().mockImplementation((action: string) => Promise.resolve(action === 'overview' ? response : { id: 'saved' })) };
    TestBed.configureTestingModule({ imports: [CashFlow], providers: [{ provide: AdminData, useValue: auth }] });
    const fixture = TestBed.createComponent(CashFlow); fixture.detectChanges();
    const dialog=fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    dialog.showModal=jest.fn(()=>dialog.setAttribute('open',''));dialog.close=jest.fn(()=>dialog.removeAttribute('open'));  await fixture.whenStable(); fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, auth, element: fixture.nativeElement as HTMLElement };
  }
  /** Preenche o formulário com uma despesa válida para o teste. */
  function expense(component: CashFlow) {
    component['entry'].setValue({ amount: '80,00', occurredOn: component['today'], description: ' Cloro ', category: 'limpeza' });
  }
  /** Preenche o formulário com uma negociação válida para o teste. */
  function price(component: CashFlow) {
    component['price'].setValue({ reservationId: id, dailyRate: '350,00', reason: ' Desconto combinado ' });
  }
  it('keeps the period and summary on every tab and refreshes the selected month', async () => {
    const {component, auth, fixture, element} = await setup();
    auth.finance.mockImplementation((action: string) => Promise.resolve(action === 'overview' ? dashboard() : {month:'2026-09',total:0,count:0,entries:[]}));
    for (const tab of ['reservations', 'price', 'entry', 'expenses', 'cancelled'] as const) {
      await component['selectTab'](tab); fixture.detectChanges();
      expect(element.querySelector('#finance-month')).not.toBeNull();
      expect(element.querySelectorAll('.finance-card')).toHaveLength(4);
    }
    component['period'].controls.month.setValue('2026-09');
    await component['applyPeriod']();
    expect(auth.finance).toHaveBeenLastCalledWith('overview', {p_month:'2026-09',p_reservation_page:0});
    expect(auth.list).toHaveBeenLastCalledWith('pre_reservas_canceladas', '2026-09');
    await component['selectTab']('expenses');
    await component['applyPeriod']();
    expect(auth.finance).toHaveBeenNthCalledWith(auth.finance.mock.calls.length - 1, 'overview', {p_month:'2026-09',p_reservation_page:0});
    expect(auth.finance).toHaveBeenLastCalledWith('expenses', {p_month:'2026-09',p_page:0});
  });
  it('masks money while typing, accepts pasted amounts and sends numeric values', async () => {
    const {component, auth, fixture, element} = await setup();
    for (const [tab, selector, control] of [
      ['entry', '#finance-amount', component['entry'].controls.amount],
      ['price', '#finance-daily-rate', component['price'].controls.dailyRate],
      ['reservations', '#finance-payment-amount', component['payment'].controls.amount],
    ] as const) {
      await component['selectTab'](tab);
      if (tab === 'reservations') component['openPayment'](reservation);
      fixture.detectChanges();
      const input = element.querySelector<HTMLInputElement>(selector)!;
      for (const [typed, expected] of [['1','0,01'],['12','0,12'],['123','1,23'],['R$ 1.234,56','1.234,56'],['abc',''],['',''],['0','0,00']]) {
        input.value = typed; input.dispatchEvent(new Event('input', {bubbles:true})); fixture.detectChanges();
        expect(input.value).toBe(expected); expect(control.value).toBe(expected);
      }
      expect(control.invalid).toBe(true);
    }
    await component['selectTab']('entry'); fixture.detectChanges(); expense(component);
    const input = element.querySelector<HTMLInputElement>('#finance-amount')!;
    input.value='1234';input.setSelectionRange(1,1);input.dispatchEvent(new Event('input',{bubbles:true}));
    expect(input.value).toBe('12,34');expect(input.selectionStart).toBe(1);
    input.value='0000';input.setSelectionRange(0,0);input.dispatchEvent(new Event('input',{bubbles:true}));
    expect(input.value).toBe('0,00');expect(input.selectionStart).toBe(0);
    const selection=jest.spyOn(input,'selectionStart','get').mockReturnValue(null);
    input.value = '123456'; input.dispatchEvent(new Event('input', {bubbles:true}));
    selection.mockRestore();
    await component['submitEntry']();
    expect(auth.finance).toHaveBeenCalledWith('post', {p_input:expect.objectContaining({amount:'1234.56'})});
  });
  it('only exposes intentionally friendly server errors', () => {
    for (const code of ['PT400','PT404','PT409']) expect(financeError({code, message:'Confira os dados'})).toBe('Confira os dados');
    for (const error of [null, undefined, {}, {code:'PT404'}, {code:'42P01', message:'sql'}]) expect(financeError(error)).toContain('Não foi possível');
  });
  it('starts with five clear tabs and only the requested reservation columns', async () => {
    const {component, auth, element, fixture} = await setup();
    expect(auth.finance).toHaveBeenCalledWith('overview', {p_month:component['today'].slice(0,7), p_reservation_page:0});
    expect(Array.from(element.querySelectorAll('[role=tab]')).map(el=>el.textContent?.trim())).toEqual(['Pré-Reservas/Reservas','Definir valor contratado','Registrar despesas','Despesas','Cancelados']);
    expect(Array.from(element.querySelectorAll('th')).map(el=>el.textContent)).toEqual(['Pré-reserva/Reserva','Início','Recebido','Status','Ações']);
    expect(element.textContent).toContain('Pendente'); expect(element.textContent).toContain('Parcial');
    expect(element.querySelector('img')).toBeNull(); expect(element.querySelector('.alert-warning')).toBeNull();
    expect(element.querySelectorAll('tbody tr')[1].querySelector<HTMLButtonElement>('button.btn-dark')!.disabled).toBe(true);
    const response=dashboard(); response.reservations=[{...reservation,status:'confirmed',received:800,amountDue:0}];
    component['snapshot'].set(response); fixture.detectChanges();
    expect(element.querySelector('tbody')!.textContent).toContain('Total'); expect(element.querySelector('tbody')!.textContent).toContain('Reserva confirmada');
    expect(element.querySelector<HTMLButtonElement>('tbody button')!.disabled).toBe(true);
    const reject=Array.from(element.querySelectorAll<HTMLButtonElement>('tbody button')).find(button=>button.textContent?.trim()==='Reprovar')!;
    expect(reject).toBeDefined();expect(reject.disabled).toBe(false);
    component['snapshot'].set({...response,reservations:[]}); fixture.detectChanges(); expect(element.textContent).toContain('Nenhuma pré-reserva');
  });
  it('shows monthly expenses and the server total above the table aligned to the right', async () => {
    const {component,fixture,element,auth}=await setup();
    const report={month:'2026-10',total:1000,count:60,entries:[{id:'expense-1',occurredOn:'2026-10-22',description:'Cloro para piscina',amount:80},{id:'expense-2',occurredOn:'2026-10-21',description:'Utensílios',amount:20}]};
    auth.finance.mockResolvedValueOnce(report);
    component['period'].controls.month.setValue('2026-10');
    await component['selectTab']('expenses');fixture.detectChanges();
    expect(auth.finance).toHaveBeenLastCalledWith('expenses',{p_month:'2026-10',p_page:0});
    expect(Array.from(element.querySelectorAll('th')).map(el=>el.textContent?.trim())).toEqual(['Data','Despesas','Valor','Ações']);
    const total=element.querySelector('p.text-end')!;expect(total.textContent).toContain('1.000,00');expect(total.textContent).toContain('10/2026');
    expect(total.compareDocumentPosition(element.querySelector('table')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(element.querySelector('tbody')!.textContent).toContain('22/10/2026');expect(element.querySelector('tbody')!.textContent).toContain('Cloro para piscina');expect(element.querySelector('tbody')!.textContent).toContain('80,00');
    auth.finance.mockResolvedValueOnce({...report,entries:[]});await component['changeExpensePage'](1);expect(component['expensePage']()).toBe(1);
    expect(auth.finance).toHaveBeenLastCalledWith('expenses',{p_month:'2026-10',p_page:1});
    component['period'].controls.month.setValue('2026-09');auth.finance.mockResolvedValueOnce(dashboard()).mockResolvedValueOnce({month:'2026-09',total:0,count:0,entries:[]});
    const apply=jest.spyOn(component as any,'applyPeriod');element.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));await apply.mock.results[0].value;fixture.detectChanges();
    expect(component['expensePage']()).toBe(0);expect(element.textContent).toContain('Nenhuma despesa registrada');expect(element.querySelector('p.text-end')!.textContent).toContain('09/2026');
    expect(auth.finance).toHaveBeenLastCalledWith('expenses',{p_month:'2026-09',p_page:0});
  });
  it('confirms expense exclusion and refreshes the monthly total and cash summary', async () => {
    const {component,auth,fixture,element}=await setup();
    const expense={id:'expense-id',occurredOn:'2026-10-22',description:'Cloro lançado por engano',amount:80};
    auth.finance.mockResolvedValueOnce({month:'2026-10',total:80,count:1,entries:[expense]});
    await component['selectTab']('expenses');fixture.detectChanges();
    const button=element.querySelector<HTMLButtonElement>('tbody button')!;
    expect(button.textContent).toBe('Excluir');expect(button.parentElement).toBe(element.querySelector('tbody tr')!.lastElementChild);
    button.click();fixture.detectChanges();expect(component['expenseToDelete']()).toEqual(expense);
    const confirmation=element.querySelector('[aria-label="Confirmar exclusão da despesa"]')!;
    expect(confirmation.textContent).toContain('Cloro lançado por engano');
    confirmation.querySelector<HTMLButtonElement>('button.btn-outline-dark')!.click();fixture.detectChanges();expect(component['expenseToDelete']()).toBeNull();
    button.click();fixture.detectChanges();component['expensePage'].set(1);
    const updated=dashboard();updated.summary.expenses=0;updated.summary.closingBalance=930;
    auth.finance.mockResolvedValueOnce({deleted:true}).mockResolvedValueOnce(updated).mockResolvedValueOnce({month:'2026-10',total:0,count:0,entries:[]});
    const deletion=jest.spyOn(component as any,'deleteExpense');
    element.querySelector<HTMLButtonElement>('[aria-label="Confirmar exclusão da despesa"] button.btn-danger')!.click();
    await deletion.mock.results[0].value;fixture.detectChanges();
    expect(auth.finance).toHaveBeenCalledWith('delete_expense',{p_id:'expense-id'});
    expect(component['expensePage']()).toBe(0);expect(component['expenseToDelete']()).toBeNull();
    expect(component['snapshot']()!.summary.expenses).toBe(0);expect(component['snapshot']()!.summary.closingBalance).toBe(930);
    expect(element.textContent).toContain('Despesa excluída.');expect(element.textContent).toContain('Nenhuma despesa registrada');expect(element.querySelector('p.text-end')!.textContent).toContain('0,00');
  });
  it('keeps the selected expense on rejection and prevents concurrent exclusions', async () => {
    const {component,auth,fixture}=await setup();
    await component['deleteExpense']();
    const expense={id:'expense-id',occurredOn:'2026-10-22',description:'Cloro',amount:80};component['expenseToDelete'].set(expense);
    for(const lock of ['loading','saving'] as const){component[lock].set(true);await component['deleteExpense']();component[lock].set(false);}
    fixture.componentRef.setInput('disabled',true);await component['deleteExpense']();fixture.componentRef.setInput('disabled',false);expect(auth.finance).toHaveBeenCalledTimes(1);
    auth.finance.mockRejectedValueOnce({code:'PT409',message:'Despesa não pode ser excluída.'});await component['deleteExpense']();
    expect(component['expenseToDelete']()).toEqual(expense);expect(component['error']()).toBe('Despesa não pode ser excluída.');
  });
  it('handles expense read failures, invalid periods and concurrent operations', async () => {
    const {component,auth,fixture}=await setup();
    component['period'].controls.month.setValue('bad');await component['refreshExpenses']();expect(auth.finance).toHaveBeenCalledTimes(1);
    component['period'].controls.month.setValue('2026-10');
    for(const lock of ['loading','saving'] as const){component[lock].set(true);await component['refreshExpenses']();await component['changeExpensePage'](1);component[lock].set(false);}
    fixture.componentRef.setInput('disabled',true);await component['refreshExpenses']();await component['changeExpensePage'](1);fixture.componentRef.setInput('disabled',false);
    expect(auth.finance).toHaveBeenCalledTimes(1);
    auth.finance.mockRejectedValueOnce(new Error('network'));await component['selectTab']('expenses');expect(component['expenses']()).toBeNull();expect(component['error']()).toContain('Não foi possível');
    auth.finance.mockResolvedValueOnce({month:'2026-10',total:0,count:0,entries:[]});await component['changeExpensePage'](-1);expect(component['expensePage']()).toBe(0);expect(component['error']()).toBe('');
  });
  it('keeps expenses accessible when the overview fails', async () => {
    const {component, auth, fixture, element} = await setup();
    auth.finance.mockRejectedValueOnce(new Error('overview unavailable'));
    await component['refresh'](); fixture.detectChanges();
    expect(component['snapshot']()).toBeNull();
    const expensesTab = Array.from(element.querySelectorAll<HTMLButtonElement>('[role=tab]'))
      .find(button => button.textContent?.trim() === 'Despesas')!;
    expect(expensesTab).toBeDefined();
    auth.finance.mockResolvedValueOnce({month:'2026-10',total:80,count:1,entries:[{id:'expense',occurredOn:'2026-10-22',description:'Cloro',amount:80}]});
    expensesTab.click(); await fixture.whenStable(); fixture.detectChanges();
    expect(element.querySelector('tbody')!.textContent).toContain('Cloro');
  });
  it('distinguishes a missing expense RPC from denied access', async () => {
    const {component, auth, fixture, element} = await setup();
    auth.finance.mockRejectedValueOnce({code:'PGRST202'});
    await component['selectTab']('expenses'); fixture.detectChanges();
    expect(element.querySelector('[role=alert]')!.textContent).toContain('202610230005_expense_report.sql');
    expect(element.textContent).not.toContain('Nenhuma despesa registrada');
    for (const code of ['PT403', '42501']) {
      auth.finance.mockRejectedValueOnce({code});
      await component['refreshExpenses']();
      expect(component['error']()).toContain('Sem permissão');
    }
  });
  it('loads cancelled bookings in its own tab and preserves rejection details', async () => {
    const {component,fixture,element,auth}=await setup();
    auth.list.mockResolvedValueOnce([{id:'cancelled-id',name:'Cliente cancelado',email:'cancel@example.com',phone:'11999999999',startDate:'2026-10-25',endDate:'2026-10-26',status:'cancelled',createdAt:'2026-10-22T15:00:00Z',rejectionReason:'Cliente desistiu',rejectedAt:'2026-10-23T15:00:00Z',rejectionRefundAmount:800}]);
    const select=jest.spyOn(component as any,'selectTab');
    Array.from(element.querySelectorAll<HTMLButtonElement>('[role=tab]')).find(button=>button.textContent?.trim()==='Cancelados')!.click();
    await select.mock.results[0].value;fixture.detectChanges();
    expect(auth.list).toHaveBeenCalledWith('pre_reservas_canceladas', component['period'].controls.month.value);
    const report=element.querySelector('#lista-cancelados')!;
    expect(report.textContent).toContain('Cliente cancelado');expect(report.textContent).toContain('Cliente desistiu');
    expect(report.textContent).toContain('23/10/2026 12:00');expect(report.textContent).toContain('800,00');
    expect(report.textContent).toContain('cancelled-id');expect(report.textContent).toContain('com início no mês selecionado');
    expect(element.querySelector('#finance-month')).not.toBeNull();expect(element.querySelectorAll('.finance-card')).toHaveLength(4);
    expect(report.querySelectorAll('tbody button')).toHaveLength(0);
    component['selectTab']('reservations');fixture.detectChanges();expect(element.querySelector('#lista-cancelados')).toBeNull();
    auth.list.mockResolvedValueOnce([]);await component['selectTab']('cancelled');fixture.detectChanges();
    expect(element.textContent).toContain('Nenhum registro cancelado');
  });
  it('supports retrying cancelled reads and respects operation locks', async () => {
    const {component,fixture,element,auth}=await setup();
    auth.list.mockRejectedValueOnce(new Error('offline'));await component['selectTab']('cancelled');fixture.detectChanges();
    expect(component['cancelled']()).toBeNull();expect(component['error']()).toContain('Não foi possível carregar os cancelados');
    const refresh=jest.spyOn(component as any,'refreshCancelled');
    Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(button=>button.textContent?.trim()==='Atualizar lista')!.click();
    await refresh.mock.results[0].value;expect(component['cancelled']()).toEqual([]);expect(component['error']()).toBe('');
    for(const lock of ['loading','saving'] as const){component[lock].set(true);await component['refreshCancelled']();component[lock].set(false);}
    fixture.componentRef.setInput('disabled',true);await component['refreshCancelled']();expect(auth.list).toHaveBeenCalledTimes(2);
  });
  it('changes one tab at a time, preserves drafts and blocks navigation while busy', async () => {
    const {component, fixture, element}=await setup();
    const tabs=element.querySelectorAll<HTMLButtonElement>('[role=tab]');
    tabs[2].click(); fixture.detectChanges(); expense(component);
    expect(element.querySelector('#finance-entry')).not.toBeNull(); expect(element.querySelector('table')).toBeNull();
    tabs[1].click(); fixture.detectChanges(); expect(element.querySelector('#finance-entry')).toBeNull();
    expect(element.querySelector('#finance-price-reason')).not.toBeNull();
    tabs[2].click(); fixture.detectChanges(); expect(component['entry'].controls.amount.value).toBe('80,00');
    for(const lock of ['loading','saving'] as const) {component[lock].set(true);component['selectTab']('reservations');expect(component['tab']()).toBe('entry');component[lock].set(false);}
    fixture.componentRef.setInput('disabled',true);component['selectTab']('reservations');expect(component['tab']()).toBe('entry');
    fixture.componentRef.setInput('disabled',false);element.querySelector<HTMLButtonElement>('form.finance-form button[type=button]')!.click();fixture.detectChanges();expect(component['tab']()).toBe('reservations');
  });
  it('handles invalid periods, concurrent requests, failures and pagination', async () => {
    const {component,auth,fixture,element}=await setup();
    component['period'].controls.month.setValue('bad');await component['refresh']();expect(auth.finance).toHaveBeenCalledTimes(1);
    component['period'].controls.month.setValue('2026-10');
    component['saving'].set(true);await component['refresh']();component['saving'].set(false);
    fixture.componentRef.setInput('disabled',true);await component['refresh']();fixture.componentRef.setInput('disabled',false);
    await component['changePage'](1);expect(component['reservationPage']()).toBe(1);
    for(const lock of ['loading','saving'] as const) {component[lock].set(true);await component['changePage'](1);component[lock].set(false);}
    fixture.componentRef.setInput('disabled',true);await component['changePage'](1);fixture.componentRef.setInput('disabled',false);
    await component['applyPeriod']();expect(component['reservationPage']()).toBe(0);await component['changePage'](-1);expect(component['reservationPage']()).toBe(0);
    let fail!:(error:Error)=>void;auth.finance.mockImplementationOnce(()=>new Promise((_,reject)=>{fail=reject;}));
    const pending=component['refresh']();await component['refresh']();fixture.detectChanges();expect(element.textContent).toContain('Consultando');
    fail(new Error('network'));await pending;fixture.detectChanges();expect(component['snapshot']()).toBeNull();expect(element.querySelector('[role=alert]')).not.toBeNull();
  });
  it('renders categories from the array and posts Aluguel Avulso exclusively as an expense', async () => {
    const {component,auth,fixture,element}=await setup();
    await component['selectTab']('entry');fixture.detectChanges();
    const select=element.querySelector<HTMLSelectElement>('#finance-category')!;
    expect(Array.from(select.options).map(option=>({value:option.value,label:option.textContent}))).toEqual(component['expenseCategories']);
    expect(Array.from(select.options).some(option=>option.value==='aluguel_avulso' && option.textContent==='Aluguel Avulso')).toBe(true);
    expense(component);select.value='aluguel_avulso';select.dispatchEvent(new Event('change'));
    component['entry'].controls.description.setValue('Aluguel avulso de utensílios');
    await component['submitEntry']();
    expect(auth.finance).toHaveBeenCalledWith('post',{p_input:expect.objectContaining({kind:'expense',category:'aluguel_avulso',amount:'80.00',description:'Aluguel avulso de utensílios'})});
  });
  it('records expenses with no receipt, protocol or payment controls, retaining idempotency on retry', async () => {
    const {component,auth,fixture,element}=await setup();component['selectTab']('entry');
    await component['submitEntry']();fixture.detectChanges();expect(element.textContent).toContain('Confira categoria');expense(component);
    const original=auth.finance.getMockImplementation()!;
    auth.finance.mockImplementation((action:string,args:unknown)=>action==='post'?Promise.reject({code:'PT409',message:'Falha'}):original(action,args));
    await component['submitEntry']();await component['submitEntry']();
    /** Obtém os lançamentos enviados ao serviço para conferir as tentativas do teste. */
    const writes=()=>auth.finance.mock.calls.filter(call=>call[0]==='post').map(call=>call[1] as any);
    expect(writes()[0].p_input.key).toBe(writes()[1].p_input.key);
    component['entry'].controls.amount.setValue('90');await component['submitEntry']();expect(writes()[2].p_input.key).not.toBe(writes()[1].p_input.key);
    auth.finance.mockImplementation(original);const events:boolean[]=[];component.writing.subscribe(value=>events.push(value));
    element.querySelector('#finance-entry')!.dispatchEvent(new Event('submit',{cancelable:true}));await fixture.whenStable();fixture.detectChanges();
    expect(auth.finance).toHaveBeenCalledWith('post',{p_input:expect.objectContaining({kind:'expense',amount:'90',description:'Cloro',category:'limpeza',key:expect.any(String)})});
    expect(writes().at(-1).p_input.reservationId).toBeUndefined();expect(events).toEqual([true,false]);expect(component['entry'].controls.amount.value).toBe('');expect(component['notice']()).toBe('Despesa registrada.');
  });
  it('negotiates prices with a reason and preserves rejected input', async () => {
    const {component,fixture,element,auth}=await setup();component['selectTab']('price');await component['submitPrice']();fixture.detectChanges();expect(element.textContent).toContain('motivo da negociação');price(component);
    auth.finance.mockRejectedValueOnce({code:'PT409',message:'Já recebido'});await component['submitPrice']();expect(component['price'].controls.dailyRate.value).toBe('350,00');
    element.querySelector('form.finance-form')!.dispatchEvent(new Event('submit',{cancelable:true}));await fixture.whenStable();fixture.detectChanges();
    expect(auth.finance).toHaveBeenCalledWith('negotiate',{p_id:id,p_daily_rate:'350.00',p_reason:'Desconto combinado'});expect(component['tab']()).toBe('reservations');expect(component['notice']()).toBe('Valor negociado registrado.');
  });
  it('honors all locks for form writes and confirmations', async () => {
    const {component,auth,fixture}=await setup();expense(component);price(component);
    await component['confirmReservation']();component['confirmation'].set({row:reservation});
    for(const lock of ['loading','saving'] as const) {component[lock].set(true);await component['submitEntry']();await component['submitPrice']();await component['confirmReservation']();component[lock].set(false);}
    fixture.componentRef.setInput('disabled',true);await component['submitEntry']();await component['submitPrice']();await component['confirmReservation']();expect(auth.finance).toHaveBeenCalledTimes(1);
  });
  it('keeps manual receipt input on failure and reuses its key only for the same payment', async () => {
    const { component, auth } = await setup();
    component['openPayment'](reservation);
    component['payment'].setValue({amount:'100,00',occurredOn:component['today'],reference:'PIX-100'});
    const original=auth.finance.getMockImplementation()!;
    auth.finance.mockImplementation((action:string,args:unknown)=>action==='approve'?Promise.reject({code:'PT409',message:'Confira o comprovante'}):original(action,args));
    await component['confirmReservation']();await component['confirmReservation']();
    /** Obtém os lançamentos enviados ao serviço para conferir as tentativas do teste. */
    const writes=()=>auth.finance.mock.calls.filter(call=>call[0]==='approve').map(call=>call[1] as any);
    expect(writes()[0].p_key).toBe(writes()[1].p_key);
    expect(component['payment'].controls.amount.value).toBe('100,00');
    expect(component['error']()).toBe('Confira o comprovante');
    component['payment'].controls.amount.setValue('200');await component['confirmReservation']();
    expect(writes()[2].p_key).not.toBe(writes()[1].p_key);
  });
  it('opens the rejection dialog to the right of Approve and records an unpaid cancellation with its reason', async () => {
    const { component, fixture, element, auth } = await setup();
    const buttons=Array.from(element.querySelectorAll<HTMLButtonElement>('tbody tr:first-child button'));
    expect(buttons.map(button=>button.textContent?.trim())).toEqual(['Aprovar','Reprovar']);
    buttons[1].click();fixture.detectChanges();
    expect(element.querySelector('dialog')!.hasAttribute('open')).toBe(true);
    await component['submitRejection']();expect(component['rejection'].invalid).toBe(true);
    component['rejection'].patchValue({reason:' Cliente desistiu ',checked:true});
    const updated=dashboard();updated.reservations=updated.reservations.filter(row=>row.reservationId!==id);
    auth.finance.mockResolvedValueOnce({cancelled:true}).mockResolvedValueOnce(updated);
    const submit=jest.spyOn(component as any,'submitRejection');
    element.querySelector('dialog form')!.dispatchEvent(new Event('submit',{cancelable:true}));await submit.mock.results[0].value;fixture.detectChanges();
    expect(auth.finance).toHaveBeenCalledWith('reject',{p_id:id,p_reason:'Cliente desistiu',p_refund_amount:'0',p_refund_date:null,p_refund_reference:null,p_checked:true,p_key:expect.any(String)});
    expect(component['rejecting']()).toBeNull();expect(element.querySelector('dialog')!.hasAttribute('open')).toBe(false);
    expect(Array.from(element.querySelectorAll('tbody tr')).some(row=>row.textContent?.includes(id))).toBe(false);
  });
  it('requires refund details for paid bookings and keeps the same request key for retries', async () => {
    const {component,auth,fixture,element}=await setup();
    component['openRejection']({...reservation,status:'confirmed',received:800,refundableAmount:800});fixture.detectChanges();
    expect(element.querySelector('#rejection-refund-reference')).not.toBeNull();
    component['rejection'].patchValue({reason:'Desistência',checked:true});await component['submitRejection']();expect(component['rejection'].invalid).toBe(true);
    component['rejection'].controls.refundReference.setValue(' REFUND-800 ');
    const original=auth.finance.getMockImplementation()!;
    auth.finance.mockImplementation((action:string,args:unknown)=>action==='reject'?Promise.reject({code:'PT409',message:'Confira a devolução'}):original(action,args));
    await component['submitRejection']();await component['submitRejection']();
    /** Obtém os lançamentos enviados ao serviço para conferir as tentativas do teste. */
    const writes=()=>auth.finance.mock.calls.filter(call=>call[0]==='reject').map(call=>call[1] as any);
    expect(writes()[0].p_refund_amount).toBe('800');expect(writes()[0].p_refund_reference).toBe('REFUND-800');
    expect(writes()[0].p_refund_date).toBe(component['today']);expect(writes()[0].p_key).toBe(writes()[1].p_key);
    expect(component['rejecting']()).not.toBeNull();
    component['rejection'].controls.reason.setValue('Outro motivo');await component['submitRejection']();expect(writes()[2].p_key).not.toBe(writes()[1].p_key);
    component['saving'].set(true);component['closeRejection']();expect(component['rejecting']()).not.toBeNull();component['saving'].set(false);
    const event=new Event('cancel',{cancelable:true});element.querySelector('dialog')!.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);expect(component['rejecting']()).toBeNull();
  });
  it('blocks rejection during concurrent operations and when no booking is selected', async () => {
    const {component,auth,fixture}=await setup();await component['submitRejection']();
    component['openRejection'](reservation);component['rejection'].patchValue({reason:'Desistência',checked:true});
    for(const lock of ['loading','saving'] as const) {component[lock].set(true);await component['submitRejection']();component[lock].set(false);}
    fixture.componentRef.setInput('disabled',true);await component['submitRejection']();expect(auth.finance).toHaveBeenCalledTimes(1);
  });
  it('offers only approval and rejection, with manual payment required before approval', async () => {
    const {component,fixture,element,auth}=await setup();
    expect(Array.from(element.querySelectorAll('button')).some(button=>button.textContent?.trim()==='Remover')).toBe(false);
    /** Aciona o botão pelo texto e atualiza a tela do teste. */
    const click=(label:string)=>{Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(el=>el.textContent?.trim()===label)!.click();fixture.detectChanges();};
    const confirmations=jest.spyOn(component as any,'confirmReservation');
    click('Aprovar');expect(element.textContent).toContain('conferir o pagamento no banco');
    expect(component['payment'].controls.amount.value).toBe('');
    await component['confirmReservation']();expect(component['payment'].invalid).toBe(true);
    component['payment'].setValue({amount:'300,00',occurredOn:component['today'],reference:' PIX-300 '});
    fixture.detectChanges();click('Registrar pagamento');await confirmations.mock.results.at(-1)!.value;await fixture.whenStable();fixture.detectChanges();
    expect(auth.finance).toHaveBeenCalledWith('approve',expect.objectContaining({p_id:id,p_amount:'300.00',p_occurred_on:component['today'],p_reference:'PIX-300',p_key:expect.any(String)}));expect(component['confirmation']()).toBeNull();expect(component['notice']()).toContain('valor informado');
  });
});
