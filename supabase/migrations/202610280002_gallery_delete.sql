begin;
grant delete on public.gallery_images to authenticated;
create policy gallery_admin_delete on public.gallery_images for delete to authenticated
  using ((select public.booking_admin_access()));

create function public.booking_gallery_delete(p_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if not public.booking_admin_access() then
    raise sqlstate 'PT403' using message = 'Acesso restrito.';
  end if;
  delete from public.gallery_images where id = p_id;
  if not found then raise sqlstate 'PT404' using message = 'Foto não encontrada.'; end if;
  return true;
end;
$$;
revoke all on function public.booking_gallery_delete(uuid) from public, anon, authenticated;
grant execute on function public.booking_gallery_delete(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
