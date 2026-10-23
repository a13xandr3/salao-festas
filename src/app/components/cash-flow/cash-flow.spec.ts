import { TestBed } from '@angular/core/testing';
import { AdminAuth } from '../../services/admin-auth';
import { FinanceDashboard, FinanceReservation } from '../../services/finance.models';
import { CashFlow, financeError } from './cash-flow';

const id = '00000000-0000-4000-8000-000000000001';
const reservation: FinanceReservation = { reservationId: id, name: '<img src=x onerror=alert(1)>', startDate: '2026-10-25', endDate: '2026-10-27', status: 'pending_payment', stayDays: 2, dailyRate: 400, totalAmount: 800, received: 0, refunded: 0, amountDue: 800, refundableAmount: 0 };
function dashboard(): FinanceDashboard {
  return {
    summary: { openingBalance: 100, income: 800, expenses: 50, closingBalance: 850, amountDue: 800, unpricedCount: 1, unreconciledCount: 1 },
    transactions: [{ id: 'entry', reservationId: id, name: 'Cliente', kind: 'receipt', category: 'locacao', amount: 800, signedAmount: 800, occurredOn: '2026-10-22', createdAt: '2026-10-22T15:00:00Z', createdBy: id, description: '<script>alert(1)</script>', externalReference: 'PIX-1' }],
    reservations: [reservation, { ...reservation, reservationId: 'old', totalAmount: null }, { ...reservation, reservationId: 'confirmed', status: 'confirmed', amountDue: 0, received: 300, refundableAmount: 300 }],
    transactionCount: 60, reservationCount: 60,
  };
}
describe('CashFlow', () => {
  async function setup(response = dashboard()) {
    const auth = { finance: jest.fn().mockImplementation((action: string) => Promise.resolve(action === 'overview' ? response : { id: 'saved' })) };
    TestBed.configureTestingModule({ imports: [CashFlow], providers: [{ provide: AdminAuth, useValue: auth }] });
    const fixture = TestBed.createComponent(CashFlow); fixture.detectChanges();
    const dialog=fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    dialog.showModal=jest.fn(()=>dialog.setAttribute('open',''));dialog.close=jest.fn(()=>dialog.removeAttribute('open'));  await fixture.whenStable(); fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, auth, element: fixture.nativeElement as HTMLElement };
  }
  function expense(component: CashFlow) {
    component['entry'].setValue({ amount: '80,00', occurredOn: component['today'], description: ' Cloro ', category: 'limpeza' });
  }
  function price(component: CashFlow) {
    component['price'].setValue({ reservationId: id, dailyRate: '350,00', reason: ' Desconto combinado ' });
  }
  it('only exposes intentionally friendly server errors', () => {
    for (const code of ['PT400','PT404','PT409']) expect(financeError({code, message:'Confira os dados'})).toBe('Confira os dados');
    for (const error of [null, undefined, {}, {code:'PT404'}, {code:'42P01', message:'sql'}]) expect(financeError(error)).toContain('Não foi possível');
  });
  it('starts with three clear tabs and only the requested reservation columns', async () => {
    const {component, auth, element, fixture} = await setup();
    expect(auth.finance).toHaveBeenCalledWith('overview', {p_month:component['today'].slice(0,7), p_reservation_page:0});
    expect(Array.from(element.querySelectorAll('[role=tab]')).map(el=>el.textContent?.trim())).toEqual(['Pré-Reservas/Reservas','Definir valor contratado','Registrar despesas']);
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
  it('records expenses with no receipt, protocol or payment controls, retaining idempotency on retry', async () => {
    const {component,auth,fixture,element}=await setup();component['selectTab']('entry');
    await component['submitEntry']();fixture.detectChanges();expect(element.textContent).toContain('Confira categoria');expense(component);
    const original=auth.finance.getMockImplementation()!;
    auth.finance.mockImplementation((action:string,args:unknown)=>action==='post'?Promise.reject({code:'PT409',message:'Falha'}):original(action,args));
    await component['submitEntry']();await component['submitEntry']();
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
    await component['confirmReservation']();component['confirmation'].set({row:reservation,action:'approve'});
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
