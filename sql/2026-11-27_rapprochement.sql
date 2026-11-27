-- ════════════════════════════════════════════════════════════════════
-- SMMD — Rapprochement bancaire par maison (27/11/2026). Rejouable.
-- Le chef rapproche sa maison, l'admin voit et peut agir sur toutes. Les membres n'y ont pas accès.
-- ════════════════════════════════════════════════════════════════════

-- 1. Un relevé par maison et par mois
create table if not exists public.releves_bancaires (
  id           uuid primary key default gen_random_uuid(),
  maison_id    uuid not null references public.maisons(id) on delete cascade,
  annee        int  not null,
  mois         int  not null check (mois between 1 and 12),
  solde_debut  numeric(12,2),
  solde_fin    numeric(12,2),
  source       text,                 -- csv | ofx | scan | manuel
  fichier      text,
  statut       text not null default 'en_cours' check (statut in ('en_cours','rapproche')),
  rapproche_le timestamptz,
  rapproche_par uuid,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  unique (maison_id, annee, mois)
);

-- 2. Les lignes du relevé (montant signé : + crédit, − débit)
create table if not exists public.lignes_bancaires (
  id          uuid primary key default gen_random_uuid(),
  releve_id   uuid not null references public.releves_bancaires(id) on delete cascade,
  maison_id   uuid not null references public.maisons(id) on delete cascade,
  date_op     date not null,
  libelle     text not null,
  montant     numeric(12,2) not null,
  cle         text not null,         -- anti-doublon : date|montant|libellé|n° d'occurrence
  statut      text not null default 'a_pointer' check (statut in ('a_pointer','pointe','ignore')),
  lien        jsonb,                 -- ce que la ligne justifie dans SMMD
  note        text,
  pointe_par  uuid,
  pointe_le   timestamptz,
  created_at  timestamptz not null default now(),
  unique (maison_id, cle)
);
create index if not exists lignes_bancaires_releve_idx on public.lignes_bancaires (releve_id);
create index if not exists lignes_bancaires_maison_idx on public.lignes_bancaires (maison_id, date_op);

-- 3. Droits : chef sur sa maison, admin partout
alter table public.releves_bancaires enable row level security;
alter table public.lignes_bancaires  enable row level security;
drop policy if exists "rapprochement releves" on public.releves_bancaires;
create policy "rapprochement releves" on public.releves_bancaires for all to authenticated
  using      (my_role() = 'admin' or (my_role() = 'chef' and maison_id = my_maison_id()))
  with check (my_role() = 'admin' or (my_role() = 'chef' and maison_id = my_maison_id()));
drop policy if exists "rapprochement lignes" on public.lignes_bancaires;
create policy "rapprochement lignes" on public.lignes_bancaires for all to authenticated
  using      (my_role() = 'admin' or (my_role() = 'chef' and maison_id = my_maison_id()))
  with check (my_role() = 'admin' or (my_role() = 'chef' and maison_id = my_maison_id()));
