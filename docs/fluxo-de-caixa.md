# Financeiro no painel

A navegação **Financeiro** apresenta entradas, saídas, saldo inicial/final e contas a receber. Movimentações usam a data efetiva do dinheiro; contas a receber usam o mês de início do evento. O resumo considera todos os registros, independentemente da página exibida (50 registros por página).

## Operação

- **Recebimento:** informar protocolo, valor efetivamente recebido, data, categoria, descrição e identificador único do Pix/comprovante. Pode ser parcial. A reserva só fica `confirmed` quando o líquido recebido atinge o total contratado.
- **Despesa:** registrar data, valor, categoria (limpeza, manutenção, água, energia, fornecedores, outros) e descrição. O protocolo é opcional para despesas gerais.
- **Devolução:** informar protocolo e valor efetivamente devolvido. O banco limita a devolução ao líquido recebido. Uma devolução de reserva ativa reabre seu saldo pendente; uma cancelada permanece cancelada.
- **Saldo/ajuste:** entrada ou saída documentada para implantação/conciliação do caixa. Não altera o pagamento de uma reserva. Para corrigir o recebimento de uma reserva, usar a movimentação oposta vinculada ao mesmo protocolo e identificar o lançamento original na descrição/referência.
- **Valor contratado:** obrigatório para reservas antigas sem preço. Informar a diária realmente combinada. O banco calcula diárias × preço e preserva o valor. Uma repetição do mesmo valor é segura; uma tentativa de trocar um valor já definido é recusada.

O registro é administrativo: não movimenta dinheiro no banco, não consulta automaticamente o Pix nem dispara e-mail de cobrança. Conferir o extrato/comprovante antes de lançar.

## Valores e histórico

Novas reservas recebem automaticamente `stayDays`, `dailyRate` e `totalAmount` por trigger, usando inicialmente **R$ 400,00**, a tarifa atual do Pix. Alterações futuras em `booking_private.finance_control.daily_rate` não recalculam reservas já criadas. Se a tarifa pública mudar, também atualizar o gerador/QR Codes do Pix antes de publicar; não há edição de tarifa global nesta tela.

Reservas anteriores à migração permanecem sem preço até conciliação manual. `paymentConfirmedAt` ou `status=confirmed` antigos não provam valor nem data do movimento: a implantação não inventa recebimentos. A tela sinaliza reservas sem preço e confirmações sem recebimento integral no caixa.

Ao implantar, escolher uma data de corte. O saldo inicial deve representar o dinheiro anterior aos lançamentos importados. Não incluir o mesmo recebimento no saldo de abertura e novamente nas movimentações. Os registros anteriores podem ser lançados com sua data real, após conferir extratos.

Cancelamentos removem a previsão de receita e preservam recebimentos e despesas. Uma eventual devolução é outra movimentação. Reservas com lançamentos não podem ser apagadas fisicamente por causa do vínculo; o cancelamento já existente é por atualização de status.

## Banco e segurança

Aplicar `supabase/migrations/202610220003_cash_flow.sql` depois das migrações existentes. Ela preserva dados anteriores e não cria lançamentos financeiros.

- `public.financial_transactions`: histórico com valores `numeric(12,2)`, autor obtido de `auth.uid()`, chave de idempotência e referência do comprovante. Usuários autenticados não têm INSERT/UPDATE/DELETE diretos.
- `public.finance_receivables` e `public.finance_cash_flow`: views `security_invoker=true`, obedecendo ao RLS das tabelas de origem.
- `booking_finance_dashboard`: agregação mensal e paginação independentes de movimentações e reservas.
- `booking_finance_price`: definição explícita do preço legado.
- `booking_finance_post`: validação, serialização por lock, idempotência, lançamento e atualização do pagamento na mesma transação.
- `booking_confirm_payment`: a função administrativa anterior também registra o saldo integral como recebimento de hoje, em uma única transação, sem duplicação em chamadas repetidas. Para registrar data real e identificador bancário, preferir a tela Financeiro.

Todas as RPCs exigem usuário na allowlist e sessão `aal2`. O frontend usa a mesma sessão em memória já validada, sem service_role. Duas tentativas com a mesma chave retornam o lançamento existente; a mesma referência de recebimento não pode produzir dois créditos. Mudanças no formulário representam uma nova intenção e recebem outra chave.

Valores inválidos, recebimentos acima do saldo contratado, devoluções acima do saldo recebido, datas futuras, protocolos inexistentes e campos extras são recusados no servidor. Ajustes não apagam nem editam lançamentos existentes.

## Validação

Testes Jest cobrem interface, permissões do cliente, validações, reenvio, paginação, estados e bloqueio da navegação durante gravações. Testes PostgreSQL locais cobrem dinheiro exato, RLS/AAL2, preço histórico, recebimentos parciais/integral, devoluções, cancelamento, idempotência, referência duplicada e reaplicação da migração. O teste de navegador usa PostgreSQL local, sem registrar dinheiro nem enviar mensagens no Supabase real.
