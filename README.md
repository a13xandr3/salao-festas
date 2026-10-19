# Família Tx

Angular com agenda pública, pré-reservas em JSON Server e e-mails pelo FormSubmit. Não utiliza SMTP, Nodemailer ou senha de aplicativo.

## Executar

```bash
npm install
# Apenas se o arquivo ainda não existir:
cp .env.example .env
npm run dev
```

Site: `http://localhost:4209`. API: `http://127.0.0.1:3001/api`. `npm start` inicia apenas Angular; `npm run api` inicia apenas a API. O `.env` é privado e ignorado pelo Git. Credenciais SMTP antigas nesse arquivo não são utilizadas.

## E-mails das pré-reservas: FormSubmit

A agenda usa `PreReservation` e o serviço Angular `FormSubmitDelivery` para enviar as notificações. O fluxo é:

1. A API valida e grava a pré-reserva no `db.json`, sem enviar e-mail.
2. Ela devolve os campos do formulário FormSubmit: mensagem para o gestor e `_autoresponse` para o cliente, com contrato PDF, Pix, envio do contrato assinado e cancelamento individual.
3. O navegador faz um POST **normal** para `https://formsubmit.co/<gestor>`. O cliente conclui a verificação do FormSubmit.
4. O FormSubmit encaminha o formulário ao gestor e a resposta automática ao e-mail do cliente. Depois, retorna ao site usando `_next`.

