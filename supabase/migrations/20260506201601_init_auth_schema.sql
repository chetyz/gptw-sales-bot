-- Profiles: extends auth.users with app-level fields and per-user permissions.
create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text not null,
  display_name        text,
  role                text not null default 'user' check (role in ('admin', 'user')),
  can_chat            boolean not null default true,
  can_view_reports    boolean not null default true,
  can_save_reports    boolean not null default true,
  can_generate_charts boolean not null default true,
  can_export          boolean not null default false,
  created_at          timestamptz not null default now(),
  last_login_at       timestamptz
);

-- Events: append-only log of user actions for analytics.
create table public.events (
  id         bigserial primary key,
  user_id    uuid references public.profiles(id) on delete set null,
  type       text not null check (type in (
    'login',
    'chat_message',
    'artifact_generated',
    'report_viewed',
    'report_exported'
  )),
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index events_user_id_created_at_idx on public.events (user_id, created_at desc);
create index events_type_created_at_idx    on public.events (type,    created_at desc);

-- Trigger: auto-create a profile when a new auth.users row is inserted.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper: detect admin from the JWT's auth.uid().
-- security definer bypasses RLS, avoiding recursion when used inside policies.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- RLS
alter table public.profiles enable row level security;
alter table public.events   enable row level security;

-- profiles: user reads own row, admin reads/updates everyone.
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_select_admin"
  on public.profiles for select
  using (public.is_admin());

create policy "profiles_update_admin"
  on public.profiles for update
  using (public.is_admin())
  with check (public.is_admin());

-- events: server inserts as the user (auth.uid() = user_id).
-- user reads own events, admin reads everyone.
create policy "events_insert_own"
  on public.events for insert
  with check (auth.uid() = user_id);

create policy "events_select_own"
  on public.events for select
  using (auth.uid() = user_id);

create policy "events_select_admin"
  on public.events for select
  using (public.is_admin());

-- Backfill: any auth.users that already exist (e.g. you, who logged in before
-- this migration) get a profile row.
insert into public.profiles (id, email, display_name)
select
  u.id,
  u.email,
  coalesce(
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    split_part(u.email, '@', 1)
  )
from auth.users u
on conflict (id) do nothing;

-- Bootstrap: the earliest registered user becomes admin.
update public.profiles
set role = 'admin'
where id = (select id from public.profiles order by created_at asc limit 1);
