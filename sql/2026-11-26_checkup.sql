-- ════════════════════════════════════════════════════════════════════
-- SMMD — Migration « checkup » du 26/11/2026
-- À exécuter UNE fois dans Supabase (SQL Editor) AVANT de déployer
-- la branche checkup-2026-11. Le script est rejouable sans risque.
-- ════════════════════════════════════════════════════════════════════

-- 1. Désactivation des comptes (remplace la suppression des membres)
alter table public.profiles add column if not exists actif boolean not null default true;
alter table public.profiles add column if not exists email text;

-- 2. Allocations : le membre DÉCLARE, le chef CONFIRME
--    Les lignes existantes sont considérées comme confirmées.
alter table public.allocations_versees add column if not exists statut text not null default 'confirme';
alter table public.allocations_versees add column if not exists date_confirmation timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'allocations_versees_statut_check') then
    alter table public.allocations_versees
      add constraint allocations_versees_statut_check check (statut in ('declare','confirme'));
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────
-- 3. Garde-fous côté serveur (indépendants des politiques RLS existantes)
--    Exécutés avec les droits du propriétaire pour lire le rôle de l'appelant.
--    Depuis le SQL Editor (auth.uid() vide), aucune restriction.
-- ────────────────────────────────────────────────────────────────────
create or replace function public.smmd_role_appelant()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.smmd_maison_appelant()
returns uuid language sql stable security definer set search_path = public as $$
  select maison_id from public.profiles where id = auth.uid()
$$;

-- 3a. Profils : seul l'admin change rôle, maison et activation ;
--     le chef peut modifier l'allocation des membres de SA maison.
create or replace function public.smmd_garde_profiles()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.smmd_role_appelant();
begin
  if auth.uid() is null or r = 'admin' then return new; end if;
  if new.role is distinct from old.role
     or new.maison_id is distinct from old.maison_id
     or new.actif is distinct from old.actif then
    raise exception 'Modification réservée à l''administrateur';
  end if;
  if old.id <> auth.uid() then
    if r <> 'chef' or old.maison_id is distinct from public.smmd_maison_appelant() then
      raise exception 'Profil non modifiable';
    end if;
    if new.iban is distinct from old.iban then
      raise exception 'Seul le membre peut modifier son IBAN';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists smmd_garde_profiles on public.profiles;
create trigger smmd_garde_profiles before update on public.profiles
  for each row execute function public.smmd_garde_profiles();

-- 3b. Allocations : un membre ne peut que déclarer / retirer SA déclaration.
create or replace function public.smmd_garde_allocations()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.smmd_role_appelant();
begin
  if auth.uid() is null or r in ('admin','chef') then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    if new.user_id <> auth.uid() then raise exception 'Déclaration pour un autre membre interdite'; end if;
    new.statut := 'declare'; new.valide_par := null; new.date_confirmation := null;
    return new;
  elsif tg_op = 'UPDATE' then
    raise exception 'Seul le chef de maison confirme un versement';
  else -- DELETE
    if old.user_id <> auth.uid() or old.statut <> 'declare' then
      raise exception 'Versement confirmé : seul le chef peut l''annuler';
    end if;
    return old;
  end if;
end $$;
drop trigger if exists smmd_garde_allocations on public.allocations_versees;
create trigger smmd_garde_allocations before insert or update or delete on public.allocations_versees
  for each row execute function public.smmd_garde_allocations();

-- 3c. Opérations : un membre ne peut pas se valider lui-même un remboursement.
create or replace function public.smmd_garde_transactions()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.smmd_role_appelant();
begin
  if auth.uid() is null or r in ('admin','chef') then return new; end if;
  if new.type = 'depense' and coalesce(new.methode_paiement,'') like 'perso\_%' then
    if tg_op = 'INSERT' then
      new.statut := 'attente';
    elsif coalesce(old.methode_paiement,'') not like 'perso\_%' then
      new.statut := 'attente';                 -- devient « à rembourser »
    else
      new.statut := old.statut;                -- le membre ne change pas le statut
      new.date_validation := old.date_validation;
    end if;
  else
    new.statut := 'valide';
  end if;
  return new;
end $$;
drop trigger if exists smmd_garde_transactions on public.transactions;
create trigger smmd_garde_transactions before insert or update on public.transactions
  for each row execute function public.smmd_garde_transactions();

-- 4. Comptes désactivés : plus aucune écriture possible
--    (la connexion est refusée par l'app ; ce garde-fou couvre les appels directs)
create or replace function public.smmd_garde_actif()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and exists (select 1 from public.profiles where id = auth.uid() and actif = false) then
    raise exception 'Compte désactivé';
  end if;
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
  foreach t in array array['transactions','allocations_versees','justificatifs_images','messages','conversations','notifications'] loop
    execute format('drop trigger if exists smmd_garde_actif on public.%I', t);
    execute format('create trigger smmd_garde_actif before insert or update or delete on public.%I for each row execute function public.smmd_garde_actif()', t);
  end loop;
end $$;
