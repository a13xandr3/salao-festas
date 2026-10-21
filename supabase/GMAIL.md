# Gmail com fila persistente

O Angular permanece no GitHub Pages. `src/app/shared/email/email.service.ts` solicita o envio; não possui credenciais SMTP. No Supabase, `send-email` valida a solicitação e confirma a fila, enquanto `send-email-worker` envia por `smtp.gmail.com:465` com TLS. O transporte fica isolado em `supabase/functions/_shared/gmail.mjs`.

## Ativação no projeto existente

A publicação do GitHub Pages não publica funções nem migrações no Supabase. Complete o backend antes de publicar o novo frontend.

1. No **Supabase SQL Editor**, aplique em ordem as migrações que ainda não foram aplicadas:
   - `supabase/migrations/202610200001_gmail.sql`;
   - `supabase/migrations/202610200002_email_queue.sql`.
   Ambas pressupõem a migração inicial `202610190001_booking.sql`, já usada pelo projeto. Não reaplique a migração inicial isoladamente, pois ela contém as configurações históricas do FormSubmit. Os registros são preservados; a fila recupera notificações Gmail ainda não enviadas.
2. Prepare o token privado do worker e o SQL de ativação:

```bash
npm run prepare:email
```

O comando mantém ou gera `MAIL_WORKER_TOKEN` no `.env` e cria `supabase/.temp/setup-email-worker.sql`. Ambos são privados, ignorados pelo Git e têm permissão `0600`. O SQL gerado contém um secret: cole-o apenas no SQL Editor do seu projeto, sem enviá-lo ao repositório ou ao chat. Para regenerá-lo depois de mudar o `.env`, execute o comando novamente.

3. Autentique a CLI e publique as configurações e as duas funções:

```bash
npx supabase login
npx supabase secrets set --project-ref gkuzpppvfhikzbwaodjf --env-file .env
npx supabase functions deploy send-email --project-ref gkuzpppvfhikzbwaodjf
npx supabase functions deploy send-email-worker --project-ref gkuzpppvfhikzbwaodjf
```

4. Execute o conteúdo completo do SQL privado `supabase/.temp/setup-email-worker.sql` no SQL Editor, como proprietário. Ele sincroniza o token com o Vault, habilita `pg_cron` e `pg_net`, cria o acionamento imediato da fila e agenda a recuperação a cada minuto. O script versionado `supabase/setup-email-worker.sql` é o modelo; não contém o token.
5. Verifique os endpoints sem enviar mensagens:

```bash
npm run verify:email
```

O verificador exige o endpoint público com CORS correto, a validação de uma capacidade inexistente e o bloqueio de acesso público ao worker. Não testa o login SMTP nem a execução do cron. Para verificar TLS e autenticação Gmail a partir da própria Edge Function, sem enviar mensagens, execute `npm run verify:gmail`. Esse diagnóstico exige o `.env` privado e não faz parte do workflow público. A publicação Pages exige essa verificação; HTTP 404 ou migração ausente impedem publicar o frontend novo.

6. No SQL Editor, confirme o agendamento e acompanhe a fila:

```sql
select jobname, schedule, active
from cron.job where jobname = 'booking-email-retry';

select kind, role, status, attempts, next_attempt_at, updated_at
from booking_private.email_deliveries
order by updated_at desc limit 30;
```

Após publicar o site, faça uma pré-reserva real controlada com um endereço que você possa consultar. Confira a mensagem do gestor, a do cliente, os links e um PDF. Na fila, as duas notificações devem atingir `sent`. Os testes automatizados não enviam e-mail real.

## Ordem de execução

1. Ao clicar em **Fazer pré-reserva**, o banco valida e grava a reserva e as duas entradas de fila na mesma transação. Se a gravação falhar, nada é enfileirado.
2. O `pg_net` aciona o worker após o commit. O Angular também solicita a confirmação da fila assim que recebe o registro, sem esperar o cliente fechar o modal.
3. O modal informa o sucesso da gravação, e o formulário fica oculto até outra data ser escolhida. Fechar o modal não dispara uma nova mensagem.
4. O worker obtém uma trava temporária para cada entrega e envia mensagens independentes para gestor e cliente. Uma falha em uma não bloqueia a outra.
5. Falhas são retomadas pelo cron, com espera progressiva de 1 minuto até 6 horas. Não existe bloqueio definitivo após cinco tentativas. Uma execução interrompida libera sua entrega após três minutos. Mensagens com confirmação `sent` não são reenviadas pelo fluxo normal.

