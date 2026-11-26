// ═══════════════════════════════════════════════════════════
// SMMD v2 — Espace chef de maison (s'appuie sur commun.js)
// ═══════════════════════════════════════════════════════════
window.PORTEE_CHEF = true;
_vue = 'tdb';
let membres = [];           // tous les profils de la maison (actifs et désactivés)
let compteMaison = null;
const SEL_TX = 'id,user_id,type,montant,statut,motif,commentaire,created_at,methode_paiement,justificatif_url,date_validation,profiles(prenom,nom,iban)';
const nomDe = id => nomMembre(membres.find(m => m.id === id));
const initiales = m => ((m?.prenom || '?')[0] + ((m?.nom || '')[0] || '')).toUpperCase();
const VUES = ['tdb', 'releve', 'remb', 'alloc', 'membres', 'profil'];

// ─────────────────────────────────────────────── Navigation
function go(v) {
  _vue = v;
  VUES.forEach(n => document.getElementById('v-' + n).classList.toggle('hidden', n !== v));
  document.querySelectorAll('.tab, .sidenav button[data-v]').forEach(t => {
    const actif = t.dataset.v === v || (t.dataset.v === 'plus' && ['alloc', 'membres', 'profil'].includes(v));
    if (actif) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0 });
  rafraichirVue();
}
function rafraichirVue() {
  ({ tdb: chargerTdb, releve: chargerReleve, remb: chargerRemb, alloc: chargerAllocations, membres: chargerMembres, profil: chargerProfil })[_vue]?.();
}
function menuPlus() {
  ouvrirFeuille(`<div class="stack" style="gap:10px">
    <button class="btn quiet block" onclick="fermerFeuille();go('alloc')">Allocations</button>
    <button class="btn quiet block" onclick="fermerFeuille();go('membres')">Membres</button>
    <button class="btn quiet block" onclick="fermerFeuille();go('profil')">Maison et profil</button>
    <a class="btn quiet block" href="membre.html">Mon espace membre</a></div>`, { titre: 'Plus' });
}
function compteur(cle, n) {
  document.querySelectorAll(`[data-cnt="${cle}"]`).forEach(b => { b.textContent = n > 99 ? '99+' : n; b.classList.toggle('hidden', !n); });
}

// ─────────────────────────────────────────────── Initialisation
async function init() {
  const ctx = await demarrerSession();
  if (!ctx) return;
  const profile = ctx.profile;
  if (!(await verifierCompteActif(profile))) return;
  if (profile.role !== 'chef') { location.href = 'membre.html'; return; }
  userProfile = profile;
  document.getElementById('maison-nom').textContent = 'Maison ' + (profile.maisons?.nom || '');
  document.getElementById('p-version').textContent = 'Version ' + (window.SMMD_VERSION || '') + ' · nouvelle interface';
  motifs = await chargerMotifs();
  try {
    const [mb, cm] = await Promise.all([
      fetchAll(() => sb.from('profiles').select('*').eq('maison_id', profile.maison_id).order('prenom')),
      sb.from('comptes_maisons').select('*').eq('maison_id', profile.maison_id).maybeSingle()
    ]);
    membres = mb; compteMaison = cm.error ? null : cm.data;
  } catch (e) { membres = [profile]; }
  majBandeauHorsLigne();
  await synchroniserFile();
  go('tdb');
  ecouterNotifications();
  majCarteNotifications();
  compterMessages().then(() => compteur('msg', parseInt(document.getElementById('msg-badge').textContent) || 0));
}
window.addEventListener('online', () => { majBandeauHorsLigne(); synchroniserFile().then(rafraichirVue); });
window.addEventListener('offline', majBandeauHorsLigne);
document.addEventListener('visibilitychange', () => { if (!document.hidden && userProfile) { synchroniserFile().then(rafraichirVue); compterMessages(); } });
function majBandeauHorsLigne() { document.getElementById('offline').classList.toggle('hidden', navigator.onLine); }

