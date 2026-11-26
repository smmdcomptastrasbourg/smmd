-- ════════════════════════════════════════════════════════════════════
-- SMMD — Sauvegarde automatique (Google Drive pour l'instant). Rejouable.
-- ════════════════════════════════════════════════════════════════════

-- 1. Configuration privée (jeton Google) : AUCUNE politique → lisible seulement par la fonction serveur
create table if not exists public.sauvegarde_config (
  id            int primary key default 1 check (id = 1),
  destination   text not null default 'google_drive',
  compte        text,          -- adresse du compte Google connecté (affichage)
  refresh_token text,          -- secret : jamais lisible depuis l'app
  dossier_id    text,          -- dossier « SMMD sauvegardes » dans le Drive
  etat_oauth    text,          -- jeton anti-falsification pendant la connexion
  updated_at    timestamptz not null default now()
);
alter table public.sauvegarde_config enable row level security;
revoke all on public.sauvegarde_config from anon, authenticated;

-- 2. Dossiers et justificatifs déjà envoyés (sauvegarde incrémentale)
create table if not exists public.sauvegarde_dossiers (chemin text primary key, drive_id text not null);
alter table public.sauvegarde_dossiers enable row level security;
revoke all on public.sauvegarde_dossiers from anon, authenticated;
create table if not exists public.sauvegarde_justifs (image_id uuid primary key, drive_id text not null, envoye_le timestamptz not null default now());
alter table public.sauvegarde_justifs enable row level security;
revoke all on public.sauvegarde_justifs from anon, authenticated;

-- 3. Journal des sauvegardes : lisible par l'admin
create table if not exists public.sauvegarde_journal (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  type       text not null,        -- donnees | justificatifs | connexion
  ok         boolean not null,
  detail     text
);
alter table public.sauvegarde_journal enable row level security;
drop policy if exists "admin lit journal sauvegarde" on public.sauvegarde_journal;
create policy "admin lit journal sauvegarde" on public.sauvegarde_journal for select to authenticated using (my_role() = 'admin');

-- 4. Passage automatique chaque nuit à 3 h (UTC) : données chaque semaine, justificatifs nouveaux chaque nuit
--    Remplacez REMPLACER_PAR_CRON_SECRET par la valeur du secret CRON_SECRET (le même que pour « push »).
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('smmd-sauvegarde') where exists (select 1 from cron.job where jobname = 'smmd-sauvegarde');
select cron.schedule('smmd-sauvegarde', '0 3 * * *', $$
  select net.http_post(
    url     := 'https://xccnnckuphxloxfrqtkf.supabase.co/functions/v1/sauvegarde',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'REMPLACER_PAR_CRON_SECRET'),
    body    := '{"action":"auto"}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
