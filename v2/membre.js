// ═══════════════════════════════════════════════════════════
// SMMD v2 — Espace membre (direction D)
// S'appuie sur ../config.js (helpers partagés, scan IA, journal d'erreurs)
// ═══════════════════════════════════════════════════════════
const sb = supabase.createClient(SMMD_CONFIG.url, SMMD_CONFIG.key);
let userProfile = null;
let motifs = [];
let _vue = 'accueil';
const _tx = {};                       // cache des opérations par id
const MOIS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const PALETTE = ['#8B1E2D','#2B5797','#7A6A2E','#5B4B8A','#1F7A4D','#B4400A','#0E7490','#9D174D','#4D7C0F','#57534E'];
const PAIEMENTS = { cb_maison: 'CB maison', perso_cb: 'Carte perso', perso_liq: 'Espèces' };

const eur = v => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(v || 0);
const eurSigne = t => (t.type === 'recette' ? '+' : '−') + eur(Math.abs(parseFloat(t.montant)));
const dateFr = iso => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const jourFr = iso => { const s = new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1); };
const couleurMotif = m => { const i = motifs.findIndex(x => x.nom === m); return i < 0 ? PALETTE[PALETTE.length - 1] : PALETTE[i % PALETTE.length]; };
const libMotif = m => m ? m.charAt(0).toUpperCase() + m.slice(1) : 'Autre';
const svg = (d, s = 20, w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  check: '<path d="M5 12.5 10 17 19 7"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  clip: '<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  cam: '<path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="4"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  cloud: '<path d="M3 3l18 18"/><path d="M7 18h10a4 4 0 0 0 1-7.9M9.5 6.3A6 6 0 0 1 17 9.5"/>'
};

// ─────────────────────────────────────────────── Toast & confirmation
function showToast(message, type = 'info') {
  if (type === 'error' && window.smmdSignaler) window.smmdSignaler('message', message);
  document.getElementById('smmd-toast')?.remove();
  const c = { success: '#1F7A4D', error: '#B42318', warning: '#A14A0B', info: '#1C1917' }[type] || '#1C1917';
  const el = document.createElement('div');
  el.id = 'smmd-toast'; el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.style.cssText = `position:fixed;left:50%;transform:translateX(-50%);z-index:999;max-width:92vw;width:max-content;padding:14px 18px;color:#fff;background:${c};box-shadow:0 10px 30px rgba(0,0,0,.25);text-align:center`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, type === 'error' ? 6000 : 3500);
}
function showConfirm(message, onConfirm, label = 'Confirmer', danger = false) {
  ouvrirFeuille(`
    <p style="font-size:17px;font-weight:600;margin:4px 0 18px">${escapeHtml(message)}</p>
    <div class="grid2">
      <button class="btn quiet" onclick="fermerFeuille()">Annuler</button>
      <button class="btn ${danger ? '' : ''}" id="cf-ok" style="${danger ? 'background:#B42318;border-color:#B42318' : ''}">${escapeHtml(label)}</button>
    </div>`, { titre: '' });
  document.getElementById('cf-ok').onclick = () => { fermerFeuille(); onConfirm(); };
}

