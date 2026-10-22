# Área restrita — Supabase Auth + TOTP

Acesso: `https://www.salaoespacotx.com.br/?area=restrita` (local: `http://localhost:4209/?area=restrita`). O parâmetro evita erro de rota/refresh no GitHub Pages. A página pública permanece prerenderizada; o login e o SDK de autenticação são carregados sob demanda.

## Fluxo implementado

1. E-mail e senha são enviados por HTTPS ao Supabase Auth, usando o SDK oficial. Não existe cadastro público nesta interface.
2. O banco confirma se o usuário consta em `booking_private.admins`. Esta etapa retorna somente um booleano sobre o próprio usuário, sem dados de clientes.
3. No primeiro acesso, o Supabase gera um fator TOTP. O usuário escaneia o QR Code em um Authenticator e informa seis dígitos. Cadastros TOTP não concluídos são limpos na próxima tentativa; fatores já verificados são preservados.
4. Nos acessos seguintes, o usuário informa o código do fator já cadastrado.
5. Somente após validar o código, obter uma sessão `aal2` e confirmar a autorização no banco, a interface apresenta o componente `painel`.
6. Logout ou perda da sessão removem o painel. Tokens e segredo de cadastro não são gravados em localStorage, sessionStorage, URLs ou logs. Recarregar/fechar a aba exige novo login. O segredo sai da interface após a confirmação.

A entrada Área restrita abre uma nova aba, com `noopener noreferrer`. O login e o painel permanecem nessa aba, sem transferir tokens entre janelas. O painel contém identificação da sessão, Logout e links para listar contatos e pré-reservas. As consultas são somente de leitura, limitadas aos 100 registros mais recentes e às colunas exibidas, sem tokens individuais. As policies RLS continuam exigindo administrador e AAL2. Alterações/exclusões administrativas não fazem parte desta interface.

## Ativação no Supabase hospedado

Estas configurações são do Supabase Auth da aplicação, não do login da conta no Dashboard. O arquivo `supabase/config.toml` sozinho não altera um projeto hospedado.

1. Aplicar `supabase/migrations/202610220002_admin_mfa.sql` no SQL Editor. Ela exige `aal2` **e** presença na lista de administradores na função já utilizada pelas policies RLS e pela confirmação de pagamento. Usuários autenticados somente com senha deixam de acessar os registros protegidos. Não altera dados de clientes.
2. Em Authentication, habilitar o provedor Email e o MFA TOTP (enrollment e verification). Manter fatores por telefone desabilitados se a política é exclusivamente Authenticator.
3. Desabilitar novos cadastros públicos. Criar os administradores em Authentication → Users, com e-mail validado e senha forte individual. Não colocar senhas no SQL, código-fonte, `.env` público ou chat.
4. Configurar senha mínima de **15 caracteres**, preferindo uma frase-senha única ou gerada por gerenciador. Permitir colar e usar gerenciadores. Não exigir trocas periódicas sem comprometimento nem regras artificiais de composição. O login não impõe tamanho mínimo: a política precisa estar no servidor para criação/alteração, sem impedir a troca de uma senha antiga. O serviço usa bcrypt; respeitar os limites documentados pelo provedor.
5. Ativar a proteção contra senhas vazadas se disponível no plano (atualmente Pro ou superior). Manter reautenticação para alterações sensíveis e rotação de refresh tokens habilitadas. Revisar limites de tentativas do Auth; os erros de login exibidos são genéricos para evitar enumeração de contas.
6. Configurar a Site URL com o domínio HTTPS do site. Não autorizar redirects genéricos. Esta implementação não consome tokens de recuperação ou de login recebidos pela URL.
7. Autorizar cada administrador no SQL Editor, usando o UUID exibido em Authentication → Users:

```sql
insert into booking_private.admins (user_id)
values ('UUID-DO-USUARIO-DO-AUTH')
on conflict (user_id) do nothing;
```

O e-mail sozinho não concede permissão. Não expor `booking_private` na API nem conceder escrita nesta tabela aos usuários da aplicação. Nunca usar `service_role` ou secret key no navegador.

8. Fazer o primeiro login e confirmar o cadastro do Authenticator com o próprio aparelho. Para testar negativa: credenciais erradas, TOTP incorreto/expirado, conta fora da lista e acesso à API com JWT `aal1` devem ser recusados; JWT `aal2` de administrador pode acessar dados. Os testes automatizados usam mocks e PostgreSQL local, sem criar contas ou enviar mensagens reais.

## Recuperação e sessões

A interface não oferece remoção de MFA, recuperação automática nem bypass por e-mail. Antes do uso operacional, definir um procedimento administrativo para perda do Authenticator: validar a identidade por canal confiável e gerenciar os fatores pelo Supabase com conta administrativa protegida. Nunca remover MFA por simples solicitação de e-mail.

Sessão em memória reduz a persistência de credenciais, mas não torna o navegador imune a XSS. O SDK mantém refresh automático enquanto a aba está aberta. Configurar expiração do JWT e, se disponível no plano, timeout de inatividade e duração máxima no Supabase. Logout revoga refresh tokens; JWTs já emitidos podem continuar válidos até expirar. Remover a entrada em `booking_private.admins` bloqueia imediatamente as operações protegidas pela função `is_admin()`, mesmo com JWT ainda válido.

## Proteções e limites

- Autorização no PostgreSQL: não depende de esconder componentes, de flags no navegador ou de um route guard. A API verifica JWT assinado; as policies consultam o nível `aal2` e a allowlist.
- Dados exibidos por interpolação Angular, sem `innerHTML`, `eval` ou `bypassSecurityTrust*` neste fluxo. QR do Supabase é exibido como imagem, sem injetar SVG no DOM.
- Build de produção adiciona CSP ao HTML **após** o prerender, com hashes dos scripts inline, sem `unsafe-inline`/`unsafe-eval` para scripts. `script-src 'self'` permite os bundles locais e os hashes preservam os scripts de hidratação e do Pix. Conexões ficam limitadas ao próprio site e ao Supabase configurado; plugins, objetos e frames são bloqueados. Estilos inline continuam permitidos, necessários ao projeto atual. A extração de CSS crítico foi desabilitada para eliminar o handler inline `onload` que a CSP bloquearia. O documento principal usa `no-referrer`.
- GitHub Pages não permite definir livremente headers HTTP. A CSP por meta não suporta `frame-ancestors`; proteção completa contra clickjacking por esse header exige controle da camada HTTP. Não há cookie de autenticação automático neste fluxo; chamadas administrativas usam Bearer, reduzindo CSRF clássico. XSS e phishing continuam ameaças: TOTP não é resistente a phishing como WebAuthn/passkeys.
- Rate limiting real é do Supabase Auth; desabilitar o botão durante envio evita duplicação acidental e não substitui essa proteção.

Referências: [Supabase TOTP](https://supabase.com/docs/guides/auth/auth-mfa/totp), [segurança de senhas](https://supabase.com/docs/guides/auth/password-security), [limites](https://supabase.com/docs/guides/auth/rate-limits), [Angular Security](https://angular.dev/best-practices/security), [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).

## Auditoria das dependências nesta implementação

SDK Supabase fixado em `2.118.0`. Atualizações compatíveis da CLI/build Angular e dependências transitivas removeram os achados altos das ferramentas. `npm audit --omit=dev` retornou zero vulnerabilidades conhecidas. O audit completo ainda relata 21 moderadas na cadeia de ferramentas Jest (fora dos bundles de produção); não foi aplicado o downgrade incompatível sugerido pelo comando automático.
