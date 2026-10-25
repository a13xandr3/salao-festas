# Inspeção TypeScript — 25/10/2026

## Escopo e critérios

- Inventário inicial: **61 arquivos `.ts`** próprios do projeto; inventário final: **68**, incluindo **7 arquivos novos** e **30 arquivos de testes**.
- Inspeção estática recursiva por AST, busca de padrões de risco, revisão dos trechos modificados e execução de testes. Inclui `src` e `supabase/functions`.
- Excluídos dependências e saídas geradas: `node_modules`, `dist`, `.angular`, `.git` e `coverage`.
- Nesta etapa foram refatorados apenas arquivos TypeScript e produzido este relatório. Alterações de HTML, SQL e documentação de despesas já existentes no workspace foram preservadas.
- Arquivos sem problema identificado foram mantidos; “revisado” não significa “refatorado”.

## Achados e correções

| Critério | Resultado |
|---|---|
| Obsoleto | Removidos metadado de confirmação com ação única e ações legadas da API administrativa do navegador. Nenhuma API Angular válida foi removida apenas por parecer simples. |
| Verbosidade | Máscaras, controle de leitura, mensagens e geração de chaves deixaram de estar repetidos nos componentes. |
| Segurança | Recursos HTTP em produção, recibos adulterados/invalidáveis e envio de contrato sem consulta de propriedade receberam validação adicional. Não são apresentados como exploits demonstrados no site. |
| Robustez | JSON de segredo malformado deixa de derrubar o módulo Deno; contato encerra requisições e evita timers após destruição. |
| Valores monetários | O formulário deixa de aceitar valores ambíguos como `80.001`; usa strings decimais e mantém a validação final no servidor. |
| SOLID | SRP: autenticação, consultas, formatação e idempotência separados. DIP: componentes usam serviços injetados. Sem hierarquias artificiais para aplicar LSP/OCP onde não havia necessidade. |
| Documentação | JSDoc nos limites de confiança, no reenvio e no ciclo de vida; contratos de relatório compartilhados e explícitos. |

## Complexidade

A medida abaixo é CC sintática por função: 1 mais if, laços, case, catch, condicionais e operadores `&&`, `||` e `??`. Funções/callbacks aninhados são medidos separadamente. Não é uma pontuação Sonar de complexidade cognitiva; a revisão cognitiva considerou aninhamento e responsabilidades.

| Função | Antes | Depois | Efeito |
|---|---:|---:|---|
| `cash-flow.ts:refreshExpenses` | 9 | 3 | Mensagens e ciclo de leitura extraídos. |
| `cash-flow.ts:submitRejection` | 10 | 7 | Bloqueio e chave de reenvio centralizados. |
| `cash-flow.ts:confirmReservation` | 8 | 5 | Retiradas ação redundante e geração repetida de chave. |
| `admin-auth.ts:signIn` | 11 | 6 | Preparação do fator isolada; consultas em outro serviço. |
| `reservation-session.ts:read` | 9 | 8 | Validações divididas em identidade, links e período. |

Extrair métodos não elimina a complexidade total do negócio: torna as unidades menores, testáveis e mais fáceis de revisar.

## Arquivos refatorados e novos