Essa etapa não usa AJAX: a [documentação oficial do FormSubmit](https://formsubmit.co/documentation) informa que `_autoresponse` não funciona via AJAX ou com reCAPTCHA desativado. Portanto, a aplicação mantém a verificação padrão do provedor e não desativa o CAPTCHA.

O endereço do gestor precisa estar ativado no FormSubmit; confirme o e-mail de ativação enviado pelo serviço, se solicitado. A aplicação não consegue comprovar a entrega nas caixas de entrada e registra `notifications.*.status: "awaiting_formsubmit"`, sem afirmar que os e-mails foram entregues.

O protocolo, o código de cancelamento e o formulário de envio ficam temporariamente em `sessionStorage`, para restaurar a confirmação após a volta do FormSubmit. Se o envio for interrompido, **Continuar envio pelo FormSubmit** recupera o formulário com autorização do cliente e não cria outra pré-reserva. Essa retomada pode gerar outra notificação se o envio anterior já tiver sido concluído no provedor. A confirmação é mantida na sessão da aba; não é compartilhada entre dispositivos. Os formulários de pré-reserva e cancelamento não ficam visíveis após o registro.

Configuração no `.env`:

- `RESERVATION_MANAGER_EMAIL`: padrão `a13xandr3ea@gmail.com`.
- `PUBLIC_SITE_URL`: endereço público do site em produção, necessário para links acessíveis aos clientes e retorno após verificação.
- `CONTRACT_PDF_URL`: contrato definitivo, opcional.
- `PIX_PAYMENT_URL`: página externa de pagamento, opcional.
- `PIX_KEY`: chave exibida na página Pix interna, opcional.
- `CONTACTS_ADMIN_TOKEN`: token privado para operações administrativas. Não colocar no Angular.

`npm run mail:check` valida os endereços configurados, sem SMTP, sem enviar e-mail e sem verificar a ativação do destinatário no FormSubmit.

O contato comum (`contact.ts`) continua usando FormSubmit AJAX para encaminhar o contato ao gestor e depois registrar seu histórico; não depende do mecanismo de resposta automática das pré-reservas.

## PDF e Pix demonstrativos

O arquivo `public/documents/contrato-demonstracao.pdf` é um documento de teste, sem validade contratual. Substitua-o pelo contrato definitivo ou configure `CONTRACT_PDF_URL`.

A página `/api/reservation-resources/pix` mostra `PIX_KEY`. Sem chave configurada, informa explicitamente que o conteúdo é demonstrativo e que nenhum pagamento deve ser feito. Configure a chave real ou use `PIX_PAYMENT_URL` para substituir a página. Nenhum pagamento ou QR Code é gerado automaticamente.

## Agenda e regras das pré-reservas

O cliente escolhe entrada e saída. Cada diária vai das 08h às 08h do dia seguinte: mínimo de **24 horas**, em diárias completas, sem quantidade máxima. O servidor utiliza `America/Sao_Paulo`. O início precisa estar no futuro.

A coleção `preReservations` armazena os dados do cliente, período e protocolo. A pré-reserva bloqueia o período com status `pending_payment`, **sem prazo de expiração ou cancelamento automático**. Conflitos com outras pré-reservas ou reservas administrativas retornam HTTP 409.

O calendário consulta `/api/availability?month=AAAA-MM` a cada 30 segundos e exibe Livre/Reservado, sem dados pessoais ou códigos. A data de saída fica livre para entrada às 08h. Sem resposta da API, nenhuma disponibilidade é inventada.

A confirmação do pagamento continua sendo administrativa, após verificação da equipe, por PATCH `/api/pre-reservations/:id/confirm-payment`, com o token administrativo. Não há integração bancária automática nem limite de seis horas. Registros históricos já expirados pela regra anterior não são reativados automaticamente, para não causar conflitos com marcações posteriores.

## Enviar contrato assinado

O e-mail do cliente contém o link individual **Enviar contrato assinado**. Ao abri-lo, a API verifica o código de acesso e prepara um formulário vinculado à pré-reserva. Esse formulário não aparece na navegação normal nem após registrar a pré-reserva.

O cliente efetua o pagamento, baixa o contrato e assina digitalmente em sua ferramenta de assinatura. Depois, anexa o PDF pelo link do e-mail. O formulário aceita PDF de até 10 MB e usa POST nativo `multipart/form-data` no FormSubmit, que encaminha o arquivo ao gestor. A verificação do FormSubmit permanece ativa. Não há geração nem validação criptográfica de assinatura no site, e o documento não é armazenado no `db.json`.

A API fornece a identificação da pré-reserva e os dados do cliente no e-mail do contrato. Retornar do FormSubmit não significa que a equipe já conferiu o documento ou confirmou o pagamento.

## Cancelamento pelo cliente

Somente o link individual do e-mail abre o formulário de cancelamento. O formulário não fica exposto na página normal. Abrir o link não exclui nada: o cliente precisa confirmar a ação.

DELETE `/api/pre-reservations/:id` exige `X-Cancellation-Token` e remove fisicamente apenas o registro correspondente de `preReservations`, liberando o período. Um protocolo, e-mail ou código de outro cliente não autoriza a exclusão. O código no fragmento do link não é enviado em logs HTTP e é retirado da barra de endereço após preencher o formulário.

## API e histórico

| Método | Rota | Acesso |
| --- | --- | --- |
| POST | `/api/contacts` | Público, registra contato |
| GET | `/api/contacts` e `/api/contacts/:id` | Administrativo |
| PATCH / DELETE | `/api/contacts/:id` | Administrativo |
| GET | `/api/availability?month=AAAA-MM` | Público, datas sem dados pessoais |
| POST | `/api/pre-reservations` | Público, registra e prepara FormSubmit |
| GET | `/api/pre-reservations` | Administrativo |
| DELETE | `/api/pre-reservations/:id` | Código individual do cliente |
| GET | `/api/pre-reservations/:id/notification-form` | Código individual, retoma FormSubmit |
| GET | `/api/pre-reservations/:id/contract-form` | Código individual, prepara envio do PDF assinado |
| DELETE | `/api/admin/pre-reservations/:id` | Administrativo, cancelamento unilateral |
| PATCH | `/api/pre-reservations/:id/confirm-payment` | Administrativo |
| GET | `/api/pre-reservations/mail-status` | Administrativo, configuração FormSubmit |
| POST | `/api/pre-reservations/:id/retry-notifications` | Administrativo, devolve formulário FormSubmit; não envia sozinho |
| GET / POST | `/api/reservations` | Administrativo, marcações legadas |
| PATCH / DELETE | `/api/reservations/:id` | Administrativo |

Operações administrativas exigem `Authorization: Bearer <CONTACTS_ADMIN_TOKEN>`. As operações de criação possuem limite de tentativas por IP. Os dados persistem em `db.json`; use uma única instância da API e armazenamento persistente com backup. Não reinicialize o arquivo para iniciar o servidor.

## Build e verificação

```bash
npm test -- --runInBand
npm run test:api
npm run mail:check
npm run build
```

Os testes não enviam e-mails reais. Validam POST nativo, campos FormSubmit, verificação preservada, persistência, conflito, ausência de expiração, envio de contrato e cancelamento protegido.

Para SSR, execute `npm run api` e, em outro terminal, `npm run serve:ssr:fed-salao`. O SSR usa porta 4000 e encaminha `/api/**` à API local. Se necessário, configure `CONTACT_API_URL` no ambiente SSR. Em desenvolvimento, `proxy.conf.json` define o destino da API.

### Cancelamento pelo gestor

O futuro painel poderá usar DELETE `/api/admin/pre-reservations/:id`, protegido por `Authorization: Bearer <CONTACTS_ADMIN_TOKEN>`. Essa operação cancela unilateralmente e libera o período, sem depender do código do cliente. O painel em si não foi construído nesta alteração.
