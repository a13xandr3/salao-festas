# Supabase + GitHub Pages

O envio atual usa Gmail SMTP pela fila PostgreSQL e pelas Edge Functions `send-email` e `send-email-worker`. Para a nova migração e os secrets, siga [GMAIL.md](GMAIL.md).

O Angular usa a Data API REST do Supabase pelo HttpClient, sem servidor Node.js em produção. Os componentes chamam métodos tipados de `SupabaseApi`, que executam as funções em `/rest/v1/rpc/...`. Não existe interceptor nem simulação de rotas locais `/api`.

## 1. Aplicar as regras no banco existente

Abra **SQL Editor → New query** no projeto Supabase. Cole todo o conteúdo de `supabase/migrations/202610190001_booking.sql` e execute com o usuário proprietário do projeto.

O script aproveita `public.contacts` e `public."preReservations"`, preservando registros. Ele configura padrões, RLS, funções RPC e a restrição de sobreposição. Acrescenta `paymentConfirmedAt` para registrar a confirmação. Também cria o schema interno `booking_private`, com a lista de administradores e contadores de submissões. Não exponha esse schema na Data API.

A migração substitui as políticas existentes dessas duas tabelas por políticas administrativas. Visitantes só podem executar as funções públicas explicitamente autorizadas; não podem consultar dados pessoais, inserir registros arbitrários ou alterar status diretamente.

Se houver reservas ativas sobrepostas ou períodos incompatíveis com diárias das 08h às 08h, a criação das restrições falha e a transação é revertida. Corrija os registros reais antes de repetir. Nenhum registro é apagado automaticamente.

A limitação de submissões é de cinco registros por e-mail normalizado, por operação e janela de quinze minutos. Isso não equivale ao limite antigo por IP e não impede um robô de variar o e-mail. Não há CAPTCHA no envio Gmail. Para uma agenda pública sujeita a abuso, será necessário acrescentar uma verificação anti-bot confiável antes da gravação.

## 2. Configurar o frontend

Edite `public/app-config.json`:

```json
{
  "supabaseUrl": "https://SEU-PROJETO.supabase.co",
  "supabasePublishableKey": "sb_publishable_SUA_CHAVE_PUBLICA",
  "contractUrl": "documents/contrato-de-locacao-espaco-tx.pdf",
  "pixUrl": "pix.html"
}
```

A URL e a chave publicável estão no painel do projeto, em Connect/Settings → API Keys. Também é aceita uma chave legada `anon`. Nunca coloque senha do banco, `service_role` ou `sb_secret_` neste arquivo, no Angular ou em variáveis de build que sejam incorporadas ao navegador. Todo o conteúdo desse JSON é público.

Os caminhos relativos de contrato e Pix respeitam o `<base href>` do build, incluindo `/salao-festas/`. Podem ser substituídos por endereços HTTPS externos. Substitua o PDF demonstrativo e a página `public/pix.html` pelos recursos definitivos; a página padrão não contém chave Pix nem gera pagamentos. A chave Pix publicada ao cliente deve ser tratada como informação pública, nunca como senha.

O remetente e o gestor são configurados no `.env` privado e nos secrets da função Gmail. O navegador envia somente UUID, token e o PDF quando aplicável. O SMTP recebe mensagens montadas com os dados do banco; o PDF fica temporariamente na fila privada até a aceitação pelo SMTP, quando é removido.

## 3. Executar e validar

```bash
npm install
npm start
npm test -- --runInBand
npm run test:supabase
npm run build:pages
```

O frontend usa Supabase tanto localmente quanto em produção. A API legada, o `db.json` e os scripts associados foram removidos. O build estático mantém a pré-renderização Angular, sem exigir um servidor em produção.

`test:supabase` executa a migração e as funções em PostgreSQL via PGlite. Cobre permissões, RLS, dados privados, conflito, limites, checkout, confirmação administrativa e cancelamento. É uma verificação local do SQL, sem enviar e-mails ou alterar seu projeto remoto. Os testes HTTP Angular cobrem os serviços e os componentes e os links no subdiretório do Pages. A validação do ambiente remoto ainda exige aplicar a migração e configurar URL/chave.

## 4. Publicar no Pages

O build estático é `dist/fed-salao/browser`. Somente essa pasta deve ser publicada. Não publique a raiz do repositório nem backups de dados.

O comando `build:pages` usa `/salao-festas/`, correspondente ao repositório atual. Para domínio próprio ou outro nome de repositório, ajuste `--base-href` antes de gerar os arquivos.