// ─────────────────────────────────────────────── Feuilles (modales)
let _feuilleRetour = null;
function ouvrirFeuille(html, { titre = '', large = false } = {}) {
  _feuilleRetour = document.activeElement;
  const root = document.getElementById('sheet-root');
  root.innerHTML = `<div class="sheet-back" onclick="if(event.target===this)fermerFeuille()">
    <div class="sheet" role="dialog" aria-modal="true" ${titre ? 'aria-labelledby="sheet-t"' : 'aria-label="Fenêtre"'} ${large ? 'style="max-width:720px"' : ''}>
      <div class="sheet-grip"></div>
      ${titre ? `<div class="sheet-head"><h2 id="sheet-t">${escapeHtml(titre)}</h2><button class="iconbtn" onclick="fermerFeuille()" aria-label="Fermer">${svg(IC.close, 22)}</button></div>` : ''}
      <div id="sheet-body">${html}</div>
    </div></div>`;
  document.body.style.overflow = 'hidden';
  setTimeout(() => root.querySelector('input:not([type=hidden]), button')?.focus(), 50);
}
function fermerFeuille() {
  document.getElementById('sheet-root').innerHTML = '';
  document.body.style.overflow = '';
  _saisie = null;
  if (_feuilleRetour && _feuilleRetour.focus) _feuilleRetour.focus();
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('sheet-root').innerHTML) fermerFeuille(); });

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
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { location.href = '../index.html'; return; }
  const { data: profile } = await sb.from('profiles').select('*, maisons(nom)').eq('id', user.id).maybeSingle();
  if (!profile) { location.href = '../index.html'; return; }
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

  const { data: m } = await sb.from('motifs').select('nom').order('nom');
  motifs = m || [];

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
  } catch (e) { showToast('Impossible de charger vos données — vérifiez la connexion', 'error'); return; }
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
      <p class="bold">${escapeHtml(n.type === 'remboursement' ? 'Virement reçu' : 'Information')}</p><p class="small muted">${escapeHtml(n.message)}</p>
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

function repartition(deps, total) {
  const parMotif = {};
  deps.forEach(t => { const k = t.motif || 'autre'; (parMotif[k] = parMotif[k] || { v: 0, n: 0 }); parMotif[k].v += parseFloat(t.montant); parMotif[k].n++; });
  const lignes = Object.entries(parMotif).sort((a, b) => b[1].v - a[1].v);
  return `<div class="stackbar" aria-hidden="true" style="margin:10px 0 4px">${lignes.map(([m, d]) => `<div style="width:${(d.v / total * 100).toFixed(1)}%;background:${couleurMotif(m)}"></div>`).join('')}</div>` +
    lignes.map(([m, d]) => `<div class="part">
      <div class="between"><span class="row" style="gap:10px;font-weight:600"><span class="dot" style="background:${couleurMotif(m)}"></span>${escapeHtml(libMotif(m))}</span><span class="num bold">${eur(d.v)}</span></div>
      <div class="bar" aria-hidden="true"><div style="width:${(d.v / total * 100).toFixed(0)}%;background:${couleurMotif(m)}"></div></div>
      <span class="xs muted num">${(d.v / total * 100).toFixed(0)} % · ${d.n} opération${d.n > 1 ? 's' : ''}</span></div>`).join('');
}

