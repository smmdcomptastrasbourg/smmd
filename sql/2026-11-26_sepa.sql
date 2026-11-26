-- ════════════════════════════════════════════════════════════════════
-- SMMD — Virements SEPA (26/11/2026). Rejouable sans risque.
-- ════════════════════════════════════════════════════════════════════

-- 1. Compte bancaire de chaque maison (saisi par le chef de la maison)
create table if not exists public.comptes_maisons (
  maison_id  uuid primary key references public.maisons(id) on delete cascade,
  titulaire  text not null,
  iban       text not null,
  bic        text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.comptes_maisons enable row level security;
drop policy if exists "lecture compte maison" on public.comptes_maisons;
create policy "lecture compte maison" on public.comptes_maisons for select to authenticated
  using (my_role() = 'admin' or (my_role() = 'chef' and maison_id = my_maison_id()));
drop policy if exists "chef ecrit compte maison" on public.comptes_maisons;
create policy "chef ecrit compte maison" on public.comptes_maisons for all to authenticated
  using      (my_role() = 'admin' or (my_role() = 'chef' and maison_id = my_maison_id()))
  with check (my_role() = 'admin' or (my_role() = 'chef' and maison_id = my_maison_id()));

-- 2. Virements SEPA générés (pour confirmer « virement effectué » ensuite,
--    même depuis un autre appareil, et garder l'historique)
create table if not exists public.virements_sepa (
  id           uuid primary key default gen_random_uuid(),
  maison_id    uuid not null references public.maisons(id) on delete cascade,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  reference    text not null,
  date_execution date,
  nb_virements int not null,
  total        numeric(12,2) not null,
  detail       jsonb not null,          -- [{user_id, nom, iban, montant, tx_ids:[…]}]
  statut       text not null default 'genere' check (statut in ('genere','effectue','annule')),
  date_statut  timestamptz
);
create index if not exists virements_sepa_maison_idx on public.virements_sepa (maison_id, created_at desc);
alter table public.virements_sepa enable row level security;
drop policy if exists "chef virements" on public.virements_sepa;
create policy "chef virements" on public.virements_sepa for all to authenticated
  using      (my_role() = 'admin' or (my_role() = 'chef' and maison_id = my_maison_id()))
  with check (my_role() = 'admin' or (my_role() = 'chef' and maison_id = my_maison_id()));
