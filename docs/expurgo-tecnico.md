# Expurgo de dados técnicos

A migração `supabase/migrations/202610230006_technical_retention.sql` cria a função privada `booking_private.purge_technical_data` e, quando a extensão `pg_cron` está habilitada, agenda `booking-technical-retention` diariamente às 06:20 UTC (03:20 em São Paulo na configuração UTC do projeto). Reaplicar a migração atualiza o job pelo nome, sem criar outro job.

| Dados | Política |
| --- | --- |
| Execuções de cron com sucesso | Excluir após 7 dias contados do término |
| Execuções de cron com falha | Excluir após 30 dias contados do término |
| Execuções ainda abertas ou de status desconhecido | Preservar |
| Controles de limite de submissões | Excluir somente se expirados há mais de 24 horas |
| Anexos residuais de e-mails enviados ou cancelados | Remover o anexo após 7 dias sem atualização; preservar o registro |
| Envios pendentes, em processamento ou com falha | Preservar registro e anexo para investigação e reenvio |
| Reservas, contatos, cancelamentos, financeiro e auditoria de preços | Preservar |
| Autenticação, Vault e arquivos do Storage | Não modificar |

Os registros de e-mail não são apenas logs: suas chaves evitam reenvio duplicado e limitam o número de PDFs distintos por reserva. Apagá-los por idade reabriria operações já concluídas. Anexos enviados já são removidos pelo worker; o expurgo trata resíduos antigos de estados terminais.

O `pg_net` tem retenção automática de respostas HTTP (`pg_net.ttl`, normalmente 6 horas). O expurgo não modifica filas HTTP nem o comportamento da extensão. Referências: [limpeza de históricos do Cron](https://supabase.com/docs/guides/cron/quickstart), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net).

## Implantação e operação

Aplicar a migração como proprietário do projeto, após as anteriores. Ela não executa exclusões imediatamente: apenas cria a função e o agendamento. Sem `pg_cron`, emite um aviso e cria somente a função; habilite a extensão e reaplique para ativar o agendamento.

A simulação é o comportamento padrão e não altera dados:

```sql
select booking_private.purge_technical_data();
```

A resposta contém `dryRun`, `skipped`, `batchSize` e as quantidades elegíveis por política. O lote padrão é de 5.000 registros por política e por execução. O máximo permitido é 10.000; contagens na simulação também respeitam o lote, não representam necessariamente todo o estoque elegível.

Execução manual pelo proprietário, se necessária:

```sql
select booking_private.purge_technical_data(false);
```

Execuções simultâneas de expurgo são serializadas por um lock de transação; se outra execução estiver ativa, retorna `skipped=true`. Registros bloqueados por outras operações são ignorados nessa rodada. O limite de espera por locks é de 2 segundos. A função não pode ser executada pelos papéis da aplicação, nem pelo worker de e-mail.

Monitoramento:

```sql
select jobname, schedule, active
from cron.job where jobname = 'booking-technical-retention';

select start_time, end_time, status, return_message
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'booking-technical-retention')
order by start_time desc limit 10;
```

Para pausar sem remover a função:

```sql
select cron.alter_job(jobid, active := false)
from cron.job where jobname = 'booking-technical-retention';
```

Exclusões liberam espaço para reutilização pelo PostgreSQL e são acompanhadas pelo autovacuum. O tamanho físico exibido pode não cair imediatamente. Não há `VACUUM FULL`, reescrita de tabelas ou limpeza do histórico de negócios nessa rotina. Com o worker atual executando a cada minuto, sete dias de sucessos representam aproximadamente 10.080 logs, além da margem até a próxima execução diária de limpeza. Falhas podem permanecer por até 30 dias mais essa margem. Se houver grande acúmulo anterior, o lote o reduz gradualmente; execute lotes adicionais manualmente apenas após verificar a simulação.
