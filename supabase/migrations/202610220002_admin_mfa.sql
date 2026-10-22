-- The allowlist and a signed AAL2 claim are both required for administrative access.
begin;

create or replace function booking_private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt()->>'aal') = 'aal2', false)
    and exists(select 1 from booking_private.admins where user_id = (select auth.uid()));
$$;
revoke all on function booking_private.is_admin() from public, anon, authenticated;
grant execute on function booking_private.is_admin() to authenticated;

-- AAL1 can only check its own eligibility to enroll MFA; no customer data is returned.
create or replace function public.booking_admin_eligible()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from booking_private.admins where user_id = (select auth.uid()));
$$;
create or replace function public.booking_admin_access()
returns boolean language sql stable security definer set search_path = '' as $$
  select booking_private.is_admin();
$$;
revoke all on function public.booking_admin_eligible(), public.booking_admin_access() from public, anon, authenticated;
grant execute on function public.booking_admin_eligible(), public.booking_admin_access() to authenticated;

notify pgrst, 'reload schema';
commit;
