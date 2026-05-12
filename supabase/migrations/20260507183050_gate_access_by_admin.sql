-- Gate access by admin-created profile.
-- Antes: trigger on_auth_user_created creaba un profile en cada login de Google.
-- Ahora: el admin crea profiles con un email; el primer login lo "reclama" linkeando
-- auth.users.id al campo nuevo profiles.auth_user_id. Sin profile pre-creado, no hay acceso.

-- 1. Sacar el trigger de auto-creación.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- 2. Nueva columna auth_user_id (la "llave" de un user logueado a su profile).
alter table public.profiles
  add column auth_user_id uuid unique references auth.users(id) on delete set null;

-- 3. Backfill: existing rows tenían profile.id == auth.users.id (legacy).
update public.profiles set auth_user_id = id where auth_user_id is null;

-- 4. Decoupling: profile.id deja de ser FK a auth.users.id. Pasa a ser un UUID propio.
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles alter column id set default gen_random_uuid();

-- 5. email unique → es la llave que el admin usa para invitar antes del primer login.
-- Ojo: en lower() para evitar duplicados por mayúsculas. Constraint + unique index.
update public.profiles set email = lower(email);
alter table public.profiles add constraint profiles_email_unique unique (email);
create index if not exists profiles_email_lower_idx on public.profiles (lower(email));

-- 6. is_admin() ahora resuelve por auth_user_id.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where auth_user_id = auth.uid() and role = 'admin'
  );
$$;

-- 7. Políticas de profiles: el "own" se evalúa contra auth_user_id.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = auth_user_id);

-- Self-claim: en el primer login, el user puede setear auth_user_id de SU profile
-- (el que tiene su email y aún no fue claimed). Sin esta policy el server no podría
-- linkear desde el JWT del user (la service_role no se usa en este flujo).
drop policy if exists "profiles_claim_self_by_email" on public.profiles;
create policy "profiles_claim_self_by_email"
  on public.profiles for update
  using (
    auth_user_id is null
    and lower(email) = lower((auth.jwt() ->> 'email')::text)
  )
  with check (auth_user_id = auth.uid());

-- profiles_select_admin y profiles_update_admin no cambian (siguen usando is_admin()).

-- 8. Políticas de events: ahora events.user_id = profiles.id, que ya no es auth.uid().
-- Hay que resolver via JOIN con profiles.
drop policy if exists "events_insert_own" on public.events;
create policy "events_insert_own"
  on public.events for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.auth_user_id = auth.uid() and p.id = user_id
    )
  );

drop policy if exists "events_select_own" on public.events;
create policy "events_select_own"
  on public.events for select
  using (
    exists (
      select 1 from public.profiles p
      where p.auth_user_id = auth.uid() and p.id = user_id
    )
  );

-- events_select_admin no cambia.

-- 9. Permitir que un admin INSERT un profile nuevo (para invitar usuarios).
drop policy if exists "profiles_insert_admin" on public.profiles;
create policy "profiles_insert_admin"
  on public.profiles for insert
  with check (public.is_admin());
