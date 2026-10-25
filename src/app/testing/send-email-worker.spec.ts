/** Testa a inicialização do worker com dependências de SMTP e banco simuladas. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

describe('send-email-worker entry point', () => {
  it('registers a request handler with the SMTP and database dependencies', async () => {
    const env = { GMAIL_HOST: 'smtp.gmail.com' };
    const rpc = jest.fn();
    const createTransport = jest.fn();
    const send = jest.fn().mockResolvedValue(undefined);
    const createGmailSender = jest.fn(() => send);
    const verifyGmailConnection = jest.fn().mockResolvedValue(true);
    const response = { status: 200 };
    const handleWorker = jest.fn().mockResolvedValue(response);
    const serve = jest.fn();
    const modules: Record<string, unknown> = {
      'npm:nodemailer@10.1.7': { default: { createTransport } },
      '../_shared/gmail.mjs': { createGmailSender, verifyGmailConnection },
      '../_shared/email-worker.mjs': { handleWorker },
      '../_shared/runtime.ts': { env, rpc },
    };
    const source = readFileSync(resolve(process.cwd(), 'supabase/functions/send-email-worker/index.ts'), 'utf8');
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
    });
    runInNewContext(compiled.outputText, {
      exports: {}, Deno: { serve },
      require: (name: string) => {
        if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`);
        return modules[name];
      },
    });
    expect(serve).toHaveBeenCalledTimes(1);
    expect(handleWorker).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
    const request = { method: 'POST' };
    expect(await serve.mock.calls[0][0](request)).toBe(response);
    const [forwarded, dependencies] = handleWorker.mock.calls[0];
    expect(forwarded).toBe(request);
    expect(dependencies.env).toBe(env);
    expect(dependencies.rpc).toBe(rpc);
    await dependencies.verifySmtp();
    expect(verifyGmailConnection).toHaveBeenCalledWith(env, createTransport);
    const message = { to: 'customer@example.com', text: 'Local test' };
    await dependencies.sendMail(message);
    expect(createGmailSender).toHaveBeenCalledWith(env, createTransport);
    expect(send).toHaveBeenCalledWith(message);
  });
});