O contato também é enfileirado na própria gravação; recarregar a página não perde seu envio nem exige recriar o contato. Para contratos, a função valida o PDF de até 10 MB e o guarda temporariamente em `booking_private.email_deliveries.attachment`, sem acesso público. Após aceitação pelo SMTP, remove o conteúdo. Excluir o registro de origem cancela os envios pendentes e remove os PDFs. São permitidos cinco PDFs distintos por pré-reserva; isso não limita tentativas de entrega de um mesmo PDF.

A resposta HTTP `202` significa **aceito na fila**, não entregue na caixa de entrada. O navegador espera apenas a confirmação da fila, com timeout de 30 segundos, e o SMTP tem prazo próprio de 40 segundos. O processamento continua pelo servidor mesmo se a página for fechada. Se o envio imediato falhar, o cron retoma depois, desde que sua ativação tenha sido concluída.

## Configuração privada

| Variável | Uso |
| --- | --- |
| `GMAIL_HOST` | `smtp.gmail.com` |
| `GMAIL_PORT` | `465` |
| `GMAIL_USER` | Remetente Gmail |
| `GMAIL_APP_PASSWORD` | Senha de aplicativo Google |
| `MAIL_MANAGER_EMAIL` | Destinatário fixo do gestor |
| `PUBLIC_SITE_URL` | URL pública completa, terminada em `/` |
| `CONTRACT_URL` | Caminho relativo ou URL do contrato |
| `PIX_URL` | Caminho relativo ou URL da página Pix |
| `MAIL_ALLOWED_ORIGINS` | Origens permitidas, separadas por vírgula |
| `MAIL_WORKER_TOKEN` | Token interno compartilhado entre Edge Function e Vault |

No Pages atual, a origem é `https://www.salaoespacotx.com.br`, e o site é `https://www.salaoespacotx.com.br/`. Em desenvolvimento a origem permitida é `http://localhost:4209`. Ao trocar o domínio, atualize URL e origens nos secrets. A configuração SMTP de **Authentication** do Supabase não envia mensagens deste fluxo.

As duas funções usam `verify_jwt = false`: o endpoint público valida os tokens individuais no banco; o worker exige seu próprio token privado. As RPCs de fila são exclusivas do papel interno `service_role`. Nenhuma credencial administrativa ou senha SMTP vai para o Angular. O schema `booking_private` não deve ser exposto pela Data API.

## Falhas e limites

A conta Google deve ter verificação em duas etapas e senha de aplicativo válida. Quotas, bloqueios da conta e destinatários inválidos continuam podendo impedir entrega. Os logs do worker registram somente códigos de erro SMTP, sem senhas ou conteúdo das mensagens. Um `EAUTH` ou resposta `535` exige revisar a senha nos secrets; a fila tenta novamente depois da correção.

Se o Gmail aceitar a mensagem e a confirmação no banco falhar, uma retomada pode duplicá-la. SMTP e PostgreSQL não participam de uma única transação; não há garantia de envio exatamente uma vez. `sent` confirma a aceitação pelo SMTP, sem monitorar caixa de entrada, spam ou devoluções.

O acionamento imediato usa HTTP assíncrono do banco e não é uma promessa de entrega instantânea. O cron cobre indisponibilidade temporária desse acionamento. Interromper o cron ou deixar de publicar o worker impede recuperar a fila automaticamente.

## Testes locais

```bash
npm test -- --runInBand
npm run test:supabase
npm run test:email
npm run check:email
npm run build:pages
```

O SQL é testado em PostgreSQL local via PGlite; as extensões hospedadas têm substitutos locais nos testes. Os testes de e-mail simulam SMTP. Deno verifica os dois entrypoints reais e suas dependências. Nenhum desses testes autentica a conta Gmail ou altera seu Supabase remoto.

Referências: [agendar Edge Functions com Cron, pg_net e Vault](https://supabase.com/docs/guides/functions/schedule-functions), [secrets](https://supabase.com/docs/guides/functions/secrets), [limites](https://supabase.com/docs/guides/functions/limits), [senhas de aplicativo Google](https://support.google.com/accounts/answer/185833?hl=pt-BR).