// ─────────────────────────────────────────────── TABLEAU DE BORD
async function chargerTdb() {
  const now = new Date(), mois = now.getMonth() + 1, annee = now.getFullYear();
  const { debut, fin } = bornesMois(annee, mois);
  let txs, allocs, virs;
  try {
    [txs, allocs, virs] = await Promise.all([
      fetchAll(() => sb.from('transactions').select(SEL_TX).eq('maison_id', userProfile.maison_id).order('created_at', { ascending: false })),
      fetchAll(() => sb.from('allocations_versees').select('*').eq('maison_id', userProfile.maison_id)),
      sb.from('virements_sepa').select('id,total,nb_virements,created_at').eq('maison_id', userProfile.maison_id).eq('statut', 'genere').then(r => r.data || [])
    ]);
  } catch (e) { showToast(navigator.onLine ? 'Impossible de charger les données — réessayez' : 'Hors connexion : vous pouvez saisir, l\'envoi se fera au retour du réseau', navigator.onLine ? 'error' : 'warning'); return; }
  txs.forEach(t => _tx[t.id] = t);
  const somme = (a, f) => a.filter(f).reduce((s, x) => s + parseFloat(x.montant), 0);
  const conf = allocs.filter(allocConfirmee);
  const solde = somme(conf, () => true) + somme(txs, t => t.type === 'recette') - somme(txs, t => t.type === 'depense');
  const duMois = t => t.created_at >= debut && t.created_at < fin;
  const inMois = somme(txs, t => t.type === 'recette' && duMois(t)) + somme(conf, a => parseInt(a.mois) === mois && parseInt(a.annee) === annee);
  const outMois = somme(txs, t => t.type === 'depense' && duMois(t));
  const avances = txs.filter(t => t.type === 'depense' && t.statut === 'attente');
  document.getElementById('k-solde').textContent = eur(solde);
  document.getElementById('k-in').textContent = '+' + eur(inMois);
  document.getElementById('k-out').textContent = '−' + eur(outMois);
  document.getElementById('k-att').textContent = eur(avances.reduce((s, t) => s + parseFloat(t.montant), 0));

  // À faire du chef
  const decl = allocs.filter(a => !allocConfirmee(a));
  const actifsAlloc = membres.filter(m => m.actif !== false && parseFloat(m.allocation_mensuelle) > 0);
  const manquantes = actifsAlloc.filter(m => !allocs.some(a => a.user_id === m.id && parseInt(a.mois) === mois && parseInt(a.annee) === annee));
  const membresAvances = [...new Set(avances.map(t => t.user_id))];
  const sansIban = membresAvances.map(id => membres.find(m => m.id === id)).filter(m => m && !m.iban);
  compteur('alloc', decl.length); compteur('remb', membresAvances.length);
  const it = (ic, titre, sous, bouton, action, couleur) => `<div class="todo"><span class="ic" ${couleur ? `style="background:${couleur}1A;color:${couleur}"` : ''}>${svg(ic)}</span><div style="flex:1">
    <p class="bold">${titre}</p><p class="small muted">${sous}</p>${bouton ? `<button class="act" onclick="${action}">${bouton}</button>` : ''}</div></div>`;
  const items = [];
  if (virs.length) items.push(it(IC.alert, `${virs.length} virement${virs.length > 1 ? 's' : ''} SEPA à confirmer`, `Importé dans la banque ? Confirmez pour marquer les avances remboursées (${eur(virs.reduce((s, v) => s + parseFloat(v.total), 0))}).`, 'Voir', "go('remb')"));
  if (decl.length) items.push(it(IC.cal, `${decl.length} allocation${decl.length > 1 ? 's' : ''} à confirmer`, [...new Set(decl.map(a => nomDe(a.user_id)))].map(escapeHtml).join(', '), 'Confirmer', "go('alloc')"));
  if (membresAvances.length) items.push(it(IC.file, `Avances à rembourser`, `${membresAvances.length} membre${membresAvances.length > 1 ? 's' : ''} · ${eur(avances.reduce((s, t) => s + parseFloat(t.montant), 0))}`, 'Rembourser', "go('remb')"));
  if (!compteMaison) items.push(it(IC.alert, 'Compte bancaire de la maison manquant', 'Nécessaire pour générer les virements SEPA.', 'Renseigner', "go('profil')"));
  if (sansIban.length) items.push(it(IC.alert, 'IBAN manquant', sansIban.map(nomMembre).map(escapeHtml).join(', ') + ' : impossible de les rembourser par virement.', '', ''));
  if (manquantes.length) items.push(it(IC.cal, `Allocations de ${MOIS[mois - 1]} non versées`, manquantes.map(nomMembre).map(escapeHtml).join(', '), 'Voir', "go('alloc')", '#57534E'));
  document.getElementById('todo-count').textContent = items.length;
  document.getElementById('todo-count').classList.toggle('hidden', !items.length);
  document.getElementById('todo-list').innerHTML = items.length ? items.join('') : `<p class="ok bold" style="margin:6px 0 0">${svg(IC.check, 18)} Tout est à jour</p>`;

  const depMois = txs.filter(t => t.type === 'depense' && duMois(t));
  const tot = depMois.reduce((s, t) => s + parseFloat(t.montant), 0);
  document.getElementById('parts-total').innerHTML = depMois.length ? `Total de ${MOIS[mois - 1]} : <b class="num" style="color:var(--ink)">${eur(tot)}</b>` : '';
  document.getElementById('parts').innerHTML = depMois.length ? repartition(depMois, tot) : '<p class="empty">Aucune dépense ce mois-ci</p>';
  const dern = txs.slice(0, 6);
  const js = await idsAvecJustif(dern.map(t => t.id)).catch(() => new Set());
  document.getElementById('dernieres').innerHTML = dern.length ? dern.map(t => ligneOp(t, js)).join('') : '<p class="empty">Aucune opération</p>';
}

