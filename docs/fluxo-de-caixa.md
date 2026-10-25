# Fluxo de caixa no painel

O financeiro possui cinco abas: **Pré-Reservas/Reservas**, **Definir valor contratado**, **Registrar despesas**, **Despesas** e **Cancelados**. Cada aba oferece uma explicação recolhível pelo indicador `->`.

## Pré-Reservas/Reservas

Consulte o mês de início do evento. A lista apresenta cliente/protocolo, início, recebido líquido (recebimentos menos devoluções), status do pagamento e ações. Sem pagamento: **Pendente**; pagamento incompleto: **Parcial**; pagamento integral: **Total**. A reserva aprovada recebe `status=confirmed` no banco.

- **Aprovar:** abre o cadastro manual de recebimento. Informe o valor deste pagamento, a data efetiva e o identificador único do Pix/comprovante; clique em **Registrar pagamento**. Não existe integração bancária ou webhook do Pix. Exemplo: locação de R$800 e pagamento informado de R$300 deixam R$500 pendentes; o status fica Parcial. Um novo lançamento manual de R$500 quita a locação e altera a reserva para `confirmed`. O servidor recusa valores acima do saldo pendente, datas futuras e comprovantes duplicados. Reenvios da mesma intenção não duplicam o lançamento.
- **Reprovar:** exige motivo e conferência do extrato. Com saldo recebido, exige registrar a devolução integral já efetuada no banco. Atualiza o status para `cancelled`, libera as datas, interrompe notificações pendentes e preserva o histórico na aba **Cancelados** do próprio financeiro. Não executa transferência bancária.

Os registros são filtrados no servidor antes da contagem e paginação, em páginas de 50. O resumo considera todos os registros do período, independentemente da página.

## Definir valor contratado

Permite definir ou alterar a **diária negociada** enquanto a pré-reserva está pendente, sem pagamentos ou devoluções registrados e sem confirmação. Informe protocolo, diária e motivo. O total é quantidade de diárias × diária negociada. Exemplo: duas diárias de R$350 resultam em R$700. O histórico privado preserva preço anterior, novo preço, motivo, autor e data. Repetir o mesmo preço não duplica o histórico.

Novas reservas continuam capturando a tarifa padrão em `booking_private.finance_control` (R$400 na implantação). Uma alteração dessa tarifa não modifica reservas existentes. A negociação não altera o QR Code ou valor padrão do Pix já enviado ao cliente; informe o acordo ao cliente antes do pagamento. Não há ajuste de preço depois do recebimento por esta interface.

## Registrar despesas

Informe categoria, valor pago, data e descrição. Categorias: limpeza, manutenção, água, energia, fornecedores e outros insumos/utensílios. Exemplo: cloro para piscina, Limpeza, R$80. O lançamento é sempre uma despesa, sem protocolo ou controles de recebimento. Reenvios da mesma intenção usam a mesma chave para evitar duplicidade. A interface não controla estoque.

## Exemplo completo

1. Cliente escolhe duas diárias no calendário e envia a pré-reserva: R$800 previstos, zero recebido e status Pendente.
2. Se houver desconto, defina R$350 por diária e o motivo: total negociado R$700, ainda sem entrada no caixa.
3. Confira o pagamento no banco; na lista ativa, clique **Aprovar**, informe valor pago de R$700, data e comprovante e clique **Registrar pagamento**. O caixa recebe o valor informado, pagamento Total e reserva `confirmed`. Se informar apenas R$300, haverá baixa parcial e permanecerão R$400 pendentes.
4. Registre R$80 de cloro em **Registrar despesas**. Com saldo inicial zero, sem outros lançamentos e ambos no mesmo mês, o resumo mostra R$700 de entradas, R$80 de saídas e saldo final R$620.
5. Se outro cliente desistir, use **Reprovar**, informe o motivo e confira o extrato. Caso exista saldo recebido, efetue a devolução no banco e informe os dados na janela. Após confirmar, consulte o registro em **Cancelados**.

Entradas e saídas seguem o mês efetivo do dinheiro; contas a receber seguem o mês de início do evento. Aprovar registra uma conferência administrativa; o painel não consulta o banco nem transfere dinheiro.

## Banco e segurança

Aplicar as migrações em ordem, incluindo `202610220003_cash_flow.sql`, `202610230001_finance_cancel.sql` e `202610230002_simple_finance.sql` e `202610230003_manual_payment.sql`. A última acrescenta:

- `booking_finance_overview`: resumo e lista de reservas ativas, sem o histórico de movimentações na resposta.
- `booking_finance_negotiate`: negociação de preço com auditoria e bloqueio após pagamento.
- `booking_finance_approve(uuid,text,text,text,uuid)`: recebimento manual com valor, data, comprovante e chave de idempotência. A assinatura antiga sem valor está desativada.
- View `pre_reservas_canceladas`, caso ainda não exista, com segurança do usuário que faz a consulta.

As RPCs exigem administrador na allowlist com AAL2. O lock financeiro serializa negociação, aprovação, remoção e recebimentos. Valores inválidos e operações incompatíveis com o estado atual são recusados no servidor. O histórico financeiro continua preservado no banco, embora a aba Movimentações tenha sido retirada.

## Reprovação com motivo e devolução

A ação **Reprovar**, à direita de Aprovar, abre uma janela com motivo obrigatório (até 500 caracteres). Sem recebimento líquido registrado, exige conferir o extrato e declarar que não existe valor pendente de devolução. Se houver recebimento, a janela mostra o saldo líquido integral a devolver e exige data, identificador do comprovante e confirmação de que a devolução já foi realizada no banco.

A RPC `booking_finance_reject` registra a devolução e o cancelamento em uma única transação, preservando o histórico. Se o saldo mudou desde a abertura da janela, recusa a operação e solicita nova conferência. Reenvios da mesma operação não duplicam devoluções. Não há transferência bancária automática nem devolução parcial neste fluxo.

A migração `202610230004_reject_reservation.sql` acrescenta à tabela `preReservations`: `rejectionReason` (text), `rejectedAt` (timestamptz), `rejectedBy` (uuid), `rejectionRefundAmount` (numeric), `rejectionRefundDate` (date), `rejectionRefundReference` (text), `rejectionKey` (uuid) e `rejectionChecked` (boolean). A view Cancelados passa a incluir motivo, data e dados da devolução; o painel exibe motivo, data da reprovação e valor devolvido.

Reservas antigas podem estar confirmadas sem recebimentos no caixa. A interface identifica esse caso como **Sem recebimento registrado**, mantendo a informação de confirmação. A reprovação exige conferência explícita do extrato, sem criar recebimentos ou devoluções fictícios. A migração não altera o status nem os pagamentos de clientes existentes.

## Aba Cancelados

O relatório fica no cash-flow, sem link próprio no cabeçalho do painel. A consulta preserva a view protegida do Supabase e os até 100 registros mais recentes cujo início do evento pertence ao mês selecionado no período financeiro. Mostra nome/protocolo, contato, período, status, motivo, data da reprovação, devolução registrada e data de criação. Ao abrir a aba, a lista é consultada novamente; **Consultar** aplica o mês escolhido e **Atualizar lista** repete a consulta para esse mês sem sair da aba. O filtro é aplicado no Supabase antes do limite de 100 registros.

## Aba Despesas

Selecione o mês e clique em **Consultar**. O relatório mostra **Data**, **Despesas** (descrição) e **Valor**, usando a data do pagamento. Acima da tabela, à direita, aparece o total de todas as despesas do mês, incluindo as demais páginas. A RPC `booking_finance_expenses` retorna registros de tipo `expense`, em páginas de 50; devoluções a clientes e ajustes de saldo não entram neste relatório. A migração `202610230005_expense_report.sql` mantém a exigência de administrador com AAL2.


Se a aba Despesas retornar `PGRST202`, a função não está disponível no schema cache do Supabase. Execute o conteúdo de `supabase/migrations/202610230005_expense_report.sql` no SQL Editor do projeto, após as migrações anteriores. O arquivo também solicita a atualização do cache do PostgREST. Essa falha é diferente de acesso negado (`PT403`/`42501`), que exige conferir a conta administradora e o segundo fator. A navegação entre abas permanece disponível se o resumo financeiro falhar.


### Excluir uma despesa

Na aba **Despesas**, o botão **Excluir**, à direita de cada linha, mostra data, descrição e valor para confirmação. Após **Confirmar exclusão**, o lançamento sai do relatório e deixa de compor os totais de despesas e o saldo do caixa; a lista volta à primeira página. **Voltar** fecha a confirmação sem alterar o registro.

A migração `202610250001_delete_expense.sql` adiciona `voided_at` e `voided_by` aos lançamentos. A RPC `booking_finance_delete_expense` exige administrador com AAL2 e permite somente despesas. O registro original permanece para auditoria. Repetir a exclusão é seguro e reenviar a criação original não reativa o lançamento excluído. Não há transferência bancária nem exclusão de recebimentos por essa ação.
