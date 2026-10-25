import { TestBed } from '@angular/core/testing';
import { SupabaseClient } from '@supabase/supabase-js';
import { AdminAuth } from './admin-auth';
import { AdminData } from './admin-data';

describe('AdminData', () => {
  const ok=(data:unknown={})=>({data,error:null});
  const failure=()=>({data:null,error:new Error('private detail')});
  let service:AdminData;
  let client:{rpc:jest.Mock;from:jest.Mock};
  let gateway:{runAuthorized:jest.Mock};
  beforeEach(()=>{
    client={rpc:jest.fn(),from:jest.fn()};
    gateway={runAuthorized:jest.fn(async (operation:(client:SupabaseClient)=>Promise<unknown>)=>operation(client as unknown as SupabaseClient))};
    TestBed.configureTestingModule({providers:[{provide:AdminAuth,useValue:gateway}]});service=TestBed.inject(AdminData);
  });
  it('propagates denied access before reading lists or invoking financial RPCs', async()=>{
    gateway.runAuthorized.mockRejectedValue(new Error('Acesso restrito.'));
    await expect(service.list('contacts')).rejects.toThrow('Acesso restrito');
    await expect(service.finance('overview',{})).rejects.toThrow('Acesso restrito');
    expect(client.from).not.toHaveBeenCalled();expect(client.rpc).not.toHaveBeenCalled();
  });
  it.each(['contacts', 'preReservations', 'pre_reservas_canceladas'] as const)('reads only selected public fields from the protected %s table', async type => {
    const records = [{ id: 'record', name: 'Cliente' }];
    const query = { select: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), overrideTypes: jest.fn().mockResolvedValue(ok(records)) };
    client.from = jest.fn().mockReturnValue(query);
    expect(await service.list(type)).toEqual(records);
    expect(client.from).toHaveBeenCalledWith(type);
    const columns = type === 'contacts' ? 'id,name,email,phone,message,createdAt' : 'id,name,email,phone,startDate,endDate,status,createdAt';
    expect(query.select).toHaveBeenCalledWith(type === 'pre_reservas_canceladas' ? columns + ',rejectionReason,rejectedAt,rejectionRefundAmount' : columns);
    expect(query.select.mock.calls[0][0]).not.toContain('Token');
    expect(query.order).toHaveBeenCalledWith('createdAt', { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(100);
    query.overrideTypes.mockResolvedValue(ok(null)); expect(await service.list(type)).toEqual([]);
    query.overrideTypes.mockResolvedValue(failure()); await expect(service.list(type)).rejects.toThrow();
  });
  it.each([
    ['2026-09', '2026-10'], ['2026-12', '2027-01'], ['2028-02', '2028-03'],
  ])('filters cancelled events for %s before applying the row limit', async (month, next) => {
    const query = {select:jest.fn().mockReturnThis(),gte:jest.fn().mockReturnThis(),lt:jest.fn().mockReturnThis(),order:jest.fn().mockReturnThis(),limit:jest.fn().mockReturnThis(),overrideTypes:jest.fn().mockResolvedValue(ok([]))};
    client.from = jest.fn().mockReturnValue(query);
    await service.list('pre_reservas_canceladas', month);
    expect(query.gte).toHaveBeenCalledWith('startDate', month + '-01');
    expect(query.lt).toHaveBeenCalledWith('startDate', next + '-01');
    expect(query.lt.mock.invocationCallOrder[0]).toBeLessThan(query.limit.mock.invocationCallOrder[0]);
    await expect(service.list('pre_reservas_canceladas', '2026-13')).rejects.toThrow('Período inválido');
  });
  it('protects financial RPCs with the same AAL2 session and propagates failures', async () => {
    client.rpc.mockResolvedValue(ok({ summary: {} }));
    expect(await service.finance('overview', { p_month: '2026-10' })).toEqual({ summary: {} });
    expect(client.rpc).toHaveBeenLastCalledWith('booking_finance_overview', { p_month: '2026-10' });
    client.rpc.mockResolvedValue(ok({ cancelled: true }));
    expect(await service.finance('reject', { p_id: 'reservation-id' })).toEqual({ cancelled: true });
    expect(client.rpc).toHaveBeenLastCalledWith('booking_finance_reject', { p_id: 'reservation-id' });
    for (const action of ['overview', 'negotiate', 'approve', 'reject', 'expenses', 'delete_expense'] as const) {
      client.rpc.mockResolvedValue(ok({ id: 'result' }));
      expect(await service.finance(action, {})).toEqual({ id: 'result' });
      expect(client.rpc).toHaveBeenLastCalledWith(`booking_finance_${action}`, {});
    }
    client.rpc.mockResolvedValue(failure()); await expect(service.finance('post', {})).rejects.toThrow();
    client.rpc.mockResolvedValue(ok(null)); await expect(service.finance('negotiate', {})).rejects.toThrow('Resposta financeira indisponível');
  });
});
