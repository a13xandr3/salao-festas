begin;

create table public.gallery_images (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null,
  album_name text not null check (length(btrim(album_name)) between 1 and 80),
  path text not null unique check (path ~ '^images/galeria/[a-f0-9-]{36}/[a-f0-9-]{36}\.(jpg|png|webp)$'),
  description text not null check (length(description) between 1 and 160),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  original_size integer not null check (original_size between 1 and 5242880),
  gzip_data bytea not null check (octet_length(gzip_data) between 18 and 5300000 and substring(gzip_data from 1 for 3) = decode('1f8b08', 'hex')),
  created_at timestamptz not null default now()
);
create index gallery_images_album on public.gallery_images (album_id, created_at, id);
alter table public.gallery_images enable row level security;
revoke all on public.gallery_images from public, anon, authenticated;
grant select on public.gallery_images to anon, authenticated;
grant insert on public.gallery_images to authenticated;
create policy gallery_public_read on public.gallery_images for select to anon, authenticated using (true);
create policy gallery_admin_insert on public.gallery_images for insert to authenticated
  with check ((select public.booking_admin_access()));

-- Um lote inteiro é gravado em uma única transação. Não aceita paths do cliente.
create function public.booking_gallery_upload(p_album uuid, p_name text, p_photos jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  album uuid := coalesce(p_album, gen_random_uuid());
  name text := btrim(p_name);
  photo jsonb;
  photo_id uuid;
  extension text;
  total_size bigint;
begin
  if not public.booking_admin_access() then raise sqlstate 'PT403' using message = 'Acesso restrito.'; end if;
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' then
    raise sqlstate 'PT400' using message = 'Lote inválido.';
  end if;
  if jsonb_array_length(p_photos) not between 1 and 20 then
    raise sqlstate 'PT400' using message = 'Envie de 1 a 20 fotos.';
  end if;
  if p_album is not null then
    select album_name into name from public.gallery_images where album_id = p_album limit 1;
    if not found then raise sqlstate 'PT404' using message = 'Álbum não encontrado.'; end if;
  end if;
  if name is null or length(name) not between 1 and 80 then
    raise sqlstate 'PT400' using message = 'Nome do álbum inválido.';
  end if;
  select sum((item->>'original_size')::integer) into total_size from jsonb_array_elements(p_photos) item;
  if total_size > 20971520 then raise sqlstate 'PT413' using message = 'Lote excede 20 MB.'; end if;
  for photo in select * from jsonb_array_elements(p_photos) loop
    photo_id := gen_random_uuid();
    extension := case photo->>'mime_type' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' else null end;
    insert into public.gallery_images (id, album_id, album_name, path, description, mime_type, original_size, gzip_data)
    values (photo_id, album, name, 'images/galeria/' || album || '/' || photo_id || '.' || extension,
      photo->>'description', photo->>'mime_type', (photo->>'original_size')::integer, decode(photo->>'gzip_hex', 'hex'));
  end loop;
  return jsonb_array_length(p_photos);
end;
$$;
revoke all on function public.booking_gallery_upload(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.booking_gallery_upload(uuid, text, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
