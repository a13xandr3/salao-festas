# Revisão do Angular 20 e Supabase — 19/10/2026

Registro histórico da revisão. Em 20/10/2026, o FormSubmit foi substituído por Gmail SMTP; a configuração atual está em [GMAIL.md](../supabase/GMAIL.md).

## Resultado

Os onze componentes e o componente raiz foram revisados. O frontend agora depende somente do Supabase para persistência. Foram removidos a API JSON Server, o proxy, os scripts de servidor e o banco JSON local. As alterações são locais; a revisão não publica o site.

## Componentes

| Componente | Achado e correção |
| --- | --- |
| Navbar | SCSS de gradiente, logo e layout sem referências no template foi removido. OnPush explícito. |
| Presentation | Removidos seletores antigos de imagem, gradiente e tipografia que não eram usados. OnPush explícito. |
| TopSpaces | Removidos grid e estilos de cartões substituídos pelo layout Bootstrap já existente. OnPush explícito. |
| CelebrationArea | Removidos estilos de layout antigos e a margem repetida no componente raiz. OnPush explícito. |
| OurServices | Removidos gradiente, dimensões e comentários de estilos sem uso. OnPush explícito. |
| Footer | Consolidado o visual efetivo no SCSS, eliminando conflitos com estilos inline e um grid que era sobrescrito por flex. OnPush explícito. |
| Contact | Envio ao FormSubmit extraído para serviço. O componente mantém a orquestração e a retomada da persistência sem duplicar e-mail. Respostas sem confirmação explícita do provedor são tratadas como falha. |
| PreReservation | Removidas verificações de constantes sempre verdadeiras; mensagens por status substituem ternários encadeados. Persistência de sessão compartilhada com o cancelamento. Métodos tipados substituem URLs locais fictícias. |
| CancelPreReservation | Exclusão usa função Supabase com token no corpo. Remoção da confirmação de sessão foi centralizada e respeita o UUID correspondente. |
| ContractUpload | Acesso ao formulário individual usa serviço tipado. Mantida validação de extensão, tamanho e cabeçalho PDF. Uma leitura antiga de arquivo não sobrescreve um erro de seleção mais recente. Isso não equivale a validar assinatura digital. |
| ReservationCalendar | Removido o modelo horário que não era utilizado. Disponibilidade é indexada por data, sem busca repetida para cada dia. Eliminados ternários de status nos templates. Uma data futura sem resposta deixa de ser descrita como um período já iniciado. |
| App | Removido o signal de título sem uso e adotado OnPush. Mantida a pré-renderização estática com hidratação. |

## Compatibilidade e complexidade

Signals, input/output, computed, afterNextRender, takeUntilDestroyed, formulários reativos e withFetch são APIs compatíveis com o Angular 20 instalado. A ausência de `standalone: true` explícito é válida: os componentes são standalone por padrão. Bootstrap CSS e Luxon são bibliotecas utilizadas pela aplicação, não APIs Angular inválidas.

O interceptor que interpretava métodos, URLs, regex e subrotas foi removido. `SupabaseApi` agora expõe operações explícitas: criar contato, consultar disponibilidade, criar pré-reserva, recuperar formulário individual e cancelar. Configuração pública, geração de formulário FormSubmit e sessão do navegador têm responsabilidades separadas.

O envio por fetch e a criação de formulário nativo são necessários para os dois fluxos diferentes do FormSubmit. Não foram substituídos por APIs fictícias de e-mail do Angular ou do Supabase. O envio de e-mail e a confirmação de pagamento continuam dependendo dos respectivos serviços/equipe.

A revisão diminuiu ramificações e aninhamento nos pontos identificados; não apresenta uma pontuação formal de complexidade cognitiva ou ciclomática, porque não foi configurado um analisador dessa métrica no projeto.

