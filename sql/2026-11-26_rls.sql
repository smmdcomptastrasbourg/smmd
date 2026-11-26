-- ════════════════════════════════════════════════════════════════════
-- SMMD — Compléments RLS du 26/11/2026 (après 2026-11-26_checkup.sql)
-- Rejouable sans risque.
-- ════════════════════════════════════════════════════════════════════

-- 1. Allocations : le chef (ou l'admin) peut CONFIRMER une déclaration
--    (il n'existait aucune règle UPDATE : la confirmation était impossible)
drop policy if exists "confirmation chef" on public.allocations_versees;
create policy "confirmation chef" on public.allocations_versees
  for update to authenticated
  using      (my_role() = 'admin' or (my_role() = 'chef' and maison_id = my_maison_id()))
  with check (my_role() = 'admin' or (my_role() = 'chef' and maison_id = my_maison_id()));

-- 2. Allocations : on ne déclare que dans SA maison, pour soi (le chef pour sa maison)
drop policy if exists "insertion membre" on public.allocations_versees;
create policy "insertion membre" on public.allocations_versees
  for insert to authenticated
  with check (my_role() = 'admin'
              or (maison_id = my_maison_id() and (user_id = auth.uid() or my_role() = 'chef')));

-- 3. Conversations : mise à jour de la date du dernier message
--    (aucune règle UPDATE : la liste des conversations n'était jamais triée correctement)
drop policy if exists "update participants" on public.conversations;
create policy "update participants" on public.conversations
  for update to authenticated
  using      (user1_id = auth.uid() or user2_id = auth.uid())
  with check (user1_id = auth.uid() or user2_id = auth.uid());

-- 4. Messages : le destinataire ne peut que marquer « lu » ;
--    seul l'expéditeur modifie ou efface son message.
create or replace function public.smmd_garde_messages()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or old.sender_id = auth.uid() then return new; end if;
  if new.contenu is distinct from old.contenu
     or new.media_base64 is distinct from old.media_base64
     or new.deleted_at is distinct from old.deleted_at
     or new.sender_id is distinct from old.sender_id
     or new.conversation_id is distinct from old.conversation_id then
    raise exception 'Seul l''expéditeur peut modifier ce message';
  end if;
  return new;
end $$;
drop trigger if exists smmd_garde_messages on public.messages;
create trigger smmd_garde_messages before update on public.messages
  for each row execute function public.smmd_garde_messages();

-- 5. Notifications : seuls le chef et l'admin en créent pour les autres
--    (avant : n'importe quel compte pouvait envoyer un faux « virement reçu »)
drop policy if exists "insertion notif" on public.notifications;
create policy "insertion notif" on public.notifications
  for insert to authenticated
  with check (user_id = auth.uid() or my_role() in ('chef','admin'));

-- 6. Justificatifs : seul l'auteur de la dépense, le chef ou l'admin
--    peut ajouter ou supprimer des photos (avant : tout membre de la maison)
drop policy if exists "insertion justifs" on public.justificatifs_images;
create policy "insertion justifs" on public.justificatifs_images
  for insert to authenticated
  with check (exists (select 1 from public.transactions t
                      where t.id = justificatifs_images.transaction_id
                        and (t.user_id = auth.uid() or my_role() in ('chef','admin'))));
drop policy if exists "suppression justifs" on public.justificatifs_images;
create policy "suppression justifs" on public.justificatifs_images
  for delete to authenticated
  using (exists (select 1 from public.transactions t
                 where t.id = justificatifs_images.transaction_id
                   and (t.user_id = auth.uid() or my_role() in ('chef','admin'))));
