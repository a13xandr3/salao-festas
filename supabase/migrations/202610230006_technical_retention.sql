-- Technical data only. Email delivery keys are permanent deduplication records.
begin;

create or replace function booking_private.purge_technical_data(
  p_dry_run boolean default true, p_batch_size integer default 5000
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $purge$
declare
  policy record; candidates text; affected bigint; result jsonb;
begin
  if p_dry_run is null or p_batch_size is null or p_batch_size not between 1 and 10000 then
    raise exception 'Informe simulação e lote entre 1 e 10000.';
  end if;
  if not p_dry_run and not pg_try_advisory_xact_lock(hashtextextended('booking-technical-retention', 0)) then
    return jsonb_build_object('dryRun',false,'skipped',true);
  end if;
  result := jsonb_build_object('dryRun',p_dry_run,'skipped',false,'batchSize',p_batch_size);
  for policy in select * from (values
    ('cronRuns', 'cron.job_run_details',
      $$end_time is not null and ((status = 'succeeded' and end_time < now() - interval '7 days')
        or (status = 'failed' and end_time < now() - interval '30 days'))$$,
      'end_time', 'delete'),
    ('expiredRateLimits', 'booking_private.rate_limits',
      $$expires_at < now() - interval '1 day'$$, 'expires_at', 'delete'),
    ('terminalEmailAttachments', 'booking_private.email_deliveries',
      $$status in ('sent','cancelled') and attachment is not null and updated_at < now() - interval '7 days'$$,
      'updated_at', 'clear_attachment')
  ) as policies(name, relation, predicate, sort_column, operation) loop
    affected := 0;
    if to_regclass(policy.relation) is not null then
      -- All SQL fragments come from the fixed policies above, never from callers.
      candidates := format('select ctid from %s where %s order by %I limit %s',
        policy.relation, policy.predicate, policy.sort_column, p_batch_size);
      if p_dry_run then
        execute 'select count(*) from (' || candidates || ') candidates' into affected;
      else
        candidates := candidates || ' for update skip locked';
        if policy.operation = 'delete' then
          execute format('delete from %s where ctid in (%s)', policy.relation, candidates);
        else
          -- Keep status, attempts, timestamps and keys: retries must remain idempotent.
          execute format('update %s set attachment = null where ctid in (%s)', policy.relation, candidates);
        end if;
        get diagnostics affected = row_count;
      end if;
    end if;
    result := result || jsonb_build_object(policy.name, affected);
  end loop;
  return result;
end;
$purge$;

revoke all on function booking_private.purge_technical_data(boolean,integer)
  from public, anon, authenticated, service_role;

-- Production already uses pg_cron for email retries. Keep local databases portable.
do $$ begin
  if exists(select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('booking-technical-retention', '20 6 * * *',
      'select booking_private.purge_technical_data(false);');
  else
    raise notice 'pg_cron ausente: rotina criada sem agendamento. Reaplique após habilitar pg_cron.';
  end if;
end $$;

commit;
