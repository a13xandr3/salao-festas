/** Testa a leitura do link individual e a retirada do token da URL. */
import { reservationLink } from './reservation-link';

describe('reservationLink', () => {
  afterEach(() => history.replaceState(null, '', '/'));
  it('does not access browser history during server rendering', () => {
    expect(reservationLink({ defaultView: null } as Document, 'enviar-contrato')).toBeNull();
  });
  it('ignores unrelated actions and links without parameters', () => {
    history.replaceState(null, '', '/#contato');
    expect(reservationLink(document, 'enviar-contrato')).toBeNull();
    expect(location.hash).toBe('#contato');
  });
  it.each(['', 'id=test', 'token=' + 'a'.repeat(64), 'id=test&token=invalid'])('rejects incomplete ownership parameters: %s', (query) => {
    history.replaceState(null, '', '/?source=email#enviar-contrato?' + query);
    expect(reservationLink(document, 'enviar-contrato')).toBeNull();
    expect(location.hash).toBe('#enviar-contrato');
    expect(location.search).toBe('?source=email');
  });
  it('extracts valid ownership data and removes the token from the address bar', () => {
    history.replaceState(null, '', '/?source=email#enviar-contrato?id=test&token=' + 'b'.repeat(64));
    expect(reservationLink(document, 'enviar-contrato')).toEqual({ id: 'test', token: 'b'.repeat(64) });
    expect(location.href).not.toContain('token=');
    expect(location.hash).toBe('#enviar-contrato');
  });
});
