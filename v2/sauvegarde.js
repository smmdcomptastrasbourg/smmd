// ═══════════════════════════════════════════════════════════
// SMMD v2 — Sauvegarde (admin) : Google Drive automatique + téléchargement manuel
// ═══════════════════════════════════════════════════════════
const SV_DESTINATIONS = { google_drive: 'Google Drive' };   // d'autres destinations pourront s'ajouter ici

async function appelSauvegarde(action) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${SMMD_CONFIG.url}/functions/v1/sauvegarde`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': SMMD_CONFIG.key, 'Authorization': `Bearer ${session?.access_token}` },
    body: JSON.stringify({ action })
  });
  const r = await res.json().catch(() => ({}));
  if (res.status === 404) throw new Error('Fonction « sauvegarde » non déployée dans Supabase');
  if (!res.ok) throw new Error(r.error || 'Erreur ' + res.status);
  return r;
}

async function chargerSauvegarde() {
  const box = document.getElementById('sv-etat');
  if (!box) return;
  box.innerHTML = '<div class="skel" style="height:60px"></div>';
  let e;
  try { e = await appelSauvegarde('etat'); }
  catch (err) { box.innerHTML = `<p class="small warn" style="margin:0">${escapeHtml(err.message)}. Le téléchargement manuel reste disponible.</p>`; return; }
  const der = t => e.journal.find(j => j.type === t && j.ok);
  const fmt = d => new Date(d).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  // Le journal est du plus récent au plus ancien : un échec compte s'il n'a pas été suivi d'une sauvegarde réussie
  const iEchec = e.journal.findIndex(j => !j.ok), iOk = e.journal.findIndex(j => j.ok && j.type !== 'connexion');
  const echec = e.journal[iEchec], echecRecent = iEchec >= 0 && (iOk < 0 || iEchec < iOk);
  box.innerHTML = `
    <div class="between" style="padding:4px 0"><span class="muted">Destination</span><b>${escapeHtml(SV_DESTINATIONS[e.destination] || e.destination)}</b></div>
    <div class="between" style="padding:4px 0"><span class="muted">Compte</span><b>${e.connecte ? escapeHtml(e.compte || 'connecté') : '<span class="warn">non connecté</span>'}</b></div>
    ${e.connecte ? `
    <div class="between" style="padding:4px 0"><span class="muted">Dernière sauvegarde des données</span><b>${der('donnees') ? fmt(der('donnees').created_at) : '—'}</b></div>
    <div class="between" style="padding:4px 0"><span class="muted">Justificatifs copiés</span><b class="num">${e.justifs_envoyes} / ${e.justifs_total}</b></div>
    ${echecRecent ? `<p class="small red" style="margin:6px 0 0">Dernier échec (${fmt(echec.created_at)}) : ${escapeHtml(echec.detail || '')}</p>` : ''}
    <p class="small muted" style="margin:6px 0 0">Automatique chaque nuit : les données chaque semaine (12 dernières gardées), les nouveaux justificatifs chaque nuit.</p>
    <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:10px">
      <button class="btn primary" id="sv-lancer" onclick="lancerSauvegarde()">Sauvegarder maintenant</button>
      ${e.dossier ? `<a class="btn quiet" href="${escapeHtml(e.dossier)}" target="_blank" rel="noopener">Ouvrir le dossier Drive</a>` : ''}
      <button class="btn quiet" onclick="deconnecterDrive()">Déconnecter</button>
    </div>` : `
    <p class="small muted" style="margin:6px 0 10px">${e.configure ? 'Connectez le compte Google qui recevra les sauvegardes. SMMD n\'aura accès qu\'aux fichiers qu\'il crée lui-même.' : 'Les identifiants Google (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) ne sont pas encore définis dans Supabase.'}</p>
    <button class="btn primary" ${e.configure ? '' : 'disabled'} onclick="connecterDrive()">Connecter Google Drive</button>`}
    ${e.journal.length ? `<details style="margin-top:10px"><summary class="small" style="cursor:pointer">Historique</summary>
      <ul class="small" style="margin:6px 0 0;padding-left:18px">${e.journal.map(j => `<li class="${j.ok ? '' : 'red'}">${fmt(j.created_at)} · ${escapeHtml(j.detail || j.type)}</li>`).join('')}</ul></details>` : ''}`;
}
async function connecterDrive() {
  try { const r = await appelSauvegarde('connecter'); location.href = r.url; }
  catch (e) { showToast(e.message, 'error'); }
}
async function lancerSauvegarde() {
  const b = document.getElementById('sv-lancer'); if (b) { b.disabled = true; b.textContent = 'Sauvegarde en cours…'; }
  try { const r = await appelSauvegarde('lancer'); showToast('Sauvegarde faite : ' + (r.resultat || []).join(' · '), 'success'); }
  catch (e) { showToast('Sauvegarde impossible : ' + e.message, 'error'); }
  chargerSauvegarde();
}
function deconnecterDrive() {
  showConfirm('Déconnecter Google Drive ? Les sauvegardes automatiques s\'arrêtent ; les fichiers déjà dans le Drive restent.', async () => {
    try { await appelSauvegarde('deconnecter'); showToast('Drive déconnecté', 'success'); } catch (e) { showToast(e.message, 'error'); }
    chargerSauvegarde();
  }, 'Déconnecter');
}

// Téléchargement manuel de toutes les données (sans les photos, qui ont leur export ZIP)
async function telechargerSauvegarde() {
  const tables = ['maisons', 'profiles', 'motifs', 'transactions', 'allocations_versees', 'comptes_maisons', 'virements_sepa', 'annulations_remboursement', 'parametres'];
  showToast('Préparation de la sauvegarde…', 'info');
  const out = { application: 'SMMD', date: new Date().toISOString(), tables: {} }, manques = [];
  for (const t of tables) {
    try { out.tables[t] = (await fetchAll(() => sb.from(t).select('*').order(t === 'parametres' ? 'cle' : t === 'comptes_maisons' ? 'maison_id' : 'id')))
      .map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !/base64/i.test(k)))); }
    catch (e) { manques.push(t); }
  }
  const nom = `smmd-donnees-${new Date().toISOString().slice(0, 10)}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  showToast(manques.length ? `Sauvegarde téléchargée (non lues : ${manques.join(', ')})` : 'Sauvegarde téléchargée', manques.length ? 'warning' : 'success');
}

// Retour de Google après connexion
(function retourDrive() {
  const r = new URLSearchParams(location.search).get('drive');
  if (!r) return;
  history.replaceState(null, '', location.pathname);
  const msg = { ok: ['Google Drive connecté : première sauvegarde cette nuit (ou « Sauvegarder maintenant »)', 'success'], annule: ['Connexion à Google annulée', 'warning'],
    refuse: ['Connexion refusée (lien expiré) : recommencez', 'error'], erreur: ['Google n\'a pas donné d\'accès durable : recommencez la connexion', 'error'] }[r];
  const t = setInterval(() => { if (typeof userProfile !== 'undefined' && userProfile?.id && typeof go === 'function') { clearInterval(t); go('outils'); if (msg) showToast(...msg); } }, 300);
  setTimeout(() => clearInterval(t), 20000);
})();
