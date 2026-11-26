-- ════════════════════════════════════════════════════════════════════
-- SMMD — Notifications sur téléphone (26/11/2026). Rejouable sans risque.
-- ════════════════════════════════════════════════════════════════════

-- 1. Abonnements : un par téléphone / navigateur
create table if not exists public.push_abonnements (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  appareil   text,
  created_at timestamptz not null default now()
);
create index if not exists push_abonnements_user_idx on public.push_abonnements (user_id);
alter table public.push_abonnements enable row level security;
drop policy if exists "mes abonnements" on public.push_abonnements;
create policy "mes abonnements" on public.push_abonnements for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2. Rappels automatiques : chaque jour à 9 h (heure de Paris ≈ 8 h UTC l'hiver)
--    Remplacez REMPLACER_PAR_CRON_SECRET par la valeur du secret CRON_SECRET de la fonction « push ».
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('smmd-rappels') where exists (select 1 from cron.job where jobname = 'smmd-rappels');
select cron.schedule('smmd-rappels', '0 8 * * *', $$
  select net.http_post(
    url     := 'https://xccnnckuphxloxfrqtkf.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'REMPLACER_PAR_CRON_SECRET'),
    body    := '{"action":"rappels"}'::jsonb
  );
$$);
