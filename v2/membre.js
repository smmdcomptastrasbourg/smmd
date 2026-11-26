// SMMD v2 — Espace membre (s'appuie sur commun.js)
// ─────────────────────────────────────────────── Navigation
function go(v) {
  _vue = v;
  ['accueil', 'releve', 'remb', 'profil'].forEach(n => document.getElementById('v-' + n).classList.toggle('hidden', n !== v));
  document.querySelectorAll('.tab').forEach(t => { if (t.dataset.v === v) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  window.scrollTo({ top: 0 });
  rafraichirVue();
}
function rafraichirVue() {
  if (_vue === 'accueil') chargerAccueil();
  else if (_vue === 'releve') chargerReleve();
  else if (_vue === 'remb') chargerRemboursements();
  else if (_vue === 'profil') chargerProfil();
}

// ─────────────────────────────────────────────── Initialisation
async function init() {
  const ctx = await demarrerSession();
  if (!ctx) return;
  const profile = ctx.profile;
  if (!(await verifierCompteActif(profile))) return;
  userProfile = profile;
  // Chef et admin : accès à leur espace (ancienne interface) en attendant leur refonte
  if (profile.role === 'chef' || profile.role === 'admin') {
    const a = document.getElementById('p-espace');
    a.href = profile.role === 'chef' ? '../chef.html' : '../admin.html';
    a.textContent = profile.role === 'chef' ? 'Espace chef de maison' : 'Espace administrateur';
    a.classList.remove('hidden');
  }
  document.getElementById('t-accueil').textContent = 'Bonjour ' + (profile.prenom || '');
  document.getElementById('maison-nom').textContent = 'Maison ' + (profile.maisons?.nom || '');
  document.getElementById('p-version').textContent = 'Version ' + (window.SMMD_VERSION || '') + ' · nouvelle interface';

  motifs = await chargerMotifs();

  majBandeauHorsLigne();
  await synchroniserFile();
  chargerAccueil();
  ecouterNotifications();
  compterMessages();
}
window.addEventListener('online', () => { majBandeauHorsLigne(); synchroniserFile().then(rafraichirVue); });
window.addEventListener('offline', majBandeauHorsLigne);
document.addEventListener('visibilitychange', () => { if (!document.hidden && userProfile) { synchroniserFile().then(rafraichirVue); compterMessages(); } });
function majBandeauHorsLigne() { document.getElementById('offline').classList.toggle('hidden', navigator.onLine); }

// ─────────────────────────────────────────────── ACCUEIL
async function chargerAccueil() {
  if (!userProfile) return;
  const now = new Date(), mois = now.getMonth() + 1, annee = now.getFullYear();
  let mesTx, maisonTx, allocs, notifs;
  try {
    [mesTx, maisonTx, allocs, notifs] = await Promise.all([
      fetchAll(() => sb.from('transactions').select('id,type,montant,statut,motif,commentaire,created_at,methode_paiement,justificatif_url').eq('user_id', userProfile.id).order('created_at', { ascending: false })),
      fetchAll(() => sb.from('transactions').select('type,montant').eq('maison_id', userProfile.maison_id)),
      fetchAll(() => sb.from('allocations_versees').select('user_id,montant,statut,mois,annee').eq('maison_id', userProfile.maison_id)),
      sb.from('notifications').select('*').eq('user_id', userProfile.id).eq('lu', false).order('created_at', { ascending: false }).then(r => r.data || [])
    ]);
  } catch (e) { showToast(navigator.onLine ? 'Impossible de charger vos données — réessayez' : 'Hors connexion : vous pouvez saisir, l\'envoi se fera au retour du réseau', navigator.onLine ? 'error' : 'warning'); return; }
  mesTx.forEach(t => _tx[t.id] = t);
  const conf = allocs.filter(allocConfirmee);
  const somme = (arr, f) => arr.filter(f).reduce((s, x) => s + parseFloat(x.montant), 0);
  const monSolde = somme(conf, a => a.user_id === userProfile.id) + somme(mesTx, t => t.type === 'recette') - somme(mesTx, t => t.type === 'depense');
  const soldeMaison = somme(conf, () => true) + somme(maisonTx, t => t.type === 'recette') - somme(maisonTx, t => t.type === 'depense');
  const attente = somme(mesTx, t => t.type === 'depense' && t.statut === 'attente');
  document.getElementById('h-solde').textContent = eur(monSolde);
  document.getElementById('h-attente').textContent = eur(attente);
  document.getElementById('h-maison').textContent = eur(soldeMaison);

  // À faire
  const limite = new Date(annee, mois - 2, 1).toISOString();   // mois courant + précédent
  const aVerifier = mesTx.filter(t => t.type === 'depense' && t.created_at >= limite);
  const justifs = await idsAvecJustif(aVerifier.map(t => t.id)).catch(() => new Set());
  const sansJustif = aVerifier.filter(t => !aJustif(t, justifs));
  const items = [];
  notifs.forEach(n => items.push(`<div class="todo"><span class="ic" style="background:var(--ok-soft);color:var(--ok)">${svg(IC.bell)}</span><div style="flex:1">
      <p class="bold">${escapeHtml({ remboursement: 'Remboursement reçu', allocation: 'Allocation confirmée' }[n.type] || 'Information')}</p><p class="small muted">${escapeHtml(n.message)}</p>
      <button class="act" style="border-color:var(--ok);color:var(--ok)" onclick="notifLue('${escapeHtml(n.id)}')">J'ai vu</button></div></div>`));
  const alloc = parseFloat(userProfile.allocation_mensuelle) || 0;
  const allocMois = allocs.find(a => a.user_id === userProfile.id && parseInt(a.mois) === mois && parseInt(a.annee) === annee);
  if (alloc > 0 && !allocMois) items.push(`<div class="todo"><span class="ic">${svg(IC.cal)}</span><div style="flex:1">
      <p class="bold">Allocation de ${MOIS[mois - 1]}</p><p class="small muted">${eur(alloc)} à verser à votre maison</p>
      <button class="act" onclick="declarerAllocation(${mois},${annee})">Je l'ai versée</button></div></div>`);
  sansJustif.slice(0, 5).forEach(t => items.push(`<div class="todo"><span class="ic">${svg(IC.alert)}</span><div style="flex:1">
      <p class="bold">Justificatif manquant</p><p class="small muted">${escapeHtml(libMotif(t.motif))} · ${eur(t.montant)} · ${dateFr(t.created_at)}${t.commentaire ? ' · ' + escapeHtml(t.commentaire) : ''}</p>
      <button class="act" onclick="ajouterJustifA('${escapeHtml(t.id)}')">Ajouter la photo</button></div></div>`));
  if (sansJustif.length > 5) items.push(`<p class="small muted" style="margin:8px 0 0">… et ${sansJustif.length - 5} autre(s) dans le relevé (filtre « Sans justificatif »).</p>`);
  const n = items.filter(x => x.startsWith('<div')).length;
  const cnt = document.getElementById('todo-count');
  cnt.textContent = n; cnt.classList.toggle('hidden', !n);
  document.getElementById('todo-list').innerHTML = items.length ? items.join('') : `<p class="ok bold" style="margin:6px 0 0">${svg(IC.check, 18)} Tout est à jour</p>`;

  // Mes dépenses du mois par motif
  const { debut, fin } = bornesMois(annee, mois);
  const depMois = mesTx.filter(t => t.type === 'depense' && t.created_at >= debut && t.created_at < fin);
  const total = depMois.reduce((s, t) => s + parseFloat(t.montant), 0);
  document.getElementById('parts-total').innerHTML = depMois.length ? `Total de ${MOIS[mois - 1]} : <b class="num" style="color:var(--ink)">${eur(total)}</b>` : '';
  document.getElementById('parts').innerHTML = depMois.length ? repartition(depMois, total) : '<p class="empty">Aucune dépense ce mois-ci</p>';

  // Dernières opérations
  const dern = mesTx.slice(0, 5);
  const js = await idsAvecJustif(dern.map(t => t.id)).catch(() => new Set());
  document.getElementById('dernieres').innerHTML = dern.length ? dern.map(t => ligneOp(t, js)).join('') : '<p class="empty">Aucune opération pour l\'instant</p>';
}

async function notifLue(id) {
  await sb.from('notifications').update({ lu: true }).eq('id', id).eq('user_id', userProfile.id);
  chargerAccueil();
}

// ─────────────────────────────────────────────── RELEVÉ
let _releve = [], _releveJustif = new Set(), _filtre = 'tout';
const FILTRES = [['tout', 'Tout'], ['sorties', 'Sorties'], ['entrees', 'Entrées'], ['attente', 'À rembourser'], ['sansjustif', 'Sans justificatif']];
function initSelecteurMois() {
  const sel = document.getElementById('r-mois');
  if (sel.options.length) return;
  const now = new Date(); const out = [];
  for (let d = new Date(now.getFullYear(), now.getMonth(), 1); d >= new Date(2026, 0, 1); d.setMonth(d.getMonth() - 1))
    out.push(`<option value="${d.getFullYear()}-${d.getMonth() + 1}">${MOIS[d.getMonth()]} ${d.getFullYear()}</option>`);
  sel.innerHTML = out.join('');
  document.getElementById('r-filtres').innerHTML = FILTRES.map(([k, l]) => `<button class="chip" aria-pressed="${k === _filtre}" onclick="choisirFiltre('${k}')">${l}</button>`).join('');
}
function choisirFiltre(k) {
  _filtre = k;
  document.querySelectorAll('#r-filtres .chip').forEach((b, i) => b.setAttribute('aria-pressed', FILTRES[i][0] === k));
  afficherReleve();
}
async function chargerReleve() {
  initSelecteurMois();
  const [a, m] = document.getElementById('r-mois').value.split('-');
  const { debut, fin } = bornesMois(a, m);
  document.getElementById('r-liste').innerHTML = '<div class="skel" style="height:120px"></div>';
  try {
    _releve = await fetchAll(() => sb.from('transactions').select('id,type,montant,statut,motif,commentaire,created_at,methode_paiement,justificatif_url')
      .eq('user_id', userProfile.id).gte('created_at', debut).lt('created_at', fin).order('created_at', { ascending: false }));
    _releveJustif = await idsAvecJustif(_releve.map(t => t.id));
  } catch (e) { document.getElementById('r-liste').innerHTML = '<p class="empty red">Erreur de chargement</p>'; return; }
  // Saisies hors ligne du mois
  fileAttente().filter(it => it.payload.created_at >= debut && it.payload.created_at < fin)
    .forEach(it => _releve.unshift({ ...it.payload, id: it.id, _local: true }));
  afficherReleve();
}
function afficherReleve() {
  const q = (document.getElementById('r-q').value || '').trim().toLowerCase();
  const ok = t => {
    if (_filtre === 'sorties' && t.type !== 'depense') return false;
    if (_filtre === 'entrees' && t.type !== 'recette') return false;
    if (_filtre === 'attente' && !(t.type === 'depense' && t.statut === 'attente')) return false;
    if (_filtre === 'sansjustif' && !(t.type === 'depense' && !aJustif(t, _releveJustif))) return false;
    if (q) {
      const txt = [t.motif, t.commentaire, PAIEMENTS[t.methode_paiement], String(t.montant).replace('.', ','), eur(t.montant)].join(' ').toLowerCase();
      if (!txt.includes(q)) return false;
    }
    return true;
  };
  const liste = _releve.filter(ok);
  document.getElementById('r-in').textContent = '+' + eur(_releve.filter(t => t.type === 'recette').reduce((s, t) => s + parseFloat(t.montant), 0));
  document.getElementById('r-out').textContent = '−' + eur(_releve.filter(t => t.type === 'depense').reduce((s, t) => s + parseFloat(t.montant), 0));
  if (!liste.length) { document.getElementById('r-liste').innerHTML = `<div class="card empty">${_releve.length ? 'Aucune opération ne correspond' : 'Aucune opération ce mois-ci'}</div>`; return; }
  const jours = {};
  liste.forEach(t => { const k = isoVersDateSaisie(t.created_at); (jours[k] = jours[k] || []).push(t); });
  document.getElementById('r-liste').innerHTML = Object.entries(jours).map(([k, ops]) => {
    const net = ops.reduce((s, t) => s + (t.type === 'recette' ? 1 : -1) * parseFloat(t.montant), 0);
    return `<div class="card card-flush"><div class="day-head"><span>${jourFr(ops[0].created_at)}</span><span class="num">${net >= 0 ? '+' : '−'}${eur(Math.abs(net))}</span></div>${ops.map(t => ligneOp(t, _releveJustif)).join('')}</div>`;
  }).join('');
}

async function exporterExcel() {
  if (typeof XLSX === 'undefined') return showToast('Export indisponible hors connexion', 'warning');
  if (!_releve.length) return showToast('Aucune opération ce mois-ci', 'warning');
  const [a, m] = document.getElementById('r-mois').value.split('-');
  const rows = _releve.filter(t => !t._local).slice().reverse().map(t => ({
    'Date': new Date(t.created_at).toLocaleDateString('fr-FR'),
    'Type': t.type === 'recette' ? 'Recette' : 'Dépense',
    'Motif': t.type === 'recette' ? '' : libMotif(t.motif),
    'Commentaire': t.commentaire || '',
    'Montant (€)': (t.type === 'recette' ? 1 : -1) * parseFloat(t.montant),
    'Paiement': PAIEMENTS[t.methode_paiement] || '',
    'Statut': t.statut === 'attente' ? 'À rembourser' : 'Validé',
    'Justificatif': t.type === 'depense' ? (aJustif(t, _releveJustif) ? 'Oui' : 'Non') : ''
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Relevé');
  XLSX.writeFile(wb, `Releve_${MOIS[m - 1]}_${a}.xlsx`);
}

// ─────────────────────────────────────────────── REMBOURSEMENTS
async function chargerRemboursements() {
  const box = document.getElementById('rb-liste');
  box.innerHTML = '<div class="skel" style="height:120px"></div>';
  let txs, notifs, justifs;
  try {
    [txs, notifs] = await Promise.all([
      fetchAll(() => sb.from('transactions').select('*').eq('user_id', userProfile.id).eq('type', 'depense').like('methode_paiement', 'perso_%').order('created_at', { ascending: false })),
      fetchAll(() => sb.from('notifications').select('created_at,type').eq('user_id', userProfile.id))
    ]);
    justifs = await idsAvecJustif(txs.map(t => t.id));
  } catch (e) { box.innerHTML = '<p class="empty red">Erreur de chargement</p>'; return; }
  const annee = new Date().getFullYear();
  document.getElementById('rb-att').textContent = eur(txs.filter(t => t.statut === 'attente').reduce((s, t) => s + parseFloat(t.montant), 0));
  document.getElementById('rb-ok').textContent = eur(txs.filter(t => t.statut === 'valide' && new Date(t.created_at).getFullYear() === annee).reduce((s, t) => s + parseFloat(t.montant), 0));
  if (!txs.length) { box.innerHTML = `<div class="card empty">Aucune avance pour l'instant.<br><span class="small">Choisissez « Carte perso » ou « Espèces » quand vous payez pour la maison : vous serez remboursé.</span></div>`; return; }
  const parMois = {};
  txs.forEach(t => { const d = new Date(t.created_at), k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; (parMois[k] = parMois[k] || []).push(t); });
  box.innerHTML = (userProfile.iban ? '' : `<div class="banner warn">${svg(IC.alert, 18)}<span>Ajoutez votre IBAN dans Profil pour être remboursé.</span><button class="link" style="margin-left:auto" onclick="go('profil')">Ajouter</button></div>`) +
    Object.entries(parMois).sort((a, b) => b[0].localeCompare(a[0])).map(([k, ops]) => {
      const [a, m] = k.split('-');
      const att = ops.filter(t => t.statut === 'attente').reduce((s, t) => s + parseFloat(t.montant), 0);
      const ok = ops.filter(t => t.statut === 'valide').reduce((s, t) => s + parseFloat(t.montant), 0);
      const dv = ops.map(t => t.date_validation).filter(Boolean).sort().pop();
      return `<div class="card card-flush"><div class="day-head" style="font-size:14px"><span style="color:var(--ink);font-weight:700">${MOIS[m - 1].charAt(0).toUpperCase() + MOIS[m - 1].slice(1)} ${a}</span>
        <span>${att ? `<span class="warn bold num">${eur(att)} en attente</span>` : ''}${att && ok ? ' · ' : ''}${ok ? `<span class="ok bold num">${eur(ok)} remboursé${dv ? ' le ' + new Date(dv).toLocaleDateString('fr-FR') : ''}</span>` : ''}</span></div>
        ${ops.map(t => ligneOp(t, justifs)).join('')}</div>`;
    }).join('');
}

// ─────────────────────────────────────────────── PROFIL & ALLOCATIONS
async function chargerProfil() {
  document.getElementById('p-iban').value = userProfile.iban || '';
  document.getElementById('p-alloc').value = parseFloat(userProfile.allocation_mensuelle) || '';
  const alloc = parseFloat(userProfile.allocation_mensuelle) || 0;
  document.getElementById('al-mensuelle').textContent = alloc ? eur(alloc) + ' / mois' : 'Non définie';
  const { data: vers, error } = await sb.from('allocations_versees').select('*').eq('user_id', userProfile.id);
  const box = document.getElementById('al-liste');
  if (error) { box.innerHTML = '<p class="empty red">Erreur de chargement</p>'; return; }
  const mois = [];
  for (let d = new Date(new Date().getFullYear(), new Date().getMonth(), 1); d >= new Date(2026, 0, 1); d.setMonth(d.getMonth() - 1)) mois.push({ m: d.getMonth() + 1, a: d.getFullYear() });
  box.innerHTML = mois.map(({ m, a }) => {
    const v = (vers || []).find(x => parseInt(x.mois) === m && parseInt(x.annee) === a);
    const etat = !v ? 'aucun' : allocConfirmee(v) ? 'conf' : 'decl';
    const txt = etat === 'conf' ? '<span class="ok">Confirmé par le chef</span>' : etat === 'decl' ? '<span class="warn">Déclaré — en attente du chef</span>' : '<span class="muted">Non versé</span>';
    return `<button class="month-row" onclick="basculerAllocation(${m},${a},'${etat}','${v ? escapeHtml(v.id) : ''}')">
      <span class="row"><span class="box ${etat}">${etat !== 'aucun' ? svg(IC.check, 16, 3) : ''}</span><span><b style="display:block">${MOIS[m - 1].charAt(0).toUpperCase() + MOIS[m - 1].slice(1)} ${a}</b><span class="small">${txt}</span></span></span>
      <span class="num bold ${etat === 'conf' ? 'ok' : etat === 'decl' ? 'warn' : 'muted'}">${v ? eur(v.montant) : alloc ? eur(alloc) : ''}</span></button>`;
  }).join('');
}
async function declarerAllocation(m, a) {
  const alloc = parseFloat(userProfile.allocation_mensuelle) || 0;
  if (alloc <= 0) return showToast('Votre allocation mensuelle n\'est pas définie (Profil)', 'warning');
  const { error } = await sb.from('allocations_versees').insert([{ user_id: userProfile.id, maison_id: userProfile.maison_id, mois: m, annee: a, montant: alloc, statut: 'declare', valide_par: null }]);
  if (error) return showToast('Erreur : ' + error.message, 'error');
  showToast(`${MOIS[m - 1]} ${a} : versement déclaré, le chef va le confirmer`, 'success');
  rafraichirVue();
}
function basculerAllocation(m, a, etat, id) {
  if (etat === 'conf') return showToast('Ce mois est confirmé par le chef — demandez-lui pour toute correction', 'info');
  if (etat === 'aucun') return declarerAllocation(m, a);
  showConfirm(`Retirer votre déclaration pour ${MOIS[m - 1]} ${a} ?`, async () => {
    const { error } = await sb.from('allocations_versees').delete().eq('id', id).eq('user_id', userProfile.id).eq('statut', 'declare');
    if (error) return showToast('Erreur : ' + error.message, 'error');
    showToast('Déclaration retirée', 'info'); chargerProfil();
  }, 'Retirer');
}
async function majIban() {
  const raw = document.getElementById('p-iban').value.trim();
  const err = document.getElementById('p-iban-err');
  if (raw && !validateIban(raw)) { err.classList.remove('hidden'); return; }
  err.classList.add('hidden');
  const iban = raw ? normalizeIban(raw) : null;
  const { error } = await sb.from('profiles').update({ iban }).eq('id', userProfile.id);
  if (error) return showToast('Erreur : ' + error.message, 'error');
  userProfile.iban = iban; showToast('IBAN enregistré', 'success');
}
async function majAllocation() {
  const v = parseFloat(String(document.getElementById('p-alloc').value).replace(',', '.'));
  if (isNaN(v) || v < 0) return showToast('Montant invalide', 'error');
  const { error } = await sb.from('profiles').update({ allocation_mensuelle: v }).eq('id', userProfile.id);
  if (error) return showToast('Erreur : ' + error.message, 'error');
  userProfile.allocation_mensuelle = v; showToast('Allocation enregistrée', 'success'); chargerProfil();
}
async function majMotDePasse() {
  const p = document.getElementById('p-pass').value;
  if (p.length < 6) return showToast('6 caractères minimum', 'error');
  const { error } = await sb.auth.updateUser({ password: p });
  if (error) return showToast(error.message, 'error');
  document.getElementById('p-pass').value = ''; showToast('Mot de passe modifié', 'success');
}
init().catch(e => { console.error(e); showToast('Erreur au démarrage : ' + e.message, 'error'); });
