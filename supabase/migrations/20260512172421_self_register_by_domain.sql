-- Permitir self-INSERT: un user autenticado puede crear su propio profile
-- siempre que coincida el email del JWT y el auth_user_id sea su propio auth.uid().
-- El server hace el chequeo de dominio (.com.mx) antes de intentar el INSERT.
drop policy if exists "profiles_self_insert" on public.profiles;
create policy "profiles_self_insert"
  on public.profiles for insert
  with check (
    auth_user_id = auth.uid()
    and lower(email) = lower((auth.jwt() ->> 'email')::text)
  );