| Arquivo | Situação | O que foi feito | Linhas de referência atuais |
|---|---|---|---|
| [src/app/components/cash-flow/cash-flow.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/cash-flow/cash-flow.ts:75) | Refatorado | Máscara, mensagens, contratos e idempotência extraídos; leituras centralizadas; metadado action obsoleto removido; usa AdminData. | 75, 82, 140, 177, 197, 214 |
| [src/app/components/contact/contact.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/contact/contact.ts:58) | Refatorado | Máscara compartilhada; cancelamento das requisições e prevenção de timers após destroy; envio e sucesso separados. | 58, 67, 73, 84 |
| [src/app/components/pre-reservation/pre-reservation.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/pre-reservation/pre-reservation.ts:161) | Refatorado | Retirada a cópia da máscara de telefone; preservadas validação de datas e sequência gravar/enviar. | 161 |
| [src/app/components/contract-upload/contract-upload.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/contract-upload/contract-upload.ts:55) | Refatorado | Documentada validação local de PDF; envio exige carregamento/autorização da reserva. | 55, 81 |
| [src/app/components/painel/painel.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/painel/painel.ts:45) | Refatorado | Consultas passam a AdminData; autenticação e estado do painel permanecem separados. | 45 |
| [src/app/services/admin-auth.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/admin-auth.ts:38) | Refatorado | SRP: autenticação/MFA; etapas menores; gateway autorizado para o serviço de dados. | 38, 55, 91, 99 |
| [src/app/services/admin-data.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/admin-data.ts:18) | Novo | Novo serviço de consultas/RPCs; campos explícitos, filtro de mês e autorização delegada. | 18, 30, 43 |
| [src/app/services/finance.models.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/finance.models.ts:22) | Refatorado | Contratos compartilhados ExpenseReport/FinanceOverview/FinanceAction; retiradas ações legadas sem consumo na aplicação. | 22, 28, 29 |
| [src/app/services/finance-utils.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/finance-utils.ts:5) | Novo | Conversão monetária, erros públicos e chave de reenvio isolados; corrigida aceitação de valor monetário ambíguo. | 5, 10, 16, 27 |
| [src/app/services/reservation-session.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/reservation-session.ts:7) | Refatorado | Validação de identidade, links, estado e período do recibo; bloqueio de URLs inseguras; dados locais não concedem autorização. | 7, 11, 15, 29 |
| [src/app/services/site-config.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/site-config.ts:14) | Refatorado | Recursos HTTPS em produção; HTTP restrito a loopback em desenvolvimento; preservadas chaves públicas. | 14 |
| [src/app/shared/formats/input-masks.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/shared/formats/input-masks.ts:2) | Novo | Máscaras de telefone e dinheiro reutilizáveis, com posição do cursor preservada e documentação. | 2, 18 |
| [supabase/functions/_shared/runtime.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/supabase/functions/_shared/runtime.ts:3) | Refatorado | Segredo JSON inválido não derruba a inicialização; RPC tipada como unknown e erros internos preservados fora da resposta pública. | 3, 13, 19 |

## Inventário recursivo completo

