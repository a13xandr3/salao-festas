import { TestBed } from '@angular/core/testing';
import { FormSubmitDelivery } from './formsubmit-delivery';
describe('FormSubmitDelivery', () => {
  it('uses native POST rather than AJAX and preserves auto-response and provider verification', () => {
    const submit = jest.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function(this: HTMLFormElement) {
      expect(this.method).toBe('post'); expect(this.target).toBe('_self');
      expect(this.action).toContain('https://formsubmit.co/');
      expect(this.querySelector<HTMLInputElement>('[name="_autoresponse"]')!.value).toBe('Sua confirmação');
      expect(this.querySelector('[name="_captcha"]')).toBeNull();
    });
    try {
      TestBed.inject(FormSubmitDelivery).submit({ action: 'https://formsubmit.co/manager@example.com', fields: { email: 'client@example.com', _autoresponse: 'Sua confirmação' } });
      expect(submit).toHaveBeenCalledTimes(1);
      expect(document.querySelector('form')).toBeNull();
    } finally { submit.mockRestore(); }
  });
  it('rejects external destinations and the AJAX endpoint', () => {
    const service = TestBed.inject(FormSubmitDelivery);
    expect(() => service.submit({ action: 'https://example.com/', fields: {} })).toThrow();
    expect(() => service.submit({ action: 'https://formsubmit.co/ajax/user@example.com', fields: {} })).toThrow();
  });
});
