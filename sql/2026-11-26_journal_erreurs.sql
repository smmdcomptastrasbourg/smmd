-- ════════════════════════════════════════════════════════════════════
-- SMMD — Journal d'erreurs (26/11/2026). Rejouable sans risque.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.erreurs_app (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id    uuid,
  role       text,
  type       text,
  page       text,
  action     text,
  message    text not null,
  detail     text,
  appareil   text,
  version    text,
  en_ligne   boolean
);
create index if not exists erreurs_app_created_at_idx on public.erreurs_app (created_at desc);

alter table public.erreurs_app enable row level security;

-- Tout le monde (même sur la page de connexion) peut SIGNALER une erreur,
-- uniquement en son nom, avec des textes de taille limitée.
drop policy if exists "signaler erreur" on public.erreurs_app;
create policy "signaler erreur" on public.erreurs_app
  for insert to anon, authenticated
  with check (
    (user_id is null or user_id = auth.uid())
    and length(message) <= 500
    and length(coalesce(detail, '')) <= 1500
    and length(coalesce(action, '')) <= 120
  );

-- Seul l'admin lit et efface le journal.
drop policy if exists "admin lit erreurs" on public.erreurs_app;
create policy "admin lit erreurs" on public.erreurs_app
  for select to authenticated using (my_role() = 'admin');
drop policy if exists "admin efface erreurs" on public.erreurs_app;
create policy "admin efface erreurs" on public.erreurs_app
  for delete to authenticated using (my_role() = 'admin');

-- Ménage automatique : on ne garde que 90 jours d'erreurs
create or replace function public.smmd_purge_erreurs()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.erreurs_app where created_at < now() - interval '90 days';
  return null;
end $$;
drop trigger if exists smmd_purge_erreurs on public.erreurs_app;
create trigger smmd_purge_erreurs after insert on public.erreurs_app
  for each statement execute function public.smmd_purge_erreurs();
