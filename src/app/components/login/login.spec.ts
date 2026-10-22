import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdminAuth } from '../../services/admin-auth';
import { Login } from './login';

describe('Login', () => {
  const stage = signal('credentials');
  const enrollment = signal<{ qrCode: string; secret: string } | null>(null);
  const authorized = signal(false);
  let auth: any;
  const setup = () => {
    TestBed.configureTestingModule({ imports: [Login], providers: [{ provide: AdminAuth, useValue: auth }] });
    const fixture = TestBed.createComponent(Login); fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, element: fixture.nativeElement as HTMLElement };
  };
  beforeEach(() => {
    stage.set('credentials'); enrollment.set(null); authorized.set(false);
    auth = { stage, enrollment, authorized, email: () => 'admin@example.com', signIn: jest.fn().mockResolvedValue(undefined), verify: jest.fn().mockResolvedValue(undefined), signOut: jest.fn().mockResolvedValue(undefined) };
  });
  it('validates credentials and supports password-manager autocomplete', async () => {
    const { component, element, fixture } = setup();
    expect(element.querySelector('app-painel')).toBeNull();
    expect(element.querySelector('input[type=password]')!.getAttribute('autocomplete')).toBe('current-password');
    await component['signIn'](); expect(auth.signIn).not.toHaveBeenCalled();
    component['credentials'].setValue({ email: 'admin@example.com', password: 'a long test passphrase' });
    let finish!: () => void; auth.signIn.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = component['signIn'](); fixture.detectChanges();
    expect(element.querySelector('button')!.disabled).toBe(true);
    await component['signIn'](); expect(auth.signIn).toHaveBeenCalledTimes(1);
    finish(); await pending;
    expect(auth.signIn).toHaveBeenCalledWith('admin@example.com', 'a long test passphrase');
    expect(component['credentials'].controls.password.value).toBe(''); expect(component['busy']()).toBe(false);
  });
  it('shows generic credential errors without exposing server details', async () => {
    const { component, fixture, element } = setup();
    auth.signIn.mockRejectedValue(new Error('user does not exist <script>alert(1)</script>'));
    component['credentials'].setValue({ email: 'admin@example.com', password: 'test passphrase' });
    element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable(); fixture.detectChanges();
    expect(element.querySelector('[role=alert]')!.textContent).toContain('Não foi possível entrar');
    expect(element.textContent).not.toContain('user does not exist'); expect(element.querySelector('script')).toBeNull();
    expect(component['credentials'].controls.password.value).toBe('');
  });
  it('shows enrollment only until the second factor is verified and can cancel', async () => {
    stage.set('enroll'); enrollment.set({ qrCode: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E', secret: 'TESTSECRET' });
    const { element, fixture } = setup();
    expect(element.querySelector('img')!.getAttribute('src')).toContain('data:image/svg+xml');
    expect(element.querySelector('code')!.textContent).toBe('TESTSECRET'); expect(element.querySelector('app-painel')).toBeNull();
    element.querySelector<HTMLButtonElement>('button[type=button]')!.click(); await fixture.whenStable();
    expect(auth.signOut).toHaveBeenCalled();
  });
  it('rejects invalid codes, blocks duplicate submissions and renders the panel after verification', async () => {
    stage.set('totp'); const { component, element, fixture } = setup();
    expect(element.querySelector('img')).toBeNull();
    await component['verify'](); expect(auth.verify).not.toHaveBeenCalled();
    component['secondFactor'].setValue({ code: '123456' });
    let finish!: () => void; auth.verify.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = component['verify'](); await component['verify']();
    expect(auth.verify).toHaveBeenCalledTimes(1); finish(); await pending;
    expect(auth.verify).toHaveBeenCalledWith('123456'); expect(component['secondFactor'].controls.code.value).toBe('');
    authorized.set(true); stage.set('authenticated'); fixture.detectChanges();
    expect(element.querySelector('app-painel h1')!.textContent).toBe('Painel'); expect(element.querySelector('form')).toBeNull();
    element.querySelector<HTMLButtonElement>('app-painel button')!.click(); await fixture.whenStable();
    expect(auth.signOut).toHaveBeenCalled();
  });
  it('clears rejected codes and permits a new verification attempt', async () => {
    stage.set('totp'); const { component, fixture, element } = setup();
    component['secondFactor'].setValue({ code: '123456' }); auth.verify.mockRejectedValueOnce(new Error('expired'));
    element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable(); fixture.detectChanges();
    expect(element.querySelector('[role=alert]')!.textContent).toContain('código atual');
    expect(component['secondFactor'].controls.code.value).toBe(''); expect(component['busy']()).toBe(false);
  });
  it('prevents overlapping logout requests and handles server failure', async () => {
    const { component } = setup(); let fail!: (error: Error) => void;
    auth.signOut.mockImplementation(() => new Promise<void>((_, reject) => { fail = reject; }));
    const pending = component['signOut'](); await component['signOut'](); expect(auth.signOut).toHaveBeenCalledTimes(1);
    fail(new Error('network')); await pending;
    expect(component['error']()).toContain('Feche esta aba'); expect(component['busy']()).toBe(false);
  });
});
