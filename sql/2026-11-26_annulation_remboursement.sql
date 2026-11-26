-- ════════════════════════════════════════════════════════════════════
-- SMMD — Annulation d'un remboursement par le chef (26/11/2026). Rejouable.
-- Trace conservée : qui, quand, pourquoi.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.annulations_remboursement (
  id               uuid primary key default gen_random_uuid(),
  transaction_id   uuid not null references public.transactions(id) on delete cascade,
  maison_id        uuid not null references public.maisons(id) on delete cascade,
  membre_id        uuid,
  montant          numeric(12,2) not null,
  date_remboursement timestamptz,
  motif            text not null check (length(trim(motif)) >= 3),
  par              uuid not null default auth.uid(),
  created_at       timestamptz not null default now()
);
create index if not exists annulations_remb_tx_idx on public.annulations_remboursement (transaction_id);
alter table public.annulations_remboursement enable row level security;

-- Lecture : le chef et l'admin de la maison, et le membre concerné
drop policy if exists "lecture annulations" on public.annulations_remboursement;
create policy "lecture annulations" on public.annulations_remboursement for select to authenticated
  using (my_role() = 'admin' or (my_role() = 'chef' and maison_id = my_maison_id()) or membre_id = auth.uid());
-- Création : seulement le chef de la maison (ou l'admin), en son propre nom
drop policy if exists "chef annule" on public.annulations_remboursement;
create policy "chef annule" on public.annulations_remboursement for insert to authenticated
  with check (par = auth.uid() and (my_role() = 'admin' or (my_role() = 'chef' and maison_id = my_maison_id())));
-- Pas de modification ni de suppression : la trace est définitive