| Arquivo `.ts` | Análise / resultado | Linha ajustada ou de referência |
|---|---|---|
| [src/app/app.config.server.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/app.config.server.ts:1) | Revisado: Configuração SSR separada do cliente; mantida. | — (sem alteração) |
| [src/app/app.config.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/app.config.spec.ts:1) | Revisado: Teste analisado e executado; sem alteração necessária. | — (sem alteração) |
| [src/app/app.config.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/app.config.ts:1) | Revisado: HTTP/fetch, zoneless, hidratação e router válidos no Angular 20; mantido. | — (sem alteração) |
| [src/app/app.routes.server.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/app.routes.server.ts:1) | Revisado: Prerender estático para Pages; mantido. | — (sem alteração) |
| [src/app/app.routes.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/app.routes.ts:1) | Revisado: Rotas vazias coerentes com a navegação atual por âncoras/estado; sem remoção de contrato de bootstrap. | — (sem alteração) |
| [src/app/app.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/app.spec.ts:1) | Revisado: Teste analisado e executado; sem alteração necessária. | — (sem alteração) |
| [src/app/app.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/app.ts:1) | Revisado: Área restrita após renderização e metadados noindex; mantido. | — (sem alteração) |
| [src/app/components/cancel-pre-reservation/cancel-pre-reservation.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/cancel-pre-reservation/cancel-pre-reservation.spec.ts:1) | Revisado: Teste analisado e executado; sem alteração necessária. | — (sem alteração) |
| [src/app/components/cancel-pre-reservation/cancel-pre-reservation.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/cancel-pre-reservation/cancel-pre-reservation.ts:1) | Revisado: Confirmação explícita, token e limpeza da sessão; subscriptions encerradas no destroy. Mantido. | — (sem alteração) |
| [src/app/components/cash-flow/cash-flow.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/cash-flow/cash-flow.spec.ts:2) | Teste atualizado: Adaptado ao AdminData e aos auxiliares; mantidos testes de baixa manual, reenvio, reprovação, despesas e exclusão. | 2, 5 |
| [src/app/components/cash-flow/cash-flow.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/cash-flow/cash-flow.ts:75) | Refatorado: Máscara, mensagens, contratos e idempotência extraídos; leituras centralizadas; metadado action obsoleto removido; usa AdminData. | 75, 82, 140, 177, 197, 214 |
| [src/app/components/celebration-area/celebration-area.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/celebration-area/celebration-area.spec.ts:1) | Revisado: Teste analisado e executado; sem alteração necessária. | — (sem alteração) |
| [src/app/components/celebration-area/celebration-area.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/celebration-area/celebration-area.ts:1) | Revisado: Componente visual mínimo com OnPush; sem código de negócio a refatorar. | — (sem alteração) |
| [src/app/components/contact/contact.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/contact/contact.spec.ts:190) | Teste atualizado: Cenários de cursor indisponível e destruição antes/durante/depois das requisições; sem timers órfãos. | 190, 196, 213 |
| [src/app/components/contact/contact.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/contact/contact.ts:58) | Refatorado: Máscara compartilhada; cancelamento das requisições e prevenção de timers após destroy; envio e sucesso separados. | 58, 67, 73, 84 |
| [src/app/components/contract-upload/contract-upload.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/contract-upload/contract-upload.spec.ts:50) | Teste atualizado: Impede envio antes da confirmação de propriedade da reserva. | 50 |
| [src/app/components/contract-upload/contract-upload.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/contract-upload/contract-upload.ts:55) | Refatorado: Documentada validação local de PDF; envio exige carregamento/autorização da reserva. | 55, 81 |
| [src/app/components/footer/footer.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/footer/footer.spec.ts:1) | Revisado: Teste analisado e executado; sem alteração necessária. | — (sem alteração) |
| [src/app/components/footer/footer.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/footer/footer.ts:1) | Revisado: Ano e versão derivados; sem lógica financeira ou de autenticação. | — (sem alteração) |
| [src/app/components/login/login.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/login/login.spec.ts:1) | Revisado: Teste analisado e executado; sem alteração necessária. | — (sem alteração) |
| [src/app/components/login/login.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/login/login.ts:1) | Revisado: Senha e TOTP resetados; mensagens genéricas e estado de concorrência; mantido. | — (sem alteração) |
| [src/app/components/navbar/navbar.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/navbar/navbar.spec.ts:1) | Revisado: Teste analisado e executado; sem alteração necessária. | — (sem alteração) |
| [src/app/components/navbar/navbar.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/navbar/navbar.ts:1) | Revisado: Estado de menu por signal e OnPush; sem lógica obsoleta identificada. | — (sem alteração) |
| [src/app/components/our-services/our-services.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/our-services/our-services.spec.ts:1) | Revisado: Teste analisado e executado; sem alteração necessária. | — (sem alteração) |
| [src/app/components/our-services/our-services.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/our-services/our-services.ts:1) | Revisado: Componente visual mínimo com OnPush; sem código de negócio a refatorar. | — (sem alteração) |
| [src/app/components/painel/painel.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/painel/painel.spec.ts:5) | Teste atualizado: Dependência de dados isolada da autenticação, preservando navegação e bloqueios. | 5, 30 |
| [src/app/components/painel/painel.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/painel/painel.ts:45) | Refatorado: Consultas passam a AdminData; autenticação e estado do painel permanecem separados. | 45 |
| [src/app/components/pre-reservation/pre-reservation.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/pre-reservation/pre-reservation.spec.ts:324) | Teste atualizado: Cobertura da máscara compartilhada com cursor indisponível. | 324 |
| [src/app/components/pre-reservation/pre-reservation.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/pre-reservation/pre-reservation.ts:161) | Refatorado: Retirada a cópia da máscara de telefone; preservadas validação de datas e sequência gravar/enviar. | 161 |
| [src/app/components/presentation/presentation.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/presentation/presentation.spec.ts:1) | Revisado: Teste analisado e executado; sem alteração necessária. | — (sem alteração) |
| [src/app/components/presentation/presentation.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/presentation/presentation.ts:1) | Revisado: Componente visual mínimo com OnPush; sem código de negócio a refatorar. | — (sem alteração) |
| [src/app/components/reservation-calendar/calendar-model.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/reservation-calendar/calendar-model.spec.ts:1) | Revisado: Teste analisado e executado; sem alteração necessária. | — (sem alteração) |
| [src/app/components/reservation-calendar/calendar-model.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/reservation-calendar/calendar-model.ts:1) | Revisado: Regras puras de disponibilidade e fuso; preservadas para evitar regressão funcional. | — (sem alteração) |
| [src/app/components/reservation-calendar/reservation-calendar.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/reservation-calendar/reservation-calendar.spec.ts:1) | Revisado: Teste analisado e executado; sem alteração necessária. | — (sem alteração) |
| [src/app/components/reservation-calendar/reservation-calendar.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/reservation-calendar/reservation-calendar.ts:1) | Revisado: Polling e assinaturas com ciclo de vida controlado; datas ocupadas preservadas. | — (sem alteração) |
| [src/app/components/top-spaces/top-spaces.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/top-spaces/top-spaces.spec.ts:1) | Revisado: Teste analisado e executado; sem alteração necessária. | — (sem alteração) |
| [src/app/components/top-spaces/top-spaces.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/components/top-spaces/top-spaces.ts:1) | Revisado: Componente visual mínimo com OnPush; sem código de negócio a refatorar. | — (sem alteração) |
| [src/app/services/admin-auth.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/admin-auth.spec.ts:101) | Teste atualizado: MFA e gateway autorizado; casos de consultas transferidos ao teste do serviço responsável. | 101, 136 |
| [src/app/services/admin-auth.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/admin-auth.ts:38) | Refatorado: SRP: autenticação/MFA; etapas menores; gateway autorizado para o serviço de dados. | 38, 55, 91, 99 |
| [src/app/services/admin-data.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/admin-data.spec.ts:6) | Teste novo: Novo: consultas protegidas, seleção de campos, filtros de mês, RPCs e falhas. | 6, 17 |
| [src/app/services/admin-data.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/admin-data.ts:18) | Novo: Novo serviço de consultas/RPCs; campos explícitos, filtro de mês e autorização delegada. | 18, 30, 43 |
| [src/app/services/booking.models.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/booking.models.ts:1) | Revisado: Contratos de contato/reserva/calendário; mantidos e compilados. | — (sem alteração) |
| [src/app/services/finance-utils.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/finance-utils.spec.ts:3) | Teste novo: Novo: normalização monetária, mensagens públicas e idempotência por conteúdo. | 3 |
| [src/app/services/finance-utils.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/finance-utils.ts:5) | Novo: Conversão monetária, erros públicos e chave de reenvio isolados; corrigida aceitação de valor monetário ambíguo. | 5, 10, 16, 27 |
| [src/app/services/finance.models.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/finance.models.ts:22) | Refatorado: Contratos compartilhados ExpenseReport/FinanceOverview/FinanceAction; retiradas ações legadas sem consumo na aplicação. | 22, 28, 29 |
| [src/app/services/reservation-link.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/reservation-link.spec.ts:1) | Revisado: Teste analisado e executado; sem alteração necessária. | — (sem alteração) |
| [src/app/services/reservation-link.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/reservation-link.ts:1) | Revisado: Token retirado da barra de endereço; RPCs conferem propriedade. Mantido. | — (sem alteração) |
| [src/app/services/reservation-session.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/reservation-session.spec.ts:41) | Teste atualizado: Recibos adulterados, URLs executáveis/HTTP, estados e datas inválidos. | 41 |
| [src/app/services/reservation-session.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/reservation-session.ts:7) | Refatorado: Validação de identidade, links, estado e período do recibo; bloqueio de URLs inseguras; dados locais não concedem autorização. | 7, 11, 15, 29 |
| [src/app/services/site-config.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/site-config.spec.ts:31) | Teste atualizado: HTTPS em produção e exceção de HTTP para localhost/IPv4/IPv6 de desenvolvimento. | 31, 37 |
| [src/app/services/site-config.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/site-config.ts:14) | Refatorado: Recursos HTTPS em produção; HTTP restrito a loopback em desenvolvimento; preservadas chaves públicas. | 14 |
| [src/app/services/supabase-api.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/supabase-api.spec.ts:1) | Revisado: Teste analisado e executado; sem alteração necessária. | — (sem alteração) |
| [src/app/services/supabase-api.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/services/supabase-api.ts:1) | Revisado: RPCs públicas por serviço; configuração validada e falhas convertidas. Mantido. | — (sem alteração) |
| [src/app/shared/email/email.service.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/shared/email/email.service.spec.ts:1) | Revisado: Teste analisado e executado; sem alteração necessária. | — (sem alteração) |
| [src/app/shared/email/email.service.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/shared/email/email.service.ts:1) | Revisado: Responsabilidade de solicitar envio; timeout e confirmação; SMTP fora do navegador. | — (sem alteração) |
| [src/app/shared/formats/input-masks.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/shared/formats/input-masks.spec.ts:10) | Teste novo: Novo: colagem, truncamento, formatação e edição do cursor. | 10 |
| [src/app/shared/formats/input-masks.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/shared/formats/input-masks.ts:2) | Novo: Máscaras de telefone e dinheiro reutilizáveis, com posição do cursor preservada e documentação. | 2, 18 |
| [src/app/testing/pix-page.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/testing/pix-page.spec.ts:1) | Revisado: Teste analisado e executado; sem alteração necessária. | — (sem alteração) |
| [src/app/testing/runtime.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/testing/runtime.spec.ts:7) | Teste novo: Novo: execução isolada do runtime Deno com credenciais fictícias, fetch falso e erros sanitizados. | 7, 17 |
| [src/app/testing/secure-pages.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/testing/secure-pages.spec.ts:1) | Revisado: Teste analisado e executado; sem alteração necessária. | — (sem alteração) |
| [src/app/testing/send-email-worker.spec.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/testing/send-email-worker.spec.ts:1) | Revisado: Teste analisado e executado; sem alteração necessária. | — (sem alteração) |
| [src/app/testing/supabase.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/app/testing/supabase.ts:1) | Revisado: Fixtures de testes com dados e chaves fictícios; não são credenciais reais. | — (sem alteração) |
| [src/main.server.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/main.server.ts:1) | Revisado: Bootstrap SSR com BootstrapContext; mantido. | — (sem alteração) |
| [src/main.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/main.ts:1) | Revisado: Bootstrap Angular; erro de inicialização tratado; mantido. | — (sem alteração) |
| [src/setup-jest.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/src/setup-jest.ts:1) | Revisado: Ambiente zoneless de testes compatível com Angular 20; mantido. | — (sem alteração) |
| [supabase/functions/_shared/runtime.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/supabase/functions/_shared/runtime.ts:3) | Refatorado: Segredo JSON inválido não derruba a inicialização; RPC tipada como unknown e erros internos preservados fora da resposta pública. | 3, 13, 19 |
| [supabase/functions/send-email-worker/index.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/supabase/functions/send-email-worker/index.ts:1) | Revisado: Injeção de SMTP/RPC no worker; pin npm válido para Deno; mantido. | — (sem alteração) |
| [supabase/functions/send-email/index.ts](/Users/alexandreesteves/angular/FED-salao/fed-salao/supabase/functions/send-email/index.ts:1) | Revisado: Entrada Deno mínima, delegando ao handler; checagem Deno aprovada. | — (sem alteração) |

## Validação e limites

- Jest: **277 testes em 30 suítes**, aprovados; **100% de statements, branches, functions e lines no escopo `src/app` configurado no Jest**. O runtime Deno é exercitado em VM isolada, mas não está incluído nesse percentual.
- `tsc --project tsconfig.spec.json --noEmit`: aprovado.
- `npm run build:pages`: aprovado, com o aviso já existente de orçamento do bundle inicial.
- Checagem das duas funções Deno: aprovada. Testes de e-mail: **18 aprovados**. Testes SQL: **57 aprovados**.
- Navegador com banco PostgreSQL local: login/MFA, cadastro/exclusão de despesa e atualização do total aprovados; cinco resoluções sem transbordamento horizontal. Não houve gravação de pagamentos reais ou envio de e-mails nessa verificação.
- Não há promessa de eliminação de XSS ou de todas as vulnerabilidades: RLS, AAL2 e validação no servidor continuam obrigatórios. `any` remanescente em mocks e execução de código local em testes não foram tratados como execução dinâmica em produção.
- Código `.mjs`, políticas SQL e dependências externas não foram refatorados nesta inspeção restrita a `.ts`. Não foi feito commit, push ou publicação nesta etapa.