Referências conferidas: [afterNextRender no Angular 20](https://v20.angular.dev/api/core/afterNextRender), [signals](https://v20.angular.dev/guide/signals), [OnPush](https://v20.angular.dev/best-practices/skipping-subtrees), [Data API Supabase](https://supabase.com/docs/guides/api).

## Remoção do db.json

As referências executáveis ao arquivo foram eliminadas junto com `server/`, `src/server.ts`, `proxy.conf.json` e os scripts `api`, `mail:check`, `test:api` e `serve:ssr:fed-salao`. As dependências de JSON Server, Express e proxy foram retiradas. A aplicação mantém o suporte Angular necessário para pré-renderizar HTML no build; não precisa executar Node.js no Pages.

O conteúdo anterior foi preservado fora do repositório em:

`/Users/alexandreesteves/.codex/backups/fed-salao/legacy-json-server-20261019/db.json`

A remoção é segura para o código atual, mas não importa os dados antigos para o Supabase. Registros reais e links anteriores exigem migração controlada antes de serem considerados ativos no sistema novo. O backup não é publicado. A remoção do arquivo atual também não apaga seu conteúdo do histórico Git.

## CRUD e permissões

| Operação | Quem pode executar | Evidência |
| --- | --- | --- |
| Criar contato | Visitante, pela função validada | PostgreSQL local; rejeição de entrada inválida no Supabase real |
| Consultar/alterar/excluir contatos | Administrador autorizado | CRUD completo e bloqueio de usuário comum testados no PostgreSQL local |
| Criar pré-reserva | Visitante, pela função validada | Criação sintética confirmada no Supabase real |
| Consultar agenda | Público, somente datas/status | Consulta real e testes de privacidade locais |
| Consultar dados individuais para contrato/e-mail | Portador do token correto | Consulta individual confirmada no Supabase real; token errado rejeitado localmente |
| Confirmar pagamento | Administrador autorizado | Função de atualização e bloqueio de usuário comum testados no PostgreSQL local |
| Cancelar pré-reserva | Portador do token; gestor pode excluir pelo painel | Exclusão sintética e liberação da data confirmadas no Supabase real |

A chave publicável é enviada somente no cabeçalho `apikey`. Não há `service_role` ou senha do banco no frontend. Acesso anônimo direto a `contacts` e `preReservations` retornou HTTP 401 no ambiente real. Os parâmetros de cancelamento vão no corpo da chamada RPC, sem token na URL da requisição.

A reserva sintética foi criada em uma data livre de janeiro de 2099, consultada e excluída em seguida. O calendário passou de livre para reservado e voltou a livre. Nenhum e-mail foi enviado. Nenhum contato de teste foi gravado remotamente, pois sua limpeza exigiria credenciais administrativas.

Não existe painel administrativo nem sessão de gestor no Angular. A atualização real de pagamento e o CRUD administrativo real continuam dependendo de acesso autorizado no Supabase. O teste local usa o mesmo SQL e simula os papéis e o UUID de autenticação, mas não comprova a configuração da conta administrativa remota.

## Verificações reproduzíveis

```bash
npm test -- --runInBand
npm run test:supabase
npx tsc --noEmit -p tsconfig.app.json --noUnusedLocals --noUnusedParameters
npx tsc --noEmit -p tsconfig.spec.json --noUnusedLocals --noUnusedParameters
npm run verify:supabase
npm run build:pages
```

O comando `npm run verify:supabase -- --write-reservation` é opcional e grava uma reserva sintética temporária, removida em `finally`. O workflow Pages usa apenas a verificação sem escrita.

## Limitações materiais

- O FormSubmit exige ativação do gestor e verificação do cliente. Os testes não comprovam entrega de e-mail.
- O contrato e a página Pix fornecidos ainda são demonstrativos.
- O limite de submissões é por e-mail e janela de tempo, não uma proteção completa contra robôs. O CAPTCHA do FormSubmit ocorre depois da criação da pré-reserva.
- A confirmação persistida vale para a sessão da aba e depende de o registro ainda existir no banco.
- O build estático passa, mas o bundle inicial continua acima do aviso configurado de 500 kB. O JavaScript Bootstrap sem uso foi retirado; os estilos Bootstrap usados pelo site foram preservados.

## Resultado final das verificações

- 46 testes Angular passaram em 16 suítes.
- 11 cenários SQL passaram; o runner contabiliza 12 testes incluindo o agrupador.
- Checagem de tipos da aplicação e dos testes passou, incluindo detecção de declarações/parâmetros sem uso. Essas verificações foram habilitadas permanentemente no tsconfig.
- Build Pages passou e gerou uma rota pré-renderizada. Bundle inicial: 675,21 kB, comparado aos aproximadamente 759,46 kB anteriores à revisão.
- Angular Core/Compiler e demais bibliotecas de framework: 20.3.34. CLI/Build/SSR: 20.3.40. A versão principal permanece 20.
- Auditoria de dependências de produção: zero vulnerabilidades conhecidas. Permanecem 21 avisos moderados nas dependências de desenvolvimento.
- 11 verificações remotas passaram, incluindo criação, consulta individual e exclusão da reserva sintética, com liberação da data.
- A alteração não exige reaplicar a migração SQL já executada: as mudanças desta revisão afetam o frontend, testes, dependências e documentação.
