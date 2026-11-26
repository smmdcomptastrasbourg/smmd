-- ════════════════════════════════════════════════════════════════════
-- SMMD — Paramètres comptables (SIREN, plan de comptes). Rejouable.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.parametres (
  cle        text primary key,
  valeur     jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.parametres enable row level security;
drop policy if exists "lecture parametres" on public.parametres;
create policy "lecture parametres" on public.parametres for select to authenticated using (true);
drop policy if exists "admin ecrit parametres" on public.parametres;
create policy "admin ecrit parametres" on public.parametres for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');
