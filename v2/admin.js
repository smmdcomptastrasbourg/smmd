// ═══════════════════════════════════════════════════════════
// SMMD v2 — Espace administrateur (s'appuie sur commun.js)
// ═══════════════════════════════════════════════════════════
_vue = 'tdb';
let maisons = [], comptes = [];
const VUES = ['tdb', 'membres', 'maisons', 'exports', 'compta', 'erreurs', 'outils'];
const nomMaison = id => maisons.find(m => m.id === id)?.nom || '—';
const ROLES = { user: 'Membre', chef: 'Chef de maison', admin: 'Administrateur' };

function go(v) {
  _vue = v;
  VUES.forEach(n => document.getElementById('v-' + n).classList.toggle('hidden', n !== v));
  document.querySelectorAll('.tab, .sidenav button[data-v]').forEach(t => {
    const on = t.dataset.v === v || (t.dataset.v === 'plus' && ['maisons', 'compta', 'outils'].includes(v));
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0 });
  rafraichirVue();
}
function rafraichirVue() { ({ tdb: chargerTdb, membres: chargerComptes, maisons: chargerMaisons, exports: initExports, compta: () => initCompta(), erreurs: chargerErreurs, outils: () => chargerSauvegarde() })[_vue]?.(); }
function menuPlus() {
  ouvrirFeuille(`<div class="stack" style="gap:10px">
    <button class="btn quiet block" onclick="fermerFeuille();go('maisons')">Maisons et motifs</button>
    <button class="btn quiet block" onclick="fermerFeuille();go('compta')">Comptabilité (FEC)</button>
    <button class="btn quiet block" onclick="fermerFeuille();go('outils')">Outils et profil</button></div>`, { titre: 'Plus' });
}
function compteur(cle, n) { document.querySelectorAll(`[data-cnt="${cle}"]`).forEach(b => { b.textContent = n > 99 ? '99+' : n; b.classList.toggle('hidden', !n); }); }

async function init() {
  const ctx = await demarrerSession();
  if (!ctx) return;
  const profile = ctx.profile;
  if (!(await verifierCompteActif(profile))) return;
  if (profile.role !== 'admin') { location.href = profile.role === 'chef' ? 'chef.html' : 'membre.html'; return; }
  userProfile = profile;
  document.getElementById('p-version').textContent = 'Version ' + (window.SMMD_VERSION || '') + ' · nouvelle interface';
  await chargerReferentiels();
  go('tdb');
  compterMessages().then(() => compteur('msg', parseInt(document.getElementById('msg-badge').textContent) || 0));
}
async function chargerReferentiels() {
  const [m, c] = await Promise.all([sb.from('maisons').select('*').order('nom'), fetchAll(() => sb.from('profiles').select('*').order('prenom'))]);
  maisons = m.data || []; comptes = c;
}