function ligneOp(t, justifSet) {
  _tx[t.id] = t;
  const isIn = t.type === 'recette';
  const c = isIn ? '#1F7A4D' : couleurMotif(t.motif);
  const flags = [];
  if (t.type === 'depense' && t.statut === 'attente') flags.push('<span class="pill warn">À rembourser</span>');
  if (t.type === 'depense' && estPerso(t.methode_paiement) && t.statut === 'valide') flags.push('<span class="pill ok">Remboursé</span>');
  if (t.type === 'depense' && justifSet && !aJustif(t, justifSet)) flags.push('<span class="pill red">Sans justificatif</span>');
  if (t._local) flags.push('<span class="pill neutral">En attente d\'envoi</span>');
  const sous = [isIn ? 'Recette' : (PAIEMENTS[t.methode_paiement] || ''), dateFr(t.created_at), t.commentaire].filter(Boolean).map(escapeHtml).join(' · ');
  return `<button class="op" onclick="${t._local ? '' : `ouvrirDetail('${escapeHtml(t.id)}')`}">
    <span class="op-ico" style="background:${c}1A;color:${c}">${svg(isIn ? IC.plus : IC.file, 18)}</span>
    <span class="op-main"><b>${escapeHtml(isIn ? 'Recette' : libMotif(t.motif))}</b><span>${sous}</span>${flags.length ? `<span class="op-flags">${flags.join('')}</span>` : ''}</span>
    <span class="op-amt ${isIn ? 'in' : ''}">${eurSigne(t)}</span></button>`;
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

// ─────────────────────────────────────────────── DÉTAIL D'UNE OPÉRATION
async function ouvrirDetail(id) {
  let t = _tx[id];
  if (!t) { const { data } = await sb.from('transactions').select('*').eq('id', id).maybeSingle(); if (!data) return showToast('Opération introuvable', 'error'); t = _tx[id] = data; }
  const isIn = t.type === 'recette';
  const rembourse = t.type === 'depense' && estPerso(t.methode_paiement) && t.statut === 'valide';
  ouvrirFeuille(`
    <div style="text-align:center;margin:4px 0 16px">
      <p class="num" style="font-size:36px;font-weight:800;margin:0;color:${isIn ? 'var(--ok)' : 'var(--ink)'}">${eurSigne(t)}</p>
      <p class="muted" style="margin:2px 0 0">${escapeHtml(isIn ? 'Recette' : libMotif(t.motif))} · ${jourFr(t.created_at)}</p>
    </div>
    <div class="card" style="margin-bottom:12px">
      ${!isIn ? `<div class="between" style="padding:6px 0"><span class="muted">Paiement</span><b>${escapeHtml(PAIEMENTS[t.methode_paiement] || '—')}</b></div>` : ''}
      ${!isIn ? `<div class="between" style="padding:6px 0"><span class="muted">Statut</span>${t.statut === 'attente' ? '<span class="pill warn">À rembourser</span>' : rembourse ? '<span class="pill ok">Remboursé</span>' : '<span class="pill ok">Validé</span>'}</div>` : ''}
      ${t.commentaire ? `<div style="padding:6px 0"><span class="muted">Commentaire</span><p style="margin:2px 0 0">${escapeHtml(t.commentaire)}</p></div>` : ''}
    </div>
    ${!isIn ? `<div class="card" style="margin-bottom:12px"><div class="card-head"><h2>Justificatif</h2></div><div id="d-justif"><div class="spin"></div></div></div>` : ''}
    <div class="grid2">
      <button class="btn ghost" onclick="modifierOperation('${escapeHtml(t.id)}')">${svg(IC.pen, 18)}Modifier</button>
      <button class="btn danger" onclick="supprimerOperation('${escapeHtml(t.id)}')">Supprimer</button>
    </div>`, { titre: 'Détail de l\'opération' });
  if (!isIn) {
    const imgs = await chargerImagesJustificatif(t.id);
    const box = document.getElementById('d-justif'); if (!box) return;
    if (imgs.length) {
      window._imgsDetail = imgs;
      box.innerHTML = `<div class="thumbs" style="margin-bottom:12px">${imgs.map((im, i) => {
        const mime = detectMimeType(im.base64, im.mime_type);
        const src = im.base64.startsWith('data:') ? im.base64 : `data:${mime};base64,${im.base64}`;
        return `<button class="thumb" onclick="voirImage(${i})" aria-label="Voir la page ${i + 1}">${mime.includes('pdf') ? '<b>PDF</b>' : `<img src="${escapeHtml(src)}" alt="">`}</button>`;
      }).join('')}</div>
      <button class="btn quiet block" onclick="ajouterJustifA('${escapeHtml(t.id)}')">${svg(IC.cam, 18)}Remplacer les photos</button>`;
    } else if (t.justificatif_url) {
      box.innerHTML = `<a class="btn quiet block" href="${escapeHtml(t.justificatif_url)}" target="_blank" rel="noopener">Ouvrir l'ancien justificatif</a>`;
    } else {
      box.innerHTML = `<p class="red bold" style="margin:0 0 10px">Aucun justificatif</p><button class="btn block" onclick="ajouterJustifA('${escapeHtml(t.id)}')">${svg(IC.cam, 18)}Ajouter une photo</button>`;
    }
  }
}
function voirImage(i) {
  const im = window._imgsDetail[i];
  const mime = detectMimeType(im.base64, im.mime_type);
  if (mime.includes('pdf')) return telechargerJustificatif(im);
  const src = im.base64.startsWith('data:') ? im.base64 : `data:${mime};base64,${im.base64}`;
  const n = window._imgsDetail.length;
  ouvrirFeuille(`<img class="viewer-img" src="${escapeHtml(src)}" alt="Justificatif page ${i + 1}">
    <div class="between" style="margin-top:12px">
      <button class="btn quiet" ${i === 0 ? 'disabled' : ''} onclick="voirImage(${i - 1})" aria-label="Page précédente">‹</button>
      <span class="muted">${i + 1} / ${n}</span>
      <button class="btn quiet" ${i === n - 1 ? 'disabled' : ''} onclick="voirImage(${i + 1})" aria-label="Page suivante">›</button>
    </div>
    <button class="btn ghost block" style="margin-top:10px" onclick="telechargerJustificatif(window._imgsDetail[${i}])">Télécharger</button>`, { titre: 'Justificatif', large: true });
}
function supprimerOperation(id) {
  const t = _tx[id];
  const rembourse = t && t.type === 'depense' && estPerso(t.methode_paiement) && t.statut === 'valide';
  showConfirm(rembourse ? 'Cette dépense a déjà été remboursée par la maison. La supprimer quand même ?' : 'Supprimer cette opération ?', async () => {
    const { error } = await sb.from('transactions').delete().eq('id', id).eq('user_id', userProfile.id);
    if (error) return showToast('Erreur : ' + error.message, 'error');
    delete _tx[id];
    showToast('Opération supprimée', 'info');
    rafraichirVue();
  }, 'Supprimer', true);
}

// ─────────────────────────────────────────────── SAISIE (manuelle, scan IA, modification)
let _saisie = null;   // { mode, id, type, montant, motif, methode, date, commentaire, photos:[File|dataURL], confiance }
function ouvrirChoixSaisie() {
  ouvrirFeuille(`<div class="grid2">
      <button class="btn big" onclick="fermerFeuille();ouvrirScan()">${svg(IC.cam, 26)}Scanner un ticket</button>
      <button class="btn big ghost" onclick="fermerFeuille();ouvrirSaisie()">${svg(IC.pen, 26)}Saisir à la main</button>
    </div>
    <button class="btn quiet block" style="margin-top:10px" onclick="fermerFeuille();ouvrirSaisie({type:'recette'})">${svg(IC.plus, 18)}Enregistrer une recette</button>`, { titre: 'Nouvelle opération' });
}
function ouvrirScan() {
  if (!navigator.onLine) { showToast('Hors connexion : le scan par l\'IA attendra. Saisissez à la main, la photo sera gardée.', 'warning'); }
  const inp = document.getElementById('scan-input'); inp.value = ''; inp.click();
}
async function scanFichier(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!navigator.onLine) return ouvrirSaisie({ photos: [file] });
  ouvrirFeuille(`<div style="text-align:center;padding:30px 0"><div class="spin" style="margin:0 auto 14px;width:36px;height:36px"></div>
    <p class="bold" style="margin:0">L'IA lit votre ticket…</p><p class="small muted">Montant, date et description</p></div>`, { titre: 'Scan du ticket' });
  try {
    const r = await scanJustificatif(file);
    ouvrirSaisie({ photos: [file], montant: r.montant ?? '', date: r.date || null, commentaire: r.commentaire || '', confiance: r.confiance || 'basse', depuisScan: true });
  } catch (e) {
    ouvrirSaisie({ photos: [file], erreurScan: e.message || 'Lecture impossible' });
  }
}
function ouvrirSaisie(init = {}) {
  const recents = JSON.parse(localStorage.getItem('smmd_motifs_recents') || '[]');
  const motifDefaut = init.motif || recents[0] || motifs[0]?.nom || '';
  _saisie = {
    mode: init.mode || 'ajout', id: init.id || null, ancien: init.ancien || null,
    type: init.type || 'depense', montant: init.montant ?? '', motif: motifDefaut,
    methode: init.methode || localStorage.getItem('smmd_methode') || 'cb_maison',
    date: init.date || isoVersDateSaisie(new Date().toISOString()), commentaire: init.commentaire || '',
    photos: init.photos || [], confiance: init.confiance, depuisScan: init.depuisScan, erreurScan: init.erreurScan
  };
  const tri = [...motifs].sort((a, b) => { const ia = recents.indexOf(a.nom), ib = recents.indexOf(b.nom); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.nom.localeCompare(b.nom); });
  const conf = { haute: ['ok', 'L\'IA est sûre d\'elle'], moyenne: ['warn', 'Vérifiez le montant et la date'], basse: ['red', 'Lecture incertaine : vérifiez tout'] }[_saisie.confiance];
  const titre = _saisie.mode === 'modif' ? 'Modifier l\'opération' : (_saisie.type === 'recette' ? 'Nouvelle recette' : 'Nouvelle dépense');
  ouvrirFeuille(`
    <div class="stack" style="gap:14px">
      ${_saisie.depuisScan && conf ? `<div class="banner ${conf[0] === 'red' ? 'warn' : conf[0]}">${svg(IC.check, 18)}<span>Ticket lu par l'IA — ${conf[1]}</span></div>` : ''}
      ${_saisie.erreurScan ? `<div class="banner warn">${svg(IC.alert, 18)}<span>L'IA n'a pas pu lire le ticket. Complétez à la main, la photo est gardée.</span></div>` : ''}
      ${!navigator.onLine ? `<div class="banner warn">${svg(IC.cloud, 18)}<span>Hors connexion : enregistrée sur le téléphone, envoyée au retour du réseau</span></div>` : ''}
      ${_saisie.mode === 'ajout' ? `<div class="seg" role="group" aria-label="Type d'opération">
        <button aria-pressed="${_saisie.type === 'depense'}" onclick="saisieType('depense')">Dépense</button>
        <button aria-pressed="${_saisie.type === 'recette'}" onclick="saisieType('recette')">Recette</button></div>` : ''}
      <label class="field"><span>Montant (€)</span>
        <input id="s-montant" class="input amount-input num" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${escapeHtml(String(_saisie.montant).replace('.', ','))}"></label>
      <div id="s-zone-dep" class="stack ${_saisie.type === 'recette' ? 'hidden' : ''}" style="gap:14px">
        <div class="field"><span>Motif</span>
          <div class="chips" style="flex-wrap:wrap" role="group" aria-label="Motif">${tri.map(m => `<button class="chip" aria-pressed="${m.nom === _saisie.motif}" data-m="${escapeHtml(m.nom)}" onclick="saisieMotif(this)">${escapeHtml(libMotif(m.nom))}</button>`).join('')}</div></div>
        <div class="field"><span>Payé avec</span>
          <div class="seg" role="group" aria-label="Moyen de paiement">${Object.entries(PAIEMENTS).map(([k, l]) => `<button aria-pressed="${k === _saisie.methode}" data-k="${k}" onclick="saisieMethode(this)">${l}</button>`).join('')}</div>
          <p id="s-remb" class="small warn bold ${estPerso(_saisie.methode) ? '' : 'hidden'}" style="margin:2px 0 0">La maison vous remboursera cette dépense</p></div>
      </div>
      <div class="grid2">
        <label class="field"><span>Date</span><input id="s-date" class="input" type="date" value="${escapeHtml(_saisie.date)}"></label>
        <div class="field"><span>Justificatif</span><button class="btn quiet" onclick="document.getElementById('photo-input').click()">${svg(IC.cam, 18)}Photo</button></div>
      </div>
      <div id="s-photos" class="thumbs ${_saisie.photos.length ? '' : 'hidden'}"></div>
      <label class="field"><span>Commentaire (facultatif)</span><input id="s-com" class="input" maxlength="200" value="${escapeHtml(_saisie.commentaire)}" placeholder="Ex. : courses de la semaine"></label>
      <button id="s-ok" class="btn block" style="min-height:56px" onclick="enregistrerSaisie()">${svg(IC.check, 20)}Enregistrer</button>
      ${_saisie.mode === 'modif' && _saisie.ancien && estPerso(_saisie.ancien.methode_paiement) && _saisie.ancien.statut === 'valide' ? '<p class="small muted" style="margin:0;text-align:center">Déjà remboursée : elle restera « remboursée » après modification.</p>' : ''}
    </div>`, { titre });
  afficherPhotos();
  if (!_saisie.montant) setTimeout(() => document.getElementById('s-montant')?.focus(), 80);
}
function saisieType(t) {
  _saisie.type = t;
  document.querySelectorAll('#sheet-body .seg')[0].querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', (i === 0) === (t === 'depense')));
  document.getElementById('s-zone-dep').classList.toggle('hidden', t === 'recette');
  document.getElementById('sheet-t').textContent = t === 'recette' ? 'Nouvelle recette' : 'Nouvelle dépense';
}
function saisieMotif(btn) {
  _saisie.motif = btn.dataset.m;
  btn.parentElement.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c === btn));
}
function saisieMethode(btn) {
  _saisie.methode = btn.dataset.k;
  btn.parentElement.querySelectorAll('button').forEach(c => c.setAttribute('aria-pressed', c === btn));
  document.getElementById('s-remb').classList.toggle('hidden', !estPerso(_saisie.methode));
}
function ajouterPhotos(input) {
  const files = Array.from(input.files || []);
  input.value = '';
  if (!files.length) return;
  if (_justifCible) { const id = _justifCible; _justifCible = null; return enregistrerJustif(id, files); }
  if (!_saisie) return;
  _saisie.photos.push(...files);
  afficherPhotos();
}
function afficherPhotos() {
  const box = document.getElementById('s-photos'); if (!box || !_saisie) return;
  box.classList.toggle('hidden', !_saisie.photos.length);
  box.innerHTML = _saisie.photos.map((f, i) => {
    const isPdf = typeof f === 'string' ? f.startsWith('data:application/pdf') : f.type === 'application/pdf';
    const src = typeof f === 'string' ? f : (isPdf ? '' : URL.createObjectURL(f));
    return `<div class="thumb">${isPdf ? '<b>PDF</b>' : `<img src="${escapeHtml(src)}" alt="Photo ${i + 1}">`}<button onclick="retirerPhoto(${i})" aria-label="Retirer la photo ${i + 1}">×</button></div>`;
  }).join('');
}
function retirerPhoto(i) { _saisie.photos.splice(i, 1); afficherPhotos(); }

async function enregistrerSaisie() {
  const s = _saisie; if (!s) return;
  const montant = parseFloat(String(document.getElementById('s-montant').value).replace(/\s/g, '').replace(',', '.'));
  const date = document.getElementById('s-date').value;
  const commentaire = document.getElementById('s-com').value.trim();
  if (!(montant > 0)) { showToast('Saisissez un montant supérieur à 0', 'error'); document.getElementById('s-montant').focus(); return; }
  if (montant > 100000) { showToast('Montant trop élevé : vérifiez la saisie', 'error'); return; }
  if (!date) { showToast('Choisissez une date', 'error'); return; }
  if (s.type === 'depense' && !s.motif) { showToast('Choisissez un motif', 'error'); return; }
  const btn = document.getElementById('s-ok'); btn.disabled = true; btn.innerHTML = '<span class="spin" style="width:18px;height:18px;border-width:2px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>Enregistrement…';
  const isDep = s.type === 'depense';
  const payload = {
    montant, created_at: dateSaisieVersISO(date), commentaire: commentaire || null,
    motif: isDep ? s.motif : 'RECETTE', type: s.type,
    methode_paiement: isDep ? s.methode : null
  };
  if (isDep) {
    try {
      localStorage.setItem('smmd_methode', s.methode);
      const rec = JSON.parse(localStorage.getItem('smmd_motifs_recents') || '[]').filter(x => x !== s.motif);
      localStorage.setItem('smmd_motifs_recents', JSON.stringify([s.motif, ...rec].slice(0, 6)));
    } catch (e) {}
  }
  try {
    if (s.mode === 'modif') {
      payload.statut = statutApresEdition(s.ancien, s.type, payload.methode_paiement);
      if (!isDep) delete payload.motif;
      const { error } = await sb.from('transactions').update(payload).eq('id', s.id).eq('user_id', userProfile.id);
      if (error) throw error;
      if (s.photos.length) await sauvegarderImagesJustificatif(s.id, s.photos);
      fermerFeuille(); showToast('Opération modifiée', 'success'); rafraichirVue();
      return;
    }
    payload.user_id = userProfile.id; payload.maison_id = userProfile.maison_id;
    payload.statut = isDep && estPerso(s.methode) ? 'attente' : 'valide';
    payload.justificatif_url = null;
    if (!navigator.onLine) throw new TypeError('Failed to fetch');
    const { data, error } = await sb.from('transactions').insert([payload]).select('id');
    if (error) throw error;
    let msg = 'Enregistré !', type = 'success';
    if (s.photos.length) {
      try { await sauvegarderImagesJustificatif(data[0].id, s.photos); }
      catch (e) { msg = 'Enregistré, mais la photo n\'a pas pu être envoyée — ajoutez-la depuis le relevé'; type = 'warning'; }
    } else if (isDep) { msg = 'Enregistré — pensez à ajouter le justificatif'; type = 'warning'; }
    fermerFeuille(); showToast(msg, type);
    if (navigator.vibrate) navigator.vibrate(15);
    rafraichirVue();
  } catch (e) {
    const reseau = !navigator.onLine || e instanceof TypeError || /fetch|network|réseau/i.test(e.message || '');
    if (reseau && s.mode === 'ajout') {
      await mettreEnFile(payload, s.photos);
      fermerFeuille(); showToast('Hors connexion : gardé sur le téléphone, envoi automatique au retour du réseau', 'warning');
      rafraichirVue();
    } else {
      btn.disabled = false; btn.innerHTML = svg(IC.check, 20) + 'Enregistrer';
      showToast('Erreur : ' + (e.message || 'enregistrement impossible'), 'error');
    }
  }
}
function modifierOperation(id) {
  const t = _tx[id]; if (!t) return;
  ouvrirSaisie({ mode: 'modif', id, ancien: t, type: t.type, montant: parseFloat(t.montant), motif: t.type === 'depense' ? t.motif : null,
    methode: t.methode_paiement || 'cb_maison', date: isoVersDateSaisie(t.created_at), commentaire: t.commentaire || '' });
}
let _justifCible = null;
function ajouterJustifA(id) { _justifCible = id; const inp = document.getElementById('photo-input'); inp.value = ''; inp.click(); }
async function enregistrerJustif(id, files) {
  showToast('Envoi du justificatif…', 'info');
  try { await sauvegarderImagesJustificatif(id, files); showToast('Justificatif enregistré', 'success'); fermerFeuille(); rafraichirVue(); }
  catch (e) { showToast(e.message || 'Envoi impossible', 'error'); }
}

// ─────────────────────────────────────────────── FILE D'ATTENTE HORS LIGNE
const cleFile = () => 'smmd_file_attente_' + (userProfile?.id || '');
function fileAttente() { try { return JSON.parse(localStorage.getItem(cleFile()) || '[]'); } catch (e) { return []; } }
function ecrireFile(f) { localStorage.setItem(cleFile(), JSON.stringify(f)); }
async function mettreEnFile(payload, photos) {
  const imgs = [];
  for (const p of photos) { try { imgs.push(typeof p === 'string' ? p : await resizeImageToBase64(p)); } catch (e) {} }
  const f = fileAttente();
  const item = { id: 'local-' + Date.now(), payload, photos: imgs };
  f.push(item);
  try { ecrireFile(f); }
  catch (e) {   // mémoire du téléphone pleine : on garde l'opération sans les photos
    item.photos = []; ecrireFile(f);
    showToast('Photo trop lourde pour être gardée hors ligne : ajoutez-la plus tard', 'warning');
  }
  majBandeauSync();
}
let _syncEnCours = false;
async function synchroniserFile() {
  if (_syncEnCours || !navigator.onLine || !userProfile) { majBandeauSync(); return; }
  _syncEnCours = true;
  let f = fileAttente(), envoyes = 0;
  for (const it of [...f]) {
    try {
      const { data, error } = await sb.from('transactions').insert([it.payload]).select('id');
      if (error) throw error;
      if (it.photos.length) { try { await sauvegarderImagesJustificatif(data[0].id, it.photos); } catch (e) {} }
      f = f.filter(x => x.id !== it.id); ecrireFile(f); envoyes++;
    } catch (e) { break; }
  }
  _syncEnCours = false;
  if (envoyes) showToast(`${envoyes} saisie${envoyes > 1 ? 's' : ''} hors ligne envoyée${envoyes > 1 ? 's' : ''}`, 'success');
  majBandeauSync();
}
function majBandeauSync() {
  const n = fileAttente().length, b = document.getElementById('sync-banner');
  if (!b) return;
  b.className = n ? 'banner warn' : 'hidden';
  b.innerHTML = n ? `${svg(IC.cloud, 18)}<span>${n} saisie${n > 1 ? 's' : ''} en attente d'envoi${navigator.onLine ? '' : ' (hors connexion)'}</span>${navigator.onLine ? '<button class="link" style="margin-left:auto" onclick="synchroniserFile().then(rafraichirVue)">Envoyer</button>' : ''}` : '';
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
async function mettreAJour() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.update();
    const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k)));
  } catch (e) {}
  showToast('Rechargement…', 'info'); setTimeout(() => location.reload(), 600);
}
function deconnexion() { sb.auth.signOut().then(() => location.href = '../index.html'); }

