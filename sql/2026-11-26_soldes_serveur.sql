-- ════════════════════════════════════════════════════════════════════
-- SMMD — Soldes calculés par la base (26/11/2026). Rejouable.
-- « security invoker » : chaque utilisateur ne voit que ce que la RLS lui permet.
-- ════════════════════════════════════════════════════════════════════
create or replace function public.smmd_soldes(p_maison uuid, p_debut timestamptz, p_fin timestamptz, p_mois int, p_annee int)
returns jsonb language sql stable security invoker set search_path = public as $$
  with t as (select type, montant, statut, user_id, created_at from public.transactions where maison_id = p_maison),
       a as (select montant, user_id, mois, annee from public.allocations_versees
             where maison_id = p_maison and coalesce(statut, 'confirme') = 'confirme')
  select jsonb_build_object(
    'solde_maison',    coalesce((select sum(montant) from a), 0)
                     + coalesce((select sum(case when type = 'recette' then montant else -montant end) from t), 0),
    'entrees_periode', coalesce((select sum(montant) from t where type = 'recette' and created_at >= p_debut and created_at < p_fin), 0)
                     + coalesce((select sum(montant) from a where mois = p_mois and annee = p_annee), 0),
    'sorties_periode', coalesce((select sum(montant) from t where type = 'depense' and created_at >= p_debut and created_at < p_fin), 0),
    'avances_attente', coalesce((select sum(montant) from t where type = 'depense' and statut = 'attente'), 0),
    'mon_solde',       coalesce((select sum(montant) from a where user_id = auth.uid()), 0)
                     + coalesce((select sum(case when type = 'recette' then montant else -montant end) from t where user_id = auth.uid()), 0),
    'mes_avances',     coalesce((select sum(montant) from t where user_id = auth.uid() and type = 'depense' and statut = 'attente'), 0)
  );
$$;
grant execute on function public.smmd_soldes(uuid, timestamptz, timestamptz, int, int) to authenticated;

-- Index utiles aux calculs et aux listes
create index if not exists transactions_maison_date_idx on public.transactions (maison_id, created_at desc);
create index if not exists transactions_user_date_idx   on public.transactions (user_id, created_at desc);
create index if not exists transactions_attente_idx     on public.transactions (maison_id) where statut = 'attente';
create index if not exists allocations_maison_idx       on public.allocations_versees (maison_id, annee, mois);
create index if not exists justif_images_tx_idx         on public.justificatifs_images (transaction_id);