// ─────────────────────────────────────────────── Vue d'ensemble
async function chargerTdb() {
  const now = new Date(), mo = now.getMonth() + 1, an = now.getFullYear();
  let allocs, nErr = 0, serveur;
  try {
    allocs = await fetchAll(() => sb.from('allocations_versees').select('maison_id,montant,statut,mois,annee').order('id'));
    const r = await sb.from('erreurs_app').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 86400000).toISOString());
    nErr = r.count || 0;
    serveur = await Promise.all(maisons.map(m => soldesServeur(m.id, an, mo)));
    if (serveur.some(x => !x)) {   // repli : calcul dans l'app si la fonction SQL n'est pas installée
      const txs = await fetchAll(() => sb.from('transactions').select('maison_id,type,montant,statut').order('id'));
      const conf = allocs.filter(allocConfirmee), sm = (arr, f) => arr.filter(f).reduce((x, y) => x + parseFloat(y.montant), 0);
      serveur = maisons.map(m => { const t = txs.filter(x => x.maison_id === m.id), a = conf.filter(x => x.maison_id === m.id);
        return { soldeMaison: sm(a, () => true) + sm(t, x => x.type === 'recette') - sm(t, x => x.type === 'depense'), avances: sm(t, x => x.type === 'depense' && x.statut === 'attente') }; });
    }
  } catch (e) { return showToast('Erreur de chargement : ' + e.message, 'error'); }
  compteur('err', nErr);
  const conf = allocs.filter(allocConfirmee);
  const lignes = maisons.map((m, i) => ({
    m, solde: serveur[i].soldeMaison, att: serveur[i].avances,
    decl: allocs.filter(x => x.maison_id === m.id && !allocConfirmee(x)).length,
    allocMois: conf.filter(x => x.maison_id === m.id && parseInt(x.mois) === mo && parseInt(x.annee) === an).length,
    membres: comptes.filter(c => c.maison_id === m.id && c.actif !== false).length
  }));
  document.getElementById('k-solde').textContent = eur(lignes.reduce((s, l) => s + l.solde, 0));
  document.getElementById('k-att').textContent = eur(lignes.reduce((s, l) => s + l.att, 0));
  document.getElementById('k-comptes').textContent = comptes.filter(c => c.actif !== false).length;
  document.getElementById('k-err').textContent = nErr;
  document.getElementById('t-maisons').innerHTML = `<table class="tbl"><thead><tr><th scope="col">Maison</th><th scope="col" class="r">Membres actifs</th><th scope="col" class="r">Solde</th><th scope="col" class="r">Avances en attente</th><th scope="col" class="r">Allocations ${MOIS[mo - 1]}</th><th scope="col" class="r">À confirmer</th></tr></thead>
    <tbody>${lignes.map(l => `<tr style="cursor:default"><td class="bold">${escapeHtml(l.m.nom)}</td><td class="r num">${l.membres}</td><td class="r num bold ${l.solde < 0 ? 'red' : ''}">${eur(l.solde)}</td><td class="r num ${l.att ? 'warn bold' : 'muted'}">${eur(l.att)}</td><td class="r num">${l.allocMois} / ${comptes.filter(c => c.maison_id === l.m.id && c.actif !== false && parseFloat(c.allocation_mensuelle) > 0).length}</td><td class="r">${l.decl ? `<span class="pill warn">${l.decl}</span>` : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table>`;
}

// ─────────────────────────────────────────────── Comptes
async function chargerComptes() {
  await chargerReferentiels();
  const sel = document.getElementById('m-maison'), v = sel.value;
  sel.innerHTML = '<option value="">Toutes</option>' + maisons.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.nom)}</option>`).join('');
  sel.value = v;
  afficherComptes();
}
function afficherComptes() {
  const q = document.getElementById('m-q').value.trim().toLowerCase(), mai = document.getElementById('m-maison').value, et = document.getElementById('m-etat').value;
  const l = comptes.filter(c => (!mai || c.maison_id === mai) && (et === 'actifs' ? c.actif !== false : et === 'inactifs' ? c.actif === false : true)
    && (!q || `${c.prenom} ${c.nom} ${c.email || ''}`.toLowerCase().includes(q)));
  document.getElementById('m-liste').innerHTML = l.length ? l.map(c => `<div class="card member-card" ${c.actif === false ? 'style="opacity:.7"' : ''}>
    <div class="member-head"><span class="avatar">${escapeHtml(((c.prenom || '?')[0] + ((c.nom || '')[0] || '')).toUpperCase())}</span>
      <div style="flex:1;min-width:0"><p class="bold" style="margin:0">${escapeHtml(nomMembre(c))}${c.actif === false ? ' <span class="pill red">Désactivé</span>' : ''}</p>
      <p class="small muted" style="margin:0;overflow:hidden;text-overflow:ellipsis">${escapeHtml((c.email || '').replace('@smmd.fr', '') || '—')}</p></div></div>
    <div class="grid2">
      <label class="field"><span>Maison</span><select class="input" onchange="majCompte('${escapeHtml(c.id)}',{maison_id:this.value},this)">${maisons.map(m => `<option value="${escapeHtml(m.id)}" ${m.id === c.maison_id ? 'selected' : ''}>${escapeHtml(m.nom)}</option>`).join('')}</select></label>
      <label class="field"><span>Rôle</span><select class="input" onchange="majCompte('${escapeHtml(c.id)}',{role:this.value},this)">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === c.role ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    </div>
    <label class="field"><span>Allocation mensuelle (€)</span><input class="input num" type="number" inputmode="decimal" min="0" step="0.01" value="${parseFloat(c.allocation_mensuelle) || 0}" onchange="majCompte('${escapeHtml(c.id)}',{allocation_mensuelle:parseFloat(this.value)||0},this)"></label>
    <div class="grid2">
      <button class="btn quiet" onclick="motDePasseProvisoire('${escapeHtml(c.id)}')">Mot de passe</button>
      ${c.id === userProfile.id ? '<span></span>' : c.actif === false
        ? `<button class="btn ghost" onclick="basculerActif('${escapeHtml(c.id)}',true)">Réactiver</button>`
        : `<button class="btn danger" onclick="basculerActif('${escapeHtml(c.id)}',false)">Désactiver</button>`}
    </div></div>`).join('') : '<div class="card empty">Aucun compte ne correspond</div>';
}
async function majCompte(id, champs, el) {
  if ('allocation_mensuelle' in champs && (isNaN(champs.allocation_mensuelle) || champs.allocation_mensuelle < 0)) return showToast('Montant invalide', 'error');
  const { data, error } = await sb.from('profiles').update(champs).eq('id', id).select('id');
  if (error || !(data || []).length) { showToast('Erreur : ' + (error?.message || 'refusé par la base'), 'error'); return chargerComptes(); }
  Object.assign(comptes.find(c => c.id === id) || {}, champs);
  showToast('Compte mis à jour', 'success');
}
function basculerActif(id, reactiver) {
  showConfirm(reactiver ? 'Réactiver ce compte ? La personne pourra de nouveau se connecter.'
    : 'Désactiver ce compte ? La personne ne pourra plus se connecter ; tout son historique est conservé.', async () => {
    const { data, error } = await sb.from('profiles').update({ actif: !!reactiver }).eq('id', id).select('id');
    if (error || !(data || []).length) return showToast('Erreur : ' + (error?.message || 'refusé par la base'), 'error');
    showToast(reactiver ? 'Compte réactivé' : 'Compte désactivé — historique conservé', 'info'); chargerComptes();
  }, reactiver ? 'Réactiver' : 'Désactiver', !reactiver);
}
function motDePasseAleatoire() {
  const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint32Array(10); crypto.getRandomValues(a);
  return Array.from(a, x => c[x % c.length]).join('');
}
function motDePasseProvisoire(id) {
  const c = comptes.find(x => x.id === id);
  ouvrirFeuille(`<p class="small muted" style="margin:0 0 10px">Définissez un mot de passe provisoire pour <b>${escapeHtml(nomMembre(c))}</b>, puis communiquez-le-lui. Il pourra le changer dans son Profil.</p>
    <label class="field"><span>Mot de passe provisoire (8 caractères minimum)</span><input id="mdp" class="input iban" value="${motDePasseAleatoire()}" autocomplete="off"></label>
    <div class="grid2" style="margin-top:14px"><button class="btn quiet" onclick="fermerFeuille()">Annuler</button><button class="btn" id="mdp-ok">Définir</button></div>`, { titre: 'Nouveau mot de passe' });
  document.getElementById('mdp-ok').onclick = async () => {
    const pw = document.getElementById('mdp').value;
    if (pw.length < 8) return showToast('8 caractères minimum', 'error');
    const btn = document.getElementById('mdp-ok'); btn.disabled = true;
    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(`${SMMD_CONFIG.url}/functions/v1/admin-mot-de-passe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': SMMD_CONFIG.key, 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ user_id: id, password: pw })
      });
      const r = await res.json().catch(() => ({}));
      if (res.status === 404) throw new Error('Fonction « admin-mot-de-passe » non déployée dans Supabase');
      if (!res.ok) throw new Error(r.error || 'Erreur ' + res.status);
      fermerFeuille();
      ouvrirFeuille(`<p style="margin:0 0 10px">Mot de passe de <b>${escapeHtml(nomMembre(c))}</b> changé. À lui communiquer :</p>
        <p class="iban card" style="font-size:20px;text-align:center">${escapeHtml(pw)}</p>
        <button class="btn block" style="margin-top:12px" onclick="copier('${escapeHtml(pw)}')">Copier</button>`, { titre: 'C\'est fait' });
    } catch (e) { btn.disabled = false; showToast(/fetch/i.test(e.message) ? 'Fonction « admin-mot-de-passe » injoignable : vérifiez qu\'elle est déployée dans Supabase' : e.message, 'error'); }
  };
}
function copier(t) { navigator.clipboard?.writeText(t).then(() => showToast('Copié', 'success')).catch(() => showToast('Copie impossible', 'error')); }
function formCompte() {
  ouvrirFeuille(`<div class="stack" style="gap:12px">
    <div class="grid2"><label class="field"><span>Prénom</span><input id="n-prenom" class="input"></label><label class="field"><span>Nom</span><input id="n-nom" class="input"></label></div>
    <label class="field"><span>Identifiant de connexion</span><input id="n-id" class="input" placeholder="prenom.nom" autocapitalize="none" spellcheck="false"></label>
    <label class="field"><span>Mot de passe provisoire</span><input id="n-pass" class="input iban" value="${motDePasseAleatoire()}"></label>
    <div class="grid2"><label class="field"><span>Maison</span><select id="n-maison" class="input">${maisons.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.nom)}</option>`).join('')}</select></label>
      <label class="field"><span>Rôle</span><select id="n-role" class="input">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
    <button class="btn block" id="n-ok" onclick="creerCompte()">Créer le compte</button></div>`, { titre: 'Nouveau compte' });
  const p = document.getElementById('n-prenom'), n = document.getElementById('n-nom'), i = document.getElementById('n-id');
  const auto = () => { i.value = `${p.value}.${n.value}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.]+/g, '-'); };
  p.oninput = n.oninput = auto;
}
async function creerCompte() {
  const prenom = document.getElementById('n-prenom').value.trim(), nom = document.getElementById('n-nom').value.trim().toUpperCase();
  let ident = document.getElementById('n-id').value.trim().toLowerCase();
  const pass = document.getElementById('n-pass').value, maison = document.getElementById('n-maison').value, role = document.getElementById('n-role').value;
  if (!prenom || !nom || !ident) return showToast('Prénom, nom et identifiant requis', 'error');
  if (pass.length < 8) return showToast('Mot de passe : 8 caractères minimum', 'error');
  const email = ident.includes('@') ? ident : ident + '@smmd.fr';
  const btn = document.getElementById('n-ok'); btn.disabled = true;
  const sbTmp = supabase.createClient(SMMD_CONFIG.url, SMMD_CONFIG.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await sbTmp.auth.signUp({ email, password: pass });
  if (error || !data.user) { btn.disabled = false; return showToast(error?.message || 'Création impossible', 'error'); }
  const { error: pErr } = await sb.from('profiles').insert([{ id: data.user.id, prenom, nom, nom_complet: `${prenom} ${nom}`, email, maison_id: maison, role, allocation_mensuelle: 0, actif: true }]);
  if (pErr) { btn.disabled = false; return showToast('Compte créé mais profil en erreur : ' + pErr.message, 'error'); }
  fermerFeuille();
  ouvrirFeuille(`<p style="margin:0 0 10px">Compte de <b>${escapeHtml(prenom)} ${escapeHtml(nom)}</b> créé. À lui communiquer :</p>
    <div class="card"><p class="small muted" style="margin:0">Identifiant</p><p class="iban bold" style="margin:0 0 8px;font-size:17px">${escapeHtml(ident.replace('@smmd.fr', ''))}</p>
    <p class="small muted" style="margin:0">Mot de passe provisoire</p><p class="iban bold" style="margin:0;font-size:17px">${escapeHtml(pass)}</p></div>
    <p class="small muted">Adresse de l'app : ${escapeHtml(location.origin + location.pathname.replace(/v2\/admin\.html$/, ''))}</p>`, { titre: 'Compte créé' });
  chargerComptes();
}

// ─────────────────────────────────────────────── Maisons et motifs
async function chargerMaisons() {
  await chargerReferentiels();
  const { data: mot } = await sb.from('motifs').select('*').order('nom');
  document.getElementById('ma-liste').innerHTML = maisons.map(m => `<div class="between" style="padding:12px 0;border-top:1px solid var(--border)">
    <span><b>${escapeHtml(m.nom)}</b><span class="small muted"> · ${comptes.filter(c => c.maison_id === m.id && c.actif !== false).length} membre(s) actif(s)</span></span>
    <button class="link" style="color:var(--red)" onclick="supprimerMaison('${escapeHtml(m.id)}')">Supprimer</button></div>`).join('');
  document.getElementById('mo-liste').innerHTML = (mot || []).map(m => `<span class="chip" style="display:inline-flex;align-items:center;gap:6px">${escapeHtml(libMotif(m.nom))}<button class="iconbtn" style="width:28px;height:28px" onclick="supprimerMotif('${escapeHtml(m.id)}')" aria-label="Supprimer le motif ${escapeHtml(m.nom)}">${svg(IC.close, 14)}</button></span>`).join('');
}
async function ajouterMaison() {
  const nom = document.getElementById('new-maison').value.trim().toUpperCase();
  if (!nom) return showToast('Saisissez un nom', 'error');
  const { error } = await sb.from('maisons').insert([{ nom }]);
  if (error) return showToast('Erreur : ' + error.message, 'error');
  document.getElementById('new-maison').value = ''; showToast('Maison ajoutée', 'success'); chargerMaisons();
}
function supprimerMaison(id) {
  if (comptes.some(c => c.maison_id === id)) return showToast('Impossible : des comptes sont rattachés à cette maison', 'warning');
  showConfirm('Supprimer cette maison ?', async () => {
    const { error } = await sb.from('maisons').delete().eq('id', id);
    if (error) return showToast('Impossible : ' + error.message, 'error');
    showToast('Maison supprimée', 'info'); chargerMaisons();
  }, 'Supprimer', true);
}
async function ajouterMotif() {
  const nom = document.getElementById('new-motif').value.trim().toLowerCase();
  if (!nom) return showToast('Saisissez un motif', 'error');
  const { error } = await sb.from('motifs').insert([{ nom }]);
  if (error) return showToast('Erreur : ' + error.message, 'error');
  document.getElementById('new-motif').value = ''; chargerMaisons();
}
function supprimerMotif(id) {
  showConfirm('Supprimer ce motif ? Les opérations existantes gardent leur motif.', async () => {
    const { error } = await sb.from('motifs').delete().eq('id', id);
    if (error) return showToast('Erreur : ' + error.message, 'error');
    chargerMaisons();
  }, 'Supprimer', true);
}

// ─────────────────────────────────────────────── Exports
function initExports() {
  const ms = document.getElementById('ex-mois');
  if (!ms.options.length) {
    ms.innerHTML = MOIS.map((m, i) => `<option value="${i + 1}" ${i === new Date().getMonth() ? 'selected' : ''}>${m}</option>`).join('');
    for (let y = new Date().getFullYear(); y >= 2026; y--) document.getElementById('ex-annee').insertAdjacentHTML('beforeend', `<option>${y}</option>`);
  }
  const mx = document.getElementById('ex-maison'), v = mx.value;
  mx.innerHTML = '<option value="">Toutes les maisons</option>' + maisons.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.nom)}</option>`).join('');
  mx.value = v;
}
const nomCompte = id => id ? nomMembre(comptes.find(c => c.id === id)) : 'Membre supprimé';
function lignesOps(txs, js) {
  return txs.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)).map(t => ({
    'Date': new Date(t.created_at).toLocaleDateString('fr-FR'), 'Maison': nomMaison(t.maison_id), 'Membre': nomCompte(t.user_id),
    'Type': t.type === 'recette' ? 'Recette' : 'Dépense', 'Motif': t.type === 'recette' ? '' : libMotif(t.motif), 'Commentaire': t.commentaire || '',
    'Montant (€)': (t.type === 'recette' ? 1 : -1) * parseFloat(t.montant), 'Paiement': PAIEMENTS[t.methode_paiement] || '',
    'Statut': t.statut === 'attente' ? 'À rembourser' : 'Validé', 'Justificatif': t.type === 'depense' ? (aJustif(t, js) ? 'Oui' : 'Non') : ''
  }));
}
function ongletSur(wb, nom) {
  let base = String(nom || 'Maison').replace(/[:\\/?*\[\]]/g, ' ').slice(0, 28).trim() || 'Maison', n = base, k = 2;
  while (wb.SheetNames.includes(n)) n = `${base.slice(0, 26)} ${k++}`;
  return n;
}
async function donneesPeriode(debut, fin) {
  const mai = document.getElementById('ex-maison').value;
  const [txs, allocs] = await Promise.all([
    fetchAll(() => { let q = sb.from('transactions').select('*').gte('created_at', debut).lt('created_at', fin).order('created_at'); return mai ? q.eq('maison_id', mai) : q; }),
    fetchAll(() => { let q = sb.from('allocations_versees').select('*').order('id'); return mai ? q.eq('maison_id', mai) : q; })
  ]);
  return { txs, allocs: allocs.filter(allocConfirmee), js: await idsAvecJustif(txs.filter(t => t.type === 'depense').map(t => t.id)) };
}
function recap(txs, allocs, cle) {
  const r = {};
  const R = k => (r[k] = r[k] || { alloc: 0, rec: 0, dep: 0, att: 0, n: 0 });
  txs.forEach(t => { const x = R(cle(t)); if (t.type === 'recette') x.rec += +t.montant; else x.dep += +t.montant; if (t.type === 'depense' && t.statut === 'attente') x.att += +t.montant; x.n++; });
  allocs.forEach(a => { R(cle(a)).alloc += +a.montant; });
  return r;
}
async function exportMois() {
  if (typeof XLSX === 'undefined') return showToast('Export indisponible hors connexion', 'warning');
  const m = +document.getElementById('ex-mois').value, a = +document.getElementById('ex-annee').value;
  const { debut, fin } = bornesMois(a, m);
  try {
    let { txs, allocs, js } = await donneesPeriode(debut, fin);
    allocs = allocs.filter(x => +x.mois === m && +x.annee === a);
    if (!txs.length && !allocs.length) return showToast('Aucune donnée sur ce mois', 'warning');
    const wb = XLSX.utils.book_new();
    const r = recap(txs, allocs, x => nomMaison(x.maison_id));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.entries(r).map(([k, x]) => ({ 'Maison': k, 'Allocations (€)': +x.alloc.toFixed(2), 'Recettes (€)': +x.rec.toFixed(2), 'Dépenses (€)': +x.dep.toFixed(2), 'Solde du mois (€)': +(x.alloc + x.rec - x.dep).toFixed(2), 'Avances à rembourser (€)': +x.att.toFixed(2), 'Nb opérations': x.n }))), 'Récapitulatif');
    maisons.forEach(ma => { const l = txs.filter(t => t.maison_id === ma.id); if (l.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lignesOps(l, js)), ongletSur(wb, ma.nom)); });
    XLSX.writeFile(wb, `SMMD_Journal_${MOIS[m - 1]}_${a}.xlsx`);
  } catch (e) { showToast('Export impossible : ' + e.message, 'error'); }
}
async function exportAnnee() {
  if (typeof XLSX === 'undefined') return showToast('Export indisponible hors connexion', 'warning');
  const a = +document.getElementById('ex-annee').value;
  const { debut, fin } = bornesAnnee(a);
  try {
    let { txs, allocs, js } = await donneesPeriode(debut, fin);
    allocs = allocs.filter(x => +x.annee === a);
    const wb = XLSX.utils.book_new();
    const r = recap(txs, allocs, x => nomMaison(x.maison_id));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.entries(r).map(([k, x]) => ({ 'Maison': k, 'Allocations (€)': +x.alloc.toFixed(2), 'Recettes (€)': +x.rec.toFixed(2), 'Dépenses (€)': +x.dep.toFixed(2), 'Solde de l\'année (€)': +(x.alloc + x.rec - x.dep).toFixed(2), 'Avances à rembourser (€)': +x.att.toFixed(2), 'Nb opérations': x.n }))), 'Récapitulatif');
    maisons.forEach(ma => {
      const t = txs.filter(x => x.maison_id === ma.id), al = allocs.filter(x => x.maison_id === ma.id);
      if (!t.length && !al.length) return;
      const rm = recap(t, al, x => nomCompte(x.user_id));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.entries(rm).map(([k, x]) => ({ 'Membre': k, 'Allocations (€)': +x.alloc.toFixed(2), 'Recettes (€)': +x.rec.toFixed(2), 'Dépenses (€)': +x.dep.toFixed(2), 'Avances à rembourser (€)': +x.att.toFixed(2), 'Nb opérations': x.n }))), ongletSur(wb, ma.nom));
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lignesOps(txs, js)), 'Toutes opérations');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allocs.sort((x, y) => x.mois - y.mois).map(x => ({ 'Mois': MOIS[x.mois - 1], 'Maison': nomMaison(x.maison_id), 'Membre': nomCompte(x.user_id), 'Montant (€)': +parseFloat(x.montant).toFixed(2), 'Confirmé par': x.valide_par ? nomCompte(x.valide_par) : '' }))), 'Allocations');
    XLSX.writeFile(wb, `SMMD_Rapport_${a}.xlsx`);
  } catch (e) { showToast('Export impossible : ' + e.message, 'error'); }
}
async function zip(periode) {
  if (typeof JSZip === 'undefined') return showToast('Export indisponible hors connexion', 'warning');
  const m = +document.getElementById('ex-mois').value, a = +document.getElementById('ex-annee').value, mai = document.getElementById('ex-maison').value;
  const b = periode === 'mois' ? bornesMois(a, m) : periode === 'annee' ? bornesAnnee(a) : null;
  const nomZip = periode === 'tout' ? `SMMD_Justificatifs_tout_${isoVersDateSaisie(new Date().toISOString())}.zip` : `SMMD_Justificatifs_${periode === 'mois' ? MOIS[m - 1] + '_' : ''}${a}.zip`;
  ouvrirFeuille(`<p class="bold" id="zip-txt" style="margin:0 0 10px">Préparation…</p><div class="bar"><div id="zip-bar" style="width:5%;background:var(--primary)"></div></div><p class="xs muted">Gardez cette page ouverte.</p>`, { titre: 'Export des justificatifs' });
  try {
    const txs = await fetchAll(() => {
      let q = sb.from('transactions').select('id,user_id,maison_id,created_at,motif,montant,commentaire,justificatif_url,profiles(prenom,nom),maisons(nom)').eq('type', 'depense').order('created_at');
      if (b) q = q.gte('created_at', b.debut).lt('created_at', b.fin);
      return mai ? q.eq('maison_id', mai) : q;
    });
    if (!txs.length) { fermerFeuille(); return showToast('Aucune dépense sur la période', 'warning'); }
    const S = SMMD_EXPORT.slug;
    const r = await SMMD_EXPORT.exporterJustificatifs({
      sb, txs, JSZip, nomZip,
      dossier: t => S(t.maisons?.nom, 'Sans_maison') + '/' + (t.profiles ? S(t.profiles.prenom, 'Membre') + '_' + S((t.profiles.nom || '').toUpperCase(), '') : 'Membres_supprimes') + '/' + SMMD_EXPORT.dateISO(t).slice(0, 7),
      onProgress: (txt, pct) => { const x = document.getElementById('zip-txt'), y = document.getElementById('zip-bar'); if (x) x.textContent = txt; if (y) y.style.width = pct + '%'; }
    });
    fermerFeuille();
    showToast(`${r.nbFichiers} fichier(s)` + (r.nbSans ? ` · ${r.nbSans} sans justificatif` : '') + (r.problemes ? ` · ${r.problemes} problème(s), voir LISEZMOI.txt` : ''), r.problemes ? 'warning' : 'success');
  } catch (e) { fermerFeuille(); showToast('Export impossible : ' + e.message, 'error'); }
}

// ─────────────────────────────────────────────── Journal d'erreurs
async function chargerErreurs() {
  const box = document.getElementById('er-liste');
  box.innerHTML = '<div class="skel" style="height:80px"></div>';
  const depuis = new Date(Date.now() - (+document.getElementById('er-periode').value) * 86400000).toISOString();
  let rows;
  try { rows = await fetchAll(() => sb.from('erreurs_app').select('*').gte('created_at', depuis).order('created_at', { ascending: false })); }
  catch (e) { box.innerHTML = `<p class="empty red">Lecture impossible : ${escapeHtml(e.message)}</p>`; return; }
  if (!rows.length) { box.innerHTML = `<div class="card empty ok bold">${svg(IC.check, 20)} Aucune erreur sur la période</div>`; compteur('err', 0); return; }
  const g = {};
  rows.forEach(r => (g[r.page + '|' + r.message] = g[r.page + '|' + r.message] || []).push(r));
  box.innerHTML = Object.values(g).sort((a, b) => b.length - a.length).map(l => {
    const r = l[0];
    return `<details class="card"><summary style="cursor:pointer;list-style:none"><div class="between"><b>${escapeHtml(r.message)}</b><span class="pill red">${l.length}×</span></div>
      <p class="small muted" style="margin:4px 0 0">${escapeHtml(r.page)} · ${escapeHtml(r.type || '')} · dernière fois ${new Date(r.created_at).toLocaleString('fr-FR')}</p></summary>
      <div class="small" style="margin-top:10px">
        <p style="margin:2px 0"><b>Qui :</b> ${escapeHtml([...new Set(l.map(x => x.user_id ? nomCompte(x.user_id) : 'Non connecté'))].join(', '))}</p>
        <p style="margin:2px 0"><b>Appareils :</b> ${escapeHtml([...new Set(l.map(x => x.appareil).filter(Boolean))].join(' ; '))}</p>
        ${r.action ? `<p style="margin:2px 0"><b>Dernière action :</b> ${escapeHtml(r.action)}</p>` : ''}
        <p style="margin:2px 0"><b>Version :</b> ${escapeHtml(r.version || '?')}</p>
        ${r.detail ? `<pre style="white-space:pre-wrap;word-break:break-all;background:var(--surf-2);border:1px solid var(--border);border-radius:10px;padding:8px;font-size:12px">${escapeHtml(r.detail)}</pre>` : ''}
        <button class="btn quiet" style="margin-top:8px" data-ids="${escapeHtml(l.map(x => x.id).join(','))}" onclick="erreurTraitee(this)">Marquer comme traitée</button></div></details>`;
  }).join('');
}
async function erreurTraitee(btn) {
  const ids = btn.dataset.ids.split(',');
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await sb.from('erreurs_app').delete().in('id', ids.slice(i, i + 100));
    if (error) return showToast('Erreur : ' + error.message, 'error');
  }
  showToast('Marquée comme traitée', 'success'); chargerErreurs();
}

// ─────────────────────────────────────────────── Outils
function blobVersDataUrl(blob) { return new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(blob); }); }
async function lireFichierBucket(url) {
  try { const res = await fetch(url, { cache: 'no-cache' }); if (res.ok) return await blobVersDataUrl(await res.blob()); } catch (e) {}
  const m = String(url).match(/\/object\/(?:public|sign|authenticated)\/justificatifs\/([^?]+)/);
  if (!m) throw new Error('lien illisible');
  const { data, error } = await sb.storage.from('justificatifs').download(decodeURIComponent(m[1]));
  if (error || !data) throw new Error(error?.message || 'fichier introuvable');
  return await blobVersDataUrl(data);
}
async function migrateJustificatifs() {
  const btn = document.getElementById('btn-migrate'), prog = document.getElementById('mig-prog'), st = document.getElementById('mig-status'), bar = document.getElementById('mig-bar'), det = document.getElementById('mig-detail'), res = document.getElementById('mig-res');
  btn.disabled = true; prog.classList.remove('hidden'); res.innerHTML = ''; st.textContent = 'Inventaire…';
  let avecUrl, avecB64, deja;
  try {
    [avecUrl, avecB64, deja] = await Promise.all([
      fetchAll(() => sb.from('transactions').select('id,created_at,motif,montant,justificatif_url').not('justificatif_url', 'is', null).order('id')),
      fetchAll(() => sb.from('transactions').select('id,created_at,motif,montant').not('justificatif_base64', 'is', null).order('id')),
      fetchAll(() => sb.from('justificatifs_images').select('id,transaction_id').order('id'))
    ]);
  } catch (e) { st.textContent = 'Erreur : ' + e.message; btn.disabled = false; return; }
  const ok = new Set(deja.map(r => r.transaction_id)), par = {};
  avecB64.forEach(t => { if (!ok.has(t.id)) par[t.id] = { ...t, b64: true }; });
  avecUrl.forEach(t => { if (!ok.has(t.id)) par[t.id] = { ...(par[t.id] || {}), ...t, url: t.justificatif_url }; });
  const l = Object.values(par); let n = 0; const ko = [];
  for (let i = 0; i < l.length; i++) {
    const t = l[i];
    st.textContent = `Rapatriement ${i + 1} / ${l.length}…`; bar.style.width = `${Math.round(i / Math.max(l.length, 1) * 100)}%`;
    det.textContent = `${new Date(t.created_at).toLocaleDateString('fr-FR')} · ${t.motif || ''} · ${eur(t.montant)}`;
    try {
      let d = null, errs = [];
      if (t.b64) { const { data } = await sb.from('transactions').select('justificatif_base64').eq('id', t.id).maybeSingle(); const s = String(data?.justificatif_base64 || '').trim(); if (s) d = s.startsWith('data:') ? s : `data:${s.startsWith('JVBER') ? 'application/pdf' : s.startsWith('iVBOR') ? 'image/png' : 'image/jpeg'};base64,${s.replace(/\s+/g, '')}`; }
      if (!d && t.url) { try { d = await lireFichierBucket(t.url); } catch (e) { errs.push(e.message); } }
      if (!d) throw new Error(errs.join(' / ') || 'aucune donnée');
      const { error } = await sb.from('justificatifs_images').insert([{ transaction_id: t.id, ordre: 0, base64: d, mime_type: (d.match(/^data:([^;]+);/) || [])[1] || 'image/jpeg' }]);
      if (error) throw error; n++;
    } catch (e) { ko.push(`${new Date(t.created_at).toLocaleDateString('fr-FR')} · ${t.motif || '-'} · ${eur(t.montant)} — ${e.message}`); }
  }
  prog.classList.add('hidden'); btn.disabled = false;
  res.innerHTML = !l.length ? `<p class="ok bold">${svg(IC.check, 18)} Tous les justificatifs sont déjà dans la base (${ok.size}).</p>`
    : `<p class="bold">${n} rapatrié(s) · ${ko.length} échec(s) · ${ok.size} déjà en base</p>${ko.length ? `<p class="red" style="margin:4px 0 0">${ko.map(escapeHtml).join('<br>')}</p>` : ''}`;
}
async function majMotDePasse() {
  const p = document.getElementById('p-pass').value;
  if (p.length < 6) return showToast('6 caractères minimum', 'error');
  const { error } = await sb.auth.updateUser({ password: p });
  if (error) return showToast(error.message, 'error');
  document.getElementById('p-pass').value = ''; showToast('Mot de passe modifié', 'success');
}

init().catch(e => { console.error(e); showToast('Erreur au démarrage : ' + e.message, 'error'); });

function relevePDFAdmin() {
  const m = +document.getElementById('ex-mois').value, a = +document.getElementById('ex-annee').value, mid = document.getElementById('ex-maison').value;
  const liste = (mid ? maisons.filter(x => x.id === mid) : maisons).map(x => ({ id: x.id, nom: x.nom }));
  if (!liste.length) return showToast('Aucune maison', 'warning');
  genererRelevePDF(liste, m, a);
}
