/** Registra a entrada HTTP que valida as solicitações públicas de e-mail. */
import { handleEmail } from '../_shared/email-handler.mjs';
import { env, rpc } from '../_shared/runtime.ts';

Deno.serve((request) => handleEmail(request, { env, rpc }));