// ─────────────────────────────────────────────── RELEVÉ DE LA MAISON
let _rel = [], _relJ = new Set();
function initFiltresReleve() {
  const sel = document.getElementById('r-mois');
  if (!sel.options.length) {
    const out = [];
    for (let d = new Date(new Date().getFullYear(), new Date().getMonth(), 1); d >= new Date(2026, 0, 1); d.setMonth(d.getMonth() - 1))
      out.push(`<option value="${d.getFullYear()}-${d.getMonth() + 1}">${MOIS[d.getMonth()]} ${d.getFullYear()}</option>`);
    sel.innerHTML = out.join('');
    document.getElementById('r-motif').innerHTML = '<option value="">Tous</option><option value="RECETTE">Recettes</option>' + motifs.map(m => `<option value="${escapeHtml(m.nom)}">${escapeHtml(libMotif(m.nom))}</option>`).join('');
  }
  document.getElementById('r-membre').innerHTML = '<option value="">Tous</option>' + membres.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(nomMembre(m))}${m.actif === false ? ' (désactivé)' : ''}</option>`).join('') + '<option value="null">Membres supprimés</option>';
}
async function chargerReleve() {
  const mSel = document.getElementById('r-membre').value;
  initFiltresReleve();
  document.getElementById('r-membre').value = mSel;
  const [a, m] = document.getElementById('r-mois').value.split('-');
  const { debut, fin } = bornesMois(a, m);
  document.getElementById('r-liste').innerHTML = document.getElementById('r-table').innerHTML = '<div class="skel" style="height:120px"></div>';
  try {
    _rel = await fetchAll(() => sb.from('transactions').select(SEL_TX).eq('maison_id', userProfile.maison_id).gte('created_at', debut).lt('created_at', fin).order('created_at', { ascending: false }));
    _relJ = await idsAvecJustif(_rel.map(t => t.id));
  } catch (e) { document.getElementById('r-liste').innerHTML = document.getElementById('r-table').innerHTML = '<p class="empty red">Erreur de chargement</p>'; return; }
  _rel.forEach(t => _tx[t.id] = t);
  afficherReleve();
}
function filtreReleve() {
  const mb = document.getElementById('r-membre').value, mo = document.getElementById('r-motif').value, st = document.getElementById('r-statut').value;
  const q = document.getElementById('r-q').value.trim().toLowerCase();
  return _rel.filter(t => {
    if (mb === 'null' ? t.user_id : (mb && t.user_id !== mb)) return false;
    if (mo && t.motif !== mo) return false;
    if (st === 'sorties' && t.type !== 'depense') return false;
    if (st === 'entrees' && t.type !== 'recette') return false;
    if (st === 'attente' && !(t.type === 'depense' && t.statut === 'attente')) return false;
    if (st === 'sansjustif' && !(t.type === 'depense' && !aJustif(t, _relJ))) return false;
    if (q && ![t.motif, t.commentaire, nomMembre(t.profiles), PAIEMENTS[t.methode_paiement], String(t.montant).replace('.', ','), eur(t.montant)].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
}
function afficherReleve() {
  const l = filtreReleve();
  const s = (arr, ty) => arr.filter(t => t.type === ty).reduce((x, t) => x + parseFloat(t.montant), 0);
  document.getElementById('r-in').textContent = '+' + eur(s(_rel, 'recette'));
  document.getElementById('r-out').textContent = '−' + eur(s(_rel, 'depense'));
  const net = s(l, 'recette') - s(l, 'depense');
  document.getElementById('r-sel').textContent = `${net >= 0 ? '+' : '−'}${eur(Math.abs(net))}`;
  if (!l.length) { document.getElementById('r-liste').innerHTML = document.getElementById('r-table').innerHTML = `<div class="card empty">${_rel.length ? 'Aucune opération ne correspond' : 'Aucune opération ce mois-ci'}</div>`; return; }
  // Ordinateur : tableau
  document.getElementById('r-table').innerHTML = `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th scope="col">Date</th><th scope="col">Membre</th><th scope="col">Motif</th><th scope="col">Commentaire</th><th scope="col">Paiement</th><th scope="col">Statut</th><th scope="col">Justif.</th><th scope="col" class="r">Montant</th></tr></thead>
    <tbody>${l.map(t => {
      const dep = t.type === 'depense';
      const st = !dep ? '' : t.statut === 'attente' ? '<span class="pill warn">À rembourser</span>' : estPerso(t.methode_paiement) ? '<span class="pill ok">Remboursé</span>' : '<span class="muted small">Validé</span>';
      const j = !dep ? '' : aJustif(t, _relJ) ? `<span class="ok">${svg(IC.check, 18)}</span><span class="sr-only">oui</span>` : '<span class="red bold small">Manquant</span>';
      return `<tr onclick="ouvrirDetail('${escapeHtml(t.id)}')" tabindex="0" onkeydown="if(event.key==='Enter')ouvrirDetail('${escapeHtml(t.id)}')">
        <td class="num">${new Date(t.created_at).toLocaleDateString('fr-FR')}</td><td>${escapeHtml(nomMembre(t.profiles))}</td>
        <td><span class="row" style="gap:8px"><span class="dot" style="background:${dep ? couleurMotif(t.motif) : '#1F7A4D'}"></span>${escapeHtml(dep ? libMotif(t.motif) : 'Recette')}</span></td>
        <td class="muted">${escapeHtml(t.commentaire || '')}</td><td>${escapeHtml(PAIEMENTS[t.methode_paiement] || '')}</td><td>${st}</td><td>${j}</td>
        <td class="r num bold ${dep ? '' : 'ok'}">${eurSigne(t)}</td></tr>`;
    }).join('')}</tbody>
    <tfoot><tr><td colspan="7">${l.length} opération${l.length > 1 ? 's' : ''}</td><td class="r num">${net >= 0 ? '+' : '−'}${eur(Math.abs(net))}</td></tr></tfoot></table></div>`;
  // Téléphone : liste par jour
  const jours = {};
  l.forEach(t => { const k = isoVersDateSaisie(t.created_at); (jours[k] = jours[k] || []).push(t); });
  document.getElementById('r-liste').innerHTML = Object.values(jours).map(ops => {
    const n = ops.reduce((x, t) => x + (t.type === 'recette' ? 1 : -1) * parseFloat(t.montant), 0);
    return `<div class="card card-flush"><div class="day-head"><span>${jourFr(ops[0].created_at)}</span><span class="num">${n >= 0 ? '+' : '−'}${eur(Math.abs(n))}</span></div>${ops.map(t => ligneOp(t, _relJ)).join('')}</div>`;
  }).join('');
}
function lignesExcel(l, js) {
  return l.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)).map(t => ({
    'Date': new Date(t.created_at).toLocaleDateString('fr-FR'), 'Membre': nomMembre(t.profiles),
    'Type': t.type === 'recette' ? 'Recette' : 'Dépense', 'Motif': t.type === 'recette' ? '' : libMotif(t.motif),
    'Commentaire': t.commentaire || '', 'Montant (€)': (t.type === 'recette' ? 1 : -1) * parseFloat(t.montant),
    'Paiement': PAIEMENTS[t.methode_paiement] || '', 'Statut': t.statut === 'attente' ? 'À rembourser' : 'Validé',
    'Justificatif': t.type === 'depense' ? (aJustif(t, js) ? 'Oui' : 'Non') : ''
  }));
}
function exporterMois() {
  if (typeof XLSX === 'undefined') return showToast('Export indisponible hors connexion', 'warning');
  const l = filtreReleve(); if (!l.length) return showToast('Aucune opération à exporter', 'warning');
  const [a, m] = document.getElementById('r-mois').value.split('-');
  const ws = XLSX.utils.json_to_sheet(lignesExcel(l, _relJ));
  ws['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 10 }, { wch: 16 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, `${MOIS[m - 1]} ${a}`);
  XLSX.writeFile(wb, `Releve_${(userProfile.maisons?.nom || 'maison').replace(/\W+/g, '_')}_${MOIS[m - 1]}_${a}.xlsx`);
}
async function zipJustifs(debut, fin, nomZip) {
  if (typeof JSZip === 'undefined') return showToast('Export indisponible hors connexion', 'warning');
  ouvrirFeuille(`<p class="bold" id="zip-txt" style="margin:0 0 10px">Préparation…</p><div class="bar"><div id="zip-bar" style="width:5%;background:var(--primary)"></div></div>`, { titre: 'Export des justificatifs' });
  try {
    const txs = await fetchAll(() => sb.from('transactions').select('id,user_id,created_at,motif,montant,commentaire,justificatif_url,profiles(prenom,nom)')
      .eq('maison_id', userProfile.maison_id).eq('type', 'depense').gte('created_at', debut).lt('created_at', fin).order('created_at'));
    if (!txs.length) { fermerFeuille(); return showToast('Aucune dépense sur la période', 'warning'); }
    const S = SMMD_EXPORT.slug;
    const r = await SMMD_EXPORT.exporterJustificatifs({
      sb, txs, JSZip, nomZip,
      dossier: t => (t.profiles ? S(t.profiles.prenom, 'Membre') + '_' + S((t.profiles.nom || '').toUpperCase(), '') : 'Membres_supprimes') + '/' + SMMD_EXPORT.dateISO(t).slice(0, 7),
      onProgress: (txt, pct) => { const a = document.getElementById('zip-txt'), b = document.getElementById('zip-bar'); if (a) a.textContent = txt; if (b) b.style.width = pct + '%'; }
    });
    fermerFeuille();
    showToast(`${r.nbFichiers} fichier(s)` + (r.nbSans ? ` · ${r.nbSans} sans justificatif` : '') + (r.problemes ? ` · ${r.problemes} problème(s), voir LISEZMOI.txt` : ''), r.problemes ? 'warning' : 'success');
  } catch (e) { fermerFeuille(); showToast('Export impossible : ' + e.message, 'error'); }
}
function zipMois() { const [a, m] = document.getElementById('r-mois').value.split('-'); const { debut, fin } = bornesMois(a, m); zipJustifs(debut, fin, `Justificatifs_${MOIS[m - 1]}_${a}.zip`); }
function zipAnnee() { const a = document.getElementById('ex-annee').value; const { debut, fin } = bornesAnnee(a); zipJustifs(debut, fin, `Justificatifs_${a}.zip`); }
async function exporterAnnee() {
  if (typeof XLSX === 'undefined') return showToast('Export indisponible hors connexion', 'warning');
  const a = parseInt(document.getElementById('ex-annee').value);
  const { debut, fin } = bornesAnnee(a);
  try {
    const [txs, allocs] = await Promise.all([
      fetchAll(() => sb.from('transactions').select(SEL_TX).eq('maison_id', userProfile.maison_id).gte('created_at', debut).lt('created_at', fin)),
      fetchAll(() => sb.from('allocations_versees').select('*').eq('maison_id', userProfile.maison_id).eq('annee', a))
    ]);
    const conf = allocs.filter(allocConfirmee);
    const js = await idsAvecJustif(txs.map(t => t.id));
    const recap = {};
    const R = id => (recap[id || 'null'] = recap[id || 'null'] || { nom: id ? nomDe(id) : 'Membre supprimé', dep: 0, rec: 0, alloc: 0, att: 0, n: 0 });
    txs.forEach(t => { const r = R(t.user_id); if (t.type === 'recette') r.rec += +t.montant; else r.dep += +t.montant; if (t.type === 'depense' && t.statut === 'attente') r.att += +t.montant; r.n++; });
    conf.forEach(x => { R(x.user_id).alloc += +x.montant; });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.values(recap).map(r => ({
      'Membre': r.nom, 'Allocations confirmées (€)': +r.alloc.toFixed(2), 'Recettes (€)': +r.rec.toFixed(2), 'Dépenses (€)': +r.dep.toFixed(2),
      'Avances à rembourser (€)': +r.att.toFixed(2), 'Nb opérations': r.n }))), 'Récapitulatif');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(conf.sort((x, y) => x.mois - y.mois).map(x => ({
      'Mois': MOIS[x.mois - 1], 'Membre': nomDe(x.user_id), 'Montant (€)': +parseFloat(x.montant).toFixed(2),
      'Confirmé par': x.valide_par ? nomDe(x.valide_par) : '', 'Confirmé le': x.date_confirmation ? new Date(x.date_confirmation).toLocaleDateString('fr-FR') : '' }))), 'Allocations');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lignesExcel(txs, js)), 'Opérations');
    XLSX.writeFile(wb, `Rapport_${(userProfile.maisons?.nom || 'maison').replace(/\W+/g, '_')}_${a}.xlsx`);
  } catch (e) { showToast('Export impossible : ' + e.message, 'error'); }
}

// ─────────────────────────────────────────────── REMBOURSEMENTS + SEPA
let _avances = [], _avJ = new Set(), _enCours = new Set(), _virs = [];
async function chargerRemb() {
  const box = document.getElementById('rb-liste');
  box.innerHTML = '<div class="skel" style="height:140px"></div>';
  try {
    const [av, v] = await Promise.all([
      fetchAll(() => sb.from('transactions').select(SEL_TX).eq('maison_id', userProfile.maison_id).eq('type', 'depense').eq('statut', 'attente').order('created_at')),
      sb.from('virements_sepa').select('*').eq('maison_id', userProfile.maison_id).eq('statut', 'genere').order('created_at', { ascending: false })
    ]);
    if (v.error) throw new Error(v.error.message.includes('virements_sepa') ? 'Table des virements absente : exécutez le script SQL « 2026-11-26_sepa.sql »' : v.error.message);
    _avances = av; _virs = v.data || [];
    _avJ = await idsAvecJustif(av.map(t => t.id));
  } catch (e) { box.innerHTML = `<p class="empty red">${escapeHtml(e.message)}</p>`; return; }
  _avances.forEach(t => _tx[t.id] = t);
  _enCours = new Set(_virs.flatMap(v => (v.detail || []).flatMap(d => d.tx_ids || [])));

  document.getElementById('rb-virements').innerHTML = _virs.map(v => `<div class="card" style="border-color:var(--warn);margin-bottom:12px">
      <div class="between" style="flex-wrap:wrap"><div><h2>Virement à confirmer</h2>
        <p class="small muted" style="margin:2px 0 0">Généré le ${new Date(v.created_at).toLocaleString('fr-FR')} · ${v.nb_virements} virement${v.nb_virements > 1 ? 's' : ''} · <b class="num" style="color:var(--ink)">${eur(v.total)}</b></p>
        <p class="small" style="margin:4px 0 0">${(v.detail || []).map(d => `${escapeHtml(d.nom)} ${eur(d.montant)}`).join(' · ')}</p></div></div>
      <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:12px">
        <button class="btn" onclick="confirmerVirement('${v.id}')">${svg(IC.check, 18)}Virement effectué</button>
        <button class="btn quiet" onclick="retelechargerSepa('${v.id}')">Télécharger à nouveau</button>
        <button class="btn danger" onclick="annulerVirement('${v.id}')">Annuler</button></div></div>`).join('');
  document.getElementById('rb-compte').innerHTML = compteMaison ? '' : `<div class="banner warn">${svg(IC.alert, 18)}<span>Renseignez le compte bancaire de la maison pour générer des virements SEPA.</span><button class="link" style="margin-left:auto" onclick="go('profil')">Renseigner</button></div>`;

  const dispo = _avances.filter(t => !_enCours.has(t.id));
  if (!dispo.length) { box.innerHTML = `<div class="card empty">${_avances.length ? 'Toutes les avances sont dans un virement en cours.' : `${svg(IC.check, 20)} Aucune avance à rembourser`}</div>`; document.getElementById('rb-foot').classList.add('hidden'); return; }
  const parMembre = {};
  dispo.forEach(t => (parMembre[t.user_id || 'null'] = parMembre[t.user_id || 'null'] || []).push(t));
  box.innerHTML = Object.entries(parMembre).map(([uid, ops]) => {
    const m = membres.find(x => x.id === uid);
    const iban = m?.iban || ops[0].profiles?.iban;
    const total = ops.reduce((s, t) => s + parseFloat(t.montant), 0);
    return `<div class="card member-card" data-uid="${escapeHtml(uid)}">
      <div class="member-head"><span class="avatar">${escapeHtml(initiales(m))}</span>
        <div style="flex:1;min-width:0"><p class="bold" style="margin:0">${escapeHtml(m ? nomMembre(m) : 'Membre supprimé')}</p>
          ${iban ? `<p class="iban muted" style="margin:0">${escapeHtml(iban.replace(/(.{4})/g, '$1 ').trim())} <button class="link" style="min-height:auto;padding:0 4px" onclick="copier('${escapeHtml(iban)}')">Copier</button></p>` : '<p class="red small bold" style="margin:0">IBAN manquant : virement impossible</p>'}</div>
        <span class="num bold">${eur(total)}</span></div>
      <div>${ops.map(t => {
        const j = aJustif(t, _avJ);
        return `<label class="chk-row"><input type="checkbox" data-id="${escapeHtml(t.id)}" ${j ? 'checked' : ''} onchange="majSelection()">
          <span style="flex:1;min-width:0"><b style="display:block;font-weight:600">${escapeHtml(libMotif(t.motif))} · ${dateFr(t.created_at)}</b>
          <span class="small ${j ? 'muted' : 'red bold'}">${j ? escapeHtml(t.commentaire || PAIEMENTS[t.methode_paiement] || '') : 'Sans justificatif — vérifiez avant de rembourser'}</span></span>
          <button class="link" style="min-height:auto" onclick="event.preventDefault();ouvrirDetail('${escapeHtml(t.id)}')">Voir</button>
          <span class="num bold">${eur(t.montant)}</span></label>`;
      }).join('')}</div></div>`;
  }).join('');
  majSelection();
}
function selection() {
  return [...document.querySelectorAll('#rb-liste input[type=checkbox]:checked')].map(c => _tx[c.dataset.id]).filter(Boolean);
}
function majSelection() {
  const sel = selection();
  document.getElementById('rb-foot').classList.toggle('hidden', !_avances.length);
  document.getElementById('rb-total').textContent = `${eur(sel.reduce((s, t) => s + parseFloat(t.montant), 0))} · ${sel.length} avance${sel.length > 1 ? 's' : ''}`;
  document.getElementById('rb-sepa').disabled = !sel.length;
}
function copier(t) { navigator.clipboard?.writeText(t).then(() => showToast('Copié', 'success')).catch(() => showToast('Copie impossible', 'error')); }

// Texte autorisé par la norme SEPA (jeu latin restreint)
const sepaTxt = (s, max) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;').replace(/"/g, '&quot;');
function construireSepa(ref, compte, lots, dateExec) {
  const total = lots.reduce((s, l) => s + l.montant, 0).toFixed(2);
  const now = new Date().toISOString().slice(0, 19);
  const dbtrAgt = compte.bic ? `<FinInstnId><BIC>${xmlEsc(compte.bic)}</BIC></FinInstnId>` : '<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>';
  const tx = lots.map((l, i) => `
      <CdtTrfTxInf>
        <PmtId><EndToEndId>${xmlEsc(sepaTxt(ref + '-' + (i + 1), 35))}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="EUR">${l.montant.toFixed(2)}</InstdAmt></Amt>
        <Cdtr><Nm>${xmlEsc(sepaTxt(l.nom, 70))}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${xmlEsc(l.iban)}</IBAN></Id></CdtrAcct>
        <RmtInf><Ustrd>${xmlEsc(sepaTxt(l.libelle, 140))}</Ustrd></RmtInf>
      </CdtTrfTxInf>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${xmlEsc(ref)}</MsgId>
      <CreDtTm>${now}</CreDtTm>
      <NbOfTxs>${lots.length}</NbOfTxs>
      <CtrlSum>${total}</CtrlSum>
      <InitgPty><Nm>${xmlEsc(sepaTxt(compte.titulaire, 70))}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${xmlEsc(ref)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>false</BtchBookg>
      <NbOfTxs>${lots.length}</NbOfTxs>
      <CtrlSum>${total}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt>${dateExec}</ReqdExctnDt>
      <Dbtr><Nm>${xmlEsc(sepaTxt(compte.titulaire, 70))}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${xmlEsc(compte.iban)}</IBAN></Id></DbtrAcct>
      <DbtrAgt>${dbtrAgt}</DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>${tx}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
}
function telechargerTexte(nom, contenu, mime) {
  const url = URL.createObjectURL(new Blob([contenu], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = nom;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function genererSepa() {
  if (!compteMaison) { showToast('Renseignez d\'abord le compte bancaire de la maison', 'warning'); return go('profil'); }
  const sel = selection(); if (!sel.length) return;
  const parM = {};
  sel.forEach(t => (parM[t.user_id || 'null'] = parM[t.user_id || 'null'] || []).push(t));
  const lots = [], exclus = [];
  Object.entries(parM).forEach(([uid, ops]) => {
    const m = membres.find(x => x.id === uid);
    const iban = m?.iban;
    if (!m || !iban || !validateIban(iban)) { exclus.push(m ? nomMembre(m) : 'Membre supprimé'); return; }
    const mois = [...new Set(ops.map(t => MOIS[new Date(t.created_at).getMonth()]))].join(' ');
    lots.push({ user_id: uid, nom: nomMembre(m), iban: normalizeIban(iban), montant: Math.round(ops.reduce((s, t) => s + parseFloat(t.montant), 0) * 100) / 100,
      tx_ids: ops.map(t => t.id), libelle: `Remboursement avances SMMD ${mois}` });
  });
  if (!lots.length) return showToast('Aucun membre sélectionné n\'a d\'IBAN valide', 'error');
  const nbSans = sel.filter(t => !aJustif(t, _avJ)).length;
  const total = lots.reduce((s, l) => s + l.montant, 0);
  showConfirm(`Générer ${lots.length} virement${lots.length > 1 ? 's' : ''} pour ${eur(total)} depuis le compte « ${compteMaison.titulaire} » ?` +
    (exclus.length ? ` Exclus faute d'IBAN : ${exclus.join(', ')}.` : '') + (nbSans ? ` Attention : ${nbSans} avance(s) sans justificatif.` : ''), async () => {
    const ref = 'SMMD' + new Date().toISOString().replace(/\D/g, '').slice(0, 14) + Math.random().toString(36).slice(2, 6).toUpperCase();
    const dateExec = isoVersDateSaisie(new Date().toISOString());
    const xml = construireSepa(ref, compteMaison, lots, dateExec);
    const { error } = await sb.from('virements_sepa').insert([{ maison_id: userProfile.maison_id, created_by: userProfile.id, reference: ref, date_execution: dateExec,
      nb_virements: lots.length, total: +total.toFixed(2), detail: lots.map(({ libelle, ...l }) => l) }]);
    if (error) return showToast('Erreur : ' + error.message, 'error');
    telechargerTexte(`Virement_SEPA_${sepaTxt(userProfile.maisons?.nom || 'maison', 30).replace(/ /g, '_')}_${dateExec}.xml`, xml, 'application/xml');
    showToast('Fichier téléchargé : importez-le dans la banque de la maison, puis confirmez ici', 'success');
    chargerRemb();
  }, 'Générer');
}
async function retelechargerSepa(id) {
  const v = _virs.find(x => x.id === id); if (!v || !compteMaison) return;
  const lots = (v.detail || []).map(d => ({ ...d, libelle: 'Remboursement avances SMMD' }));
  telechargerTexte(`Virement_SEPA_${v.reference}.xml`, construireSepa(v.reference, compteMaison, lots, v.date_execution || isoVersDateSaisie(v.created_at)), 'application/xml');
}
async function marquerRembourse(lots, viaVirement) {
  const now = new Date().toISOString();
  for (const l of lots) {
    for (let i = 0; i < l.tx_ids.length; i += 100) {
      const { error } = await sb.from('transactions').update({ statut: 'valide', date_validation: now })
        .in('id', l.tx_ids.slice(i, i + 100)).eq('maison_id', userProfile.maison_id).eq('statut', 'attente');
      if (error) throw error;
    }
    if (l.user_id && l.user_id !== 'null') {
      const msg = `Votre chef de maison vous a remboursé ${eur(l.montant)} (${l.tx_ids.length} avance${l.tx_ids.length > 1 ? 's' : ''})${viaVirement ? ' par virement' : ''}.`;
      await sb.from('notifications').insert([{ user_id: l.user_id, lu: false, type: 'remboursement', message: msg }]);
      envoyerPush([l.user_id], 'Remboursement reçu', msg, './v2/membre.html');
    }
  }
}
function confirmerVirement(id) {
  const v = _virs.find(x => x.id === id); if (!v) return;
  showConfirm(`Le virement de ${eur(v.total)} a bien été passé à la banque ? Les avances seront marquées remboursées et les membres prévenus.`, async () => {
    try {
      await marquerRembourse(v.detail || [], true);
      const { error } = await sb.from('virements_sepa').update({ statut: 'effectue', date_statut: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      showToast('Avances remboursées, membres prévenus', 'success'); chargerRemb();
    } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
  }, 'Virement effectué');
}
function annulerVirement(id) {
  showConfirm('Annuler ce virement ? Les avances redeviennent disponibles pour un nouveau virement. (À faire seulement si la banque ne l\'a pas exécuté.)', async () => {
    const { error } = await sb.from('virements_sepa').update({ statut: 'annule', date_statut: new Date().toISOString() }).eq('id', id);
    if (error) return showToast('Erreur : ' + error.message, 'error');
    showToast('Virement annulé', 'info'); chargerRemb();
  }, 'Annuler le virement', true);
}
function rembourserSansVirement() {
  const sel = selection(); if (!sel.length) return showToast('Cochez les avances à marquer', 'warning');
  const parM = {};
  sel.forEach(t => (parM[t.user_id || 'null'] = parM[t.user_id || 'null'] || []).push(t));
  const lots = Object.entries(parM).map(([uid, ops]) => ({ user_id: uid, montant: ops.reduce((s, t) => s + parseFloat(t.montant), 0), tx_ids: ops.map(t => t.id) }));
  const total = lots.reduce((s, l) => s + l.montant, 0);
  showConfirm(`Marquer ${sel.length} avance${sel.length > 1 ? 's' : ''} (${eur(total)}) comme remboursée${sel.length > 1 ? 's' : ''} autrement (espèces, chèque, virement manuel) ?`, async () => {
    try { await marquerRembourse(lots, false); showToast('Avances marquées remboursées', 'success'); chargerRemb(); }
    catch (e) { showToast('Erreur : ' + e.message, 'error'); }
  }, 'Marquer remboursé');
}

// ─────────────────────────────────────────────── ALLOCATIONS (le chef confirme)
let _allocs = [];
async function chargerAllocations() {
  const box = document.getElementById('al-liste');
  try {
    [_allocs, membres] = await Promise.all([
      fetchAll(() => sb.from('allocations_versees').select('*').eq('maison_id', userProfile.maison_id)),
      fetchAll(() => sb.from('profiles').select('*').eq('maison_id', userProfile.maison_id).order('prenom'))
    ]);
  } catch (e) { box.innerHTML = '<p class="empty red">Erreur de chargement</p>'; return; }
  const trouver = (uid, m, a) => _allocs.find(x => x.user_id === uid && parseInt(x.mois) === m && parseInt(x.annee) === a);
  compteur('alloc', _allocs.filter(a => !allocConfirmee(a)).length);
  const mois = [];
  for (let d = new Date(new Date().getFullYear(), new Date().getMonth(), 1); d >= new Date(2026, 0, 1); d.setMonth(d.getMonth() - 1)) mois.push({ m: d.getMonth() + 1, a: d.getFullYear() });
  box.innerHTML = mois.map(({ m, a }, idx) => {
    const concernes = membres.filter(x => (x.actif !== false && parseFloat(x.allocation_mensuelle) > 0) || trouver(x.id, m, a));
    const sansAlloc = membres.filter(x => x.actif !== false && !(parseFloat(x.allocation_mensuelle) > 0) && !trouver(x.id, m, a));
    const etats = concernes.map(x => { const v = trouver(x.id, m, a); return { x, v, e: !v ? 'aucun' : allocConfirmee(v) ? 'conf' : 'decl' }; });
    const nConf = etats.filter(s => s.e === 'conf').length;
    const totConf = etats.reduce((s, z) => s + (z.e === 'conf' ? parseFloat(z.v.montant) : 0), 0);
    const totAtt = etats.reduce((s, z) => s + (z.v ? parseFloat(z.v.montant) : parseFloat(z.x.allocation_mensuelle) || 0), 0);
    const ouvert = idx < 2 || etats.some(s => s.e === 'decl');
    return `<details class="card" ${ouvert ? 'open' : ''}><summary class="between" style="cursor:pointer;list-style:none">
        <h2>${MOIS[m - 1].charAt(0).toUpperCase() + MOIS[m - 1].slice(1)} ${a}</h2>
        <span class="row" style="gap:8px">${etats.some(s => s.e === 'decl') ? '<span class="pill warn">À confirmer</span>' : ''}<span class="num small ${nConf === concernes.length ? 'ok' : 'muted'} bold">${eur(totConf)} / ${eur(totAtt)}</span></span></summary>
      <div style="margin-top:6px">${etats.map(({ x, v, e }) => `<button class="alloc-row" data-uid="${escapeHtml(x.id)}" data-m="${m}" data-a="${a}" data-vid="${v ? escapeHtml(v.id) : ''}" data-etat="${e}" data-montant="${v ? v.montant : (parseFloat(x.allocation_mensuelle) || 0)}" onclick="basculerAllocChef(this)">
          <span class="row"><span class="box ${e}">${e !== 'aucun' ? svg(IC.check, 16, 3) : ''}</span>
          <span><b style="display:block">${escapeHtml(nomMembre(x))}${x.actif === false ? ' <span class="muted small">(désactivé)</span>' : ''}</b>
          <span class="small ${e === 'conf' ? 'ok' : e === 'decl' ? 'warn' : 'muted'}">${e === 'conf' ? 'Confirmé' + (v.date_confirmation ? ' le ' + new Date(v.date_confirmation).toLocaleDateString('fr-FR') : '') : e === 'decl' ? 'Déclaré le ' + new Date(v.created_at).toLocaleDateString('fr-FR') + ' — touchez pour confirmer' : 'Non versé'}</span></span></span>
          <span class="num bold ${e === 'conf' ? 'ok' : e === 'decl' ? 'warn' : 'muted'}">${eur(v ? v.montant : x.allocation_mensuelle)}</span></button>`).join('')}
        ${sansAlloc.map(x => `<div class="alloc-row" style="cursor:default;opacity:.7"><span class="row"><span class="box"></span><span><b style="display:block">${escapeHtml(nomMembre(x))}</b><span class="small red">Allocation non définie (Membres)</span></span></span></div>`).join('')}
      </div></details>`;
  }).join('');
}
async function basculerAllocChef(btn) {
  const { uid, vid, etat } = btn.dataset, m = +btn.dataset.m, a = +btn.dataset.a, montant = parseFloat(btn.dataset.montant);
  const lib = `${nomDe(uid)} — ${MOIS[m - 1]} ${a}`;
  const now = new Date().toISOString();
  if (etat === 'conf') {
    return showConfirm(`Annuler le versement confirmé de ${lib} (${eur(montant)}) ?`, async () => {
      const { error } = await sb.from('allocations_versees').delete().eq('id', vid).eq('maison_id', userProfile.maison_id);
      if (error) return showToast('Erreur : ' + error.message, 'error');
      showToast('Versement annulé', 'info'); chargerAllocations();
    }, 'Annuler le versement', true);
  }
  if (!(montant > 0)) return showToast('Allocation non définie pour ce membre', 'warning');
  btn.disabled = true;
  let res;
  if (etat === 'decl') res = await sb.from('allocations_versees').update({ statut: 'confirme', valide_par: userProfile.id, date_confirmation: now }).eq('id', vid).eq('maison_id', userProfile.maison_id).select('id');
  else res = await sb.from('allocations_versees').insert([{ user_id: uid, maison_id: userProfile.maison_id, mois: m, annee: a, montant, statut: 'confirme', valide_par: userProfile.id, date_confirmation: now }]).select('id');
  btn.disabled = false;
  if (res.error || !(res.data || []).length) return showToast('Erreur : ' + (res.error?.message || 'refusé par la base'), 'error');
  if (uid !== userProfile.id) {
    const msg = `Votre allocation de ${MOIS[m - 1]} ${a} (${eur(montant)}) est confirmée par votre chef de maison.`;
    sb.from('notifications').insert([{ user_id: uid, lu: false, type: 'allocation', message: msg }]);
    envoyerPush([uid], 'Allocation confirmée', msg, './v2/membre.html');
  }
  showToast(`${lib} confirmé`, 'success'); chargerAllocations();
}

// ─────────────────────────────────────────────── MEMBRES
async function chargerMembres() {
  try { membres = await fetchAll(() => sb.from('profiles').select('*').eq('maison_id', userProfile.maison_id).order('prenom')); }
  catch (e) { return showToast('Erreur de chargement', 'error'); }
  const actifs = membres.filter(m => m.actif !== false), inactifs = membres.filter(m => m.actif === false);
  document.getElementById('m-liste').innerHTML = actifs.map(m => `<div class="card member-card">
    <div class="member-head"><span class="avatar">${escapeHtml(initiales(m))}</span><div style="flex:1;min-width:0"><p class="bold" style="margin:0">${escapeHtml(nomMembre(m))}</p><p class="small muted" style="margin:0">${m.role === 'chef' ? 'Chef de maison' : 'Membre'}</p></div></div>
    <label class="field"><span>Allocation mensuelle (€)</span><input class="input num" type="number" inputmode="decimal" min="0" step="0.01" value="${parseFloat(m.allocation_mensuelle) || 0}" onchange="majAllocMembre('${escapeHtml(m.id)}', this)"></label>
    ${m.iban ? `<div class="between"><span class="iban muted">${escapeHtml(m.iban.replace(/(.{4})/g, '$1 ').trim())}</span><button class="link" onclick="copier('${escapeHtml(m.iban)}')">Copier</button></div>` : '<p class="small red bold" style="margin:0">IBAN non renseigné</p>'}
  </div>`).join('');
  document.getElementById('m-inactifs').innerHTML = inactifs.length ? `<details class="card"><summary style="cursor:pointer" class="bold">Comptes désactivés (${inactifs.length})</summary><p class="small muted">${inactifs.map(nomMembre).map(escapeHtml).join(', ')}</p><p class="xs muted">L'historique est conservé. Seul l'administrateur peut réactiver un compte.</p></details>` : '';
}
async function majAllocMembre(uid, inp) {
  const v = parseFloat(String(inp.value).replace(',', '.'));
  if (isNaN(v) || v < 0) return showToast('Montant invalide', 'error');
  const { data, error } = await sb.from('profiles').update({ allocation_mensuelle: v }).eq('id', uid).select('id');
  if (error || !(data || []).length) return showToast('Erreur : ' + (error?.message || 'refusé par la base'), 'error');
  const m = membres.find(x => x.id === uid); if (m) m.allocation_mensuelle = v;
  if (uid === userProfile.id) userProfile.allocation_mensuelle = v;
  showToast('Allocation mise à jour', 'success');
}

// ─────────────────────────────────────────────── MAISON ET PROFIL
function chargerProfil() {
  majCarteNotifications();
  document.getElementById('cm-titulaire').value = compteMaison?.titulaire || ('Maison ' + (userProfile.maisons?.nom || ''));
  document.getElementById('cm-iban').value = compteMaison?.iban || '';
  document.getElementById('cm-bic').value = compteMaison?.bic || '';
  document.getElementById('p-iban').value = userProfile.iban || '';
  document.getElementById('p-alloc').value = parseFloat(userProfile.allocation_mensuelle) || '';
  const sel = document.getElementById('ex-annee');
  if (!sel.options.length) for (let y = new Date().getFullYear(); y >= 2026; y--) sel.insertAdjacentHTML('beforeend', `<option>${y}</option>`);
}
async function majCompteMaison() {
  const titulaire = document.getElementById('cm-titulaire').value.trim();
  const iban = document.getElementById('cm-iban').value.trim();
  const bic = document.getElementById('cm-bic').value.replace(/\s/g, '').toUpperCase();
  const err = document.getElementById('cm-err');
  const ko = m => { err.textContent = m; err.classList.remove('hidden'); };
  if (!titulaire) return ko('Indiquez le titulaire du compte.');
  if (!validateIban(iban)) return ko('IBAN invalide.');
  if (bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) return ko('BIC invalide (8 ou 11 caractères).');
  err.classList.add('hidden');
  const row = { maison_id: userProfile.maison_id, titulaire, iban: normalizeIban(iban), bic: bic || null, updated_at: new Date().toISOString(), updated_by: userProfile.id };
  const { error } = await sb.from('comptes_maisons').upsert(row);
  if (error) return ko(error.message.includes('comptes_maisons') ? 'Table absente : exécutez le script SQL « 2026-11-26_sepa.sql ».' : error.message);
  compteMaison = row; showToast('Compte de la maison enregistré', 'success');
}
async function majIban() {
  const raw = document.getElementById('p-iban').value.trim(), err = document.getElementById('p-iban-err');
  if (raw && !validateIban(raw)) { err.classList.remove('hidden'); return; }
  err.classList.add('hidden');
  const iban = raw ? normalizeIban(raw) : null;
  const { error } = await sb.from('profiles').update({ iban }).eq('id', userProfile.id);
  if (error) return showToast('Erreur : ' + error.message, 'error');
  userProfile.iban = iban; const m = membres.find(x => x.id === userProfile.id); if (m) m.iban = iban;
  showToast('IBAN enregistré', 'success');
}
async function majAllocation() {
  const inp = document.getElementById('p-alloc');
  await majAllocMembre(userProfile.id, inp);
}
async function majMotDePasse() {
  const p = document.getElementById('p-pass').value;
  if (p.length < 6) return showToast('6 caractères minimum', 'error');
  const { error } = await sb.auth.updateUser({ password: p });
  if (error) return showToast(error.message, 'error');
  document.getElementById('p-pass').value = ''; showToast('Mot de passe modifié', 'success');
}

init().catch(e => { console.error(e); showToast('Erreur au démarrage : ' + e.message, 'error'); });
