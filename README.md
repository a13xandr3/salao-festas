# Família Tx

Site Angular 20 para apresentação do espaço, contato e pré-reservas. Hospedagem estática no GitHub Pages, persistência no Supabase e envio pelo Gmail SMTP em uma Edge Function do Supabase. Não precisa de servidor Node.js em produção.

## Executar

```bash
npm ci
npm start
```

Acesse `http://localhost:4209`. O frontend local utiliza o mesmo Supabase configurado em `public/app-config.json`.

## Configuração

Para ativar o Gmail, siga [o guia de envio](supabase/GMAIL.md). O `.env` local está ignorado pelo Git; as credenciais são carregadas apenas na Edge Function, nunca no Angular.

As tabelas são `public.contacts` e `public."preReservations"`. A integração usa funções PostgreSQL, acesso por token individual e políticas administrativas. Consulte o [guia do Supabase](supabase/README.md) para configuração e administração.

`public/app-config.json` contém apenas configuração pública: URL, chave publishable/anon e links públicos de contrato/Pix. Nunca inclua chaves administrativas nesse arquivo.

## Fluxo

1. A agenda consulta somente datas/status a cada 30 segundos.
2. O banco valida e registra uma pré-reserva futura, em diárias completas das 08h às 08h de São Paulo, e bloqueia sobreposições.
3. A gravação cria a fila de e-mail na mesma transação. Após a confirmação do banco, o serviço compartilhado solicita o envio imediatamente; o modal apenas informa o sucesso. O worker envia ao gestor e ao cliente, com contrato, Pix e links individuais.
4. O link individual permite encaminhar PDF de até 10 MB ao gestor pelo Gmail. Não há assinatura digital nem pagamento automático no site.
5. O cancelamento exige token individual, exclui a pré-reserva correspondente e libera o período. A pré-reserva não expira automaticamente.
6. O gestor confirma pagamento ou cancela registros pelo Supabase. Não existe painel administrativo no Angular.

O contato comum é registrado no Supabase e enviado ao gestor pelo Gmail. O worker retoma falhas sem depender da página aberta. Aceitação SMTP não comprova entrega na caixa de entrada. O PDF e a página Pix incluídos são demonstrativos; substitua pelos recursos definitivos.

## Verificar

```bash
npm test -- --runInBand
npm run test:supabase
npm run test:email
npm run check:email
npm run verify:supabase
npm run build:pages
```

Os testes Angular simulam rede. Os testes SQL usam PostgreSQL local via PGlite, sem Docker. `verify:supabase` verifica o banco remoto sem gravar registros. `npm run verify:email` verifica as funções e a migração sem enfileirar ou enviar mensagens. A opção antiga de criar uma reserva de teste foi removida: gravar uma reserva agora também agenda e-mails.

## Publicar

O comando `build:pages` gera `dist/fed-salao/browser` com base `/salao-festas/`. Publique somente essa pasta. O workflow **Publish GitHub Pages** é acionado manualmente; configure **Settings → Pages → Source → GitHub Actions**.

## Revisão técnica

Consulte o [relatório da revisão](docs/revisao-angular-supabase.md). O `db.json`, a API JSON Server, o proxy e os scripts legados foram retirados. Os dados antigos não foram importados automaticamente para o Supabase; há backup local fora do repositório.