// ─────────────────────────────────────────────── Notifications, messagerie, inactivité
function ecouterNotifications() {
  sb.channel('notifs-v2-' + userProfile.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userProfile.id}` },
      p => { showToast(p.new.message || 'Nouvelle notification', 'success'); if (_vue === 'accueil') chargerAccueil(); })
    .subscribe();
}
async function compterMessages() {
  try {
    const { data: convs } = await sb.from('conversations').select('id').or(`user1_id.eq.${userProfile.id},user2_id.eq.${userProfile.id}`);
    const b = document.getElementById('msg-badge');
    if (!convs?.length) { b.classList.add('hidden'); return; }
    const { count } = await sb.from('messages').select('id', { count: 'exact', head: true })
      .in('conversation_id', convs.map(c => c.id)).eq('lu', false).neq('sender_id', userProfile.id).is('deleted_at', null);
    b.textContent = count > 9 ? '9+' : count; b.classList.toggle('hidden', !count);
  } catch (e) {}
}
function ouvrirMessagerie() { localStorage.setItem('smmd_chat_from', 'v2/membre.html'); location.href = '../chat.html'; }
let _inactif;
function resetInactif() { clearTimeout(_inactif); _inactif = setTimeout(() => { showToast('Déconnexion après 30 min d\'inactivité', 'warning'); setTimeout(deconnexion, 2000); }, 30 * 60 * 1000); }
['touchstart', 'click', 'keydown', 'scroll'].forEach(ev => document.addEventListener(ev, resetInactif, { passive: true }));
resetInactif();

init().catch(e => { console.error(e); showToast('Erreur au démarrage : ' + e.message, 'error'); });