Em GitHub **Settings → Pages → Source**, selecione **GitHub Actions**. Depois de enviar as alterações ao GitHub, execute manualmente o workflow **Publish GitHub Pages**, em **Actions → Run workflow**. O workflow não publica automaticamente a cada commit.

## 5. Administrar os registros

O proprietário pode consultar contatos, confirmar pagamento e cancelar registros pelo **Table Editor** ou **SQL Editor** do Supabase. Ainda não existe uma tela administrativa no Angular, assim como na versão anterior.

No SQL Editor, após conferir o pagamento, use o UUID real:

```sql
update public."preReservations"
set status = 'confirmed', "paymentConfirmedAt" = now()
where id = 'UUID-DA-PRE-RESERVA'
  and status = 'pending_payment';
```

Para cancelar unilateralmente e liberar o período:

```sql
delete from public."preReservations"
where id = 'UUID-DA-PRE-RESERVA';
```

Para um futuro painel autenticado, crie o usuário do gestor em **Authentication → Users** e adicione seu UUID via SQL Editor:

```sql
insert into booking_private.admins (user_id)
values ('UUID-DO-USUARIO-EM-AUTH')
on conflict do nothing;
```

Não basta criar qualquer conta: somente UUIDs dessa lista recebem as permissões administrativas. A função `booking_confirm_payment(p_id)` aceita apenas um JWT de administrador autenticado. O usuário logado consulta contatos/reservas com RLS e pode excluir; visitantes continuam sem acesso direto às tabelas. O SQL Editor usa o papel proprietário e não depende dessa lista.

## 6. Dados anteriores

A integração não importou automaticamente o antigo `db.json` para evitar duplicatas e transferir dados pessoais sem revisão. Faça uma importação controlada, preservando UUIDs e datas, se houver registros válidos a migrar. As reservas administrativas da antiga coleção `reservations` também não são importadas automaticamente: qualquer período real deve constar no banco antes da publicação. Na nova estrutura, bloqueios de diárias podem ser registrados como pré-reservas e confirmados pelo gestor.

Confirmações antigas em `sessionStorage` e links de e-mail só funcionarão se o registro correspondente tiver sido migrado com os mesmos UUIDs e hashes. Tokens previamente publicados em Git devem ser substituídos antes de importar os registros, com novos links individuais; copiar o arquivo antigo manteria os tokens expostos válidos. Remover dados do branch atual não limpa o histórico do Git.

## Funções públicas

| Função                                               | Objetivo                                              |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `booking_create_contact(p_input)`                    | Valida e grava contato; retorna UUID e token de envio           |
| `booking_create_reservation(p_input)`                | Valida diárias futuras, gera token e bloqueia período |
| `booking_availability(p_month)`                      | Retorna datas/status sem dados pessoais               |
| `booking_owned_reservation(p_id,p_token,p_contract)` | Valida token para validar acesso individual ao contrato |
| `booking_cancel_reservation(p_id,p_token)`           | Exclui somente a reserva do token correspondente      |
| `booking_confirm_payment(p_id)`                      | Confirma pagamento; exige administrador autenticado   |

As pré-reservas continuam sem expiração automática. Erros `PT400`, `PT404`, `PT409` e `PT429` são traduzidos pelo PostgREST para os respectivos status HTTP, preservando as mensagens dos formulários.

## Verificação remota

`npm run verify:supabase` consulta a disponibilidade, verifica o bloqueio de leitura pública e testa rejeição de dados inválidos. Não cria registros. `npm run verify:email` verifica os endpoints, CORS e a nova RPC sem enfileirar mensagens. A antiga opção `--write-reservation` foi removida, porque uma gravação real agora também agenda e-mails.

### Cancelamento com preservação de histórico

Após as migrações de Gmail e fila, aplique `migrations/202610210001_soft_cancel_reservation.sql`.
A RPC `booking_cancel_reservation` mantém o registro em `preReservations` e altera seu `status`
para `cancelled` (inativo), em vez de excluí-lo. O período fica livre porque a agenda e a restrição
de sobreposição consideram apenas `pending_payment` e `confirmed`. Envios ainda não concluídos
são cancelados; o histórico de e-mails já enviados é preservado. O protocolo e o token individual
continuam obrigatórios. Esta migração não recupera registros excluídos anteriormente.

## Manutenção técnica

Consulte [Expurgo de dados técnicos](../docs/expurgo-tecnico.md) para retenção automática de logs de tarefas, controles expirados e anexos residuais, com preservação dos dados de negócio e das chaves de deduplicação de e-mails.
