// ═══════════════════════════════════════════════════════════
// SMMD v2 — Comptabilité : paramètres et export FEC (admin)
// ═══════════════════════════════════════════════════════════
const COMPTA_DEFAUT = {
  siren: '',
  raison_sociale: 'SMMD',
  comptes: {
    banque:      { num: '512000', lib: 'Banque' },
    avances:     { num: '467000', lib: 'Avances des membres' },
    recettes:    { num: '758000', lib: 'Produits divers de gestion courante' },
    allocations: { num: '756000', lib: 'Contributions des membres' },
    defaut:      { num: '606800', lib: 'Autres matières et fournitures' }
  },
  motifs: {
    alimentaire: { num: '606800', lib: 'Alimentation' },
    transport:   { num: '625100', lib: 'Voyages et déplacements' },
    entretien:   { num: '615000', lib: 'Entretien et réparations' },
    pastorale:   { num: '618000', lib: 'Frais de pastorale' },
    sante:       { num: '647500', lib: 'Frais de santé' },
    vetements:   { num: '606800', lib: 'Vêtements' },
    loisirs:     { num: '625700', lib: 'Réceptions et loisirs' },
    formation:   { num: '618500', lib: 'Formation' },
    bureau:      { num: '606400', lib: 'Fournitures de bureau' },
    telephone:   { num: '626000', lib: 'Frais postaux et télécommunications' },
    electricite: { num: '606100', lib: 'Fournitures non stockables (énergie)' },
    eau:         { num: '606100', lib: 'Fournitures non stockables (eau)' },
    repas:       { num: '625600', lib: 'Missions et repas' },
    sortie:      { num: '625700', lib: 'Réceptions et sorties' }
  }
};
let compta = JSON.parse(JSON.stringify(COMPTA_DEFAUT));
const nomsMotifs = {};
const cleMotif = m => String(m || 'autre').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

async function chargerCompta() {
  const { data, error } = await sb.from('parametres').select('valeur').eq('cle', 'compta').maybeSingle();
  if (error && error.message.includes('parametres')) showToast('Table « parametres » absente : exécutez le script SQL « parametres_compta »', 'warning');
  const v = data?.valeur || {};
  compta = { ...JSON.parse(JSON.stringify(COMPTA_DEFAUT)), ...v, comptes: { ...COMPTA_DEFAUT.comptes, ...(v.comptes || {}) }, motifs: { ...COMPTA_DEFAUT.motifs, ...(v.motifs || {}) } };
  const { data: mot } = await sb.from('motifs').select('nom').order('nom');
  (mot || []).forEach(m => { const k = cleMotif(m.nom); nomsMotifs[k] = m.nom; if (!compta.motifs[k]) compta.motifs[k] = { ...compta.comptes.defaut, lib: libMotif(m.nom) }; });
  afficherCompta();
}
function ligneCompte(groupe, k, libelle, c) {
  return `<tr><td>${escapeHtml(libelle)}</td>
    <td><input class="input num" style="min-height:40px;max-width:130px" inputmode="numeric" maxlength="10" data-g="${groupe}" data-k="${escapeHtml(k)}" data-f="num" value="${escapeHtml(c.num)}" aria-label="Numéro de compte pour ${escapeHtml(libelle)}"></td>
    <td><input class="input" style="min-height:40px" maxlength="60" data-g="${groupe}" data-k="${escapeHtml(k)}" data-f="lib" value="${escapeHtml(c.lib)}" aria-label="Intitulé du compte pour ${escapeHtml(libelle)}"></td></tr>`;
}
function initCompta() {
  const sel = document.getElementById('cp-annee');
  if (!sel.options.length) { const y = new Date().getFullYear(); for (let a = y; a >= 2024; a--) sel.add(new Option(a, a)); }
  chargerCompta();
}
function afficherCompta() {
  document.getElementById('cp-siren').value = compta.siren || '';
  document.getElementById('cp-raison').value = compta.raison_sociale || '';
  const G = { banque: 'Banque (CB maison, virements)', avances: 'Avances des membres (carte perso, espèces)', recettes: 'Recettes', allocations: 'Allocations des membres', defaut: 'Motif sans correspondance' };
  document.getElementById('cp-comptes').innerHTML = `<table class="tbl"><thead><tr><th scope="col">Usage</th><th scope="col">Compte</th><th scope="col">Intitulé</th></tr></thead><tbody>
    ${Object.entries(G).map(([k, l]) => ligneCompte('comptes', k, l, compta.comptes[k])).join('')}
    <tr><td colspan="3" class="bold" style="background:var(--surf-2)">Motifs de dépense</td></tr>
    ${Object.entries(compta.motifs).sort((a, b) => a[0].localeCompare(b[0])).map(([k, c]) => ligneCompte('motifs', k, libMotif(nomsMotifs[k] || k), c)).join('')}
  </tbody></table>`;
}
async function enregistrerCompta() {
  const siren = document.getElementById('cp-siren').value.replace(/\s/g, '');
  if (siren && !/^\d{9}$/.test(siren)) return showToast('Le SIREN compte 9 chiffres', 'error');
  compta.siren = siren;
  compta.raison_sociale = document.getElementById('cp-raison').value.trim() || 'SMMD';
  for (const inp of document.querySelectorAll('#cp-comptes input')) {
    const { g, k, f } = inp.dataset, v = inp.value.trim();
    if (f === 'num' && !/^\d{3,10}$/.test(v)) { inp.focus(); return showToast('Numéro de compte invalide (chiffres uniquement)', 'error'); }
    compta[g][k] = { ...compta[g][k], [f]: v };
  }
  const { error } = await sb.from('parametres').upsert({ cle: 'compta', valeur: compta, updated_at: new Date().toISOString(), updated_by: userProfile.id });
  if (error) return showToast('Erreur : ' + error.message, 'error');
  showToast('Paramètres comptables enregistrés', 'success');
}
function reinitialiserCompta() {
  showConfirm('Revenir au plan de comptes proposé par défaut ? (Le SIREN est conservé.)', () => {
    const siren = compta.siren, rs = compta.raison_sociale;
    compta = JSON.parse(JSON.stringify(COMPTA_DEFAUT)); compta.siren = siren; compta.raison_sociale = rs;
    afficherCompta(); showToast('Plan par défaut rétabli — pensez à enregistrer', 'info');
  }, 'Rétablir');
}

// ── Encodage ISO-8859-15 (jeu de caractères accepté par l'administration fiscale)
function iso885915(txt) {
  const SP = { '€': 0xA4, 'Š': 0xA6, 'š': 0xA8, 'Ž': 0xB4, 'ž': 0xB8, 'Œ': 0xBC, 'œ': 0xBD, 'Ÿ': 0xBE };
  const out = new Uint8Array(txt.length);
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i], c = txt.charCodeAt(i);
    out[i] = SP[ch] !== undefined ? SP[ch] : (c < 256 && ![0xA4, 0xA6, 0xA8, 0xB4, 0xB8, 0xBC, 0xBD, 0xBE].includes(c) ? c : 0x3F);
  }
  return out;
}
const fecDate = iso => { const d = new Date(iso); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
const fecMt = v => v ? Number(v).toFixed(2).replace('.', ',') : '0,00';
const fecTxt = (s, max = 99) => String(s || '').replace(/[\t\r\n|]+/g, ' ').trim().slice(0, max);

// Écritures en partie double à partir des opérations et allocations de l'exercice
function construireEcritures(txs, allocs, nomM, nomMai, debut, fin) {
  const C = compta.comptes, lignes = [], num = { AC: 0, BQ: 0 };
  let lettre = 0;
  const lettreSuivante = () => { let n = lettre++, s = ''; do { s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
  const aux = uid => uid ? ['M' + String(uid).replace(/-/g, '').slice(0, 8).toUpperCase(), fecTxt(nomM(uid), 60)] : ['MSUPPR', 'Membre supprimé'];
  const ecr = (journal, date, piece, lib, mouvements) => {
    const n = ++num[journal];
    mouvements.forEach(m => lignes.push({ journal, num: `${journal}${String(n).padStart(6, '0')}`, date, piece, lib, ...m }));
  };
  for (const t of txs) {
    const d = t.created_at, piece = String(t.id).slice(0, 8).toUpperCase(), maison = nomMai(t.maison_id);
    const m = Number(t.montant);
    if (t.type === 'recette') {
      ecr('BQ', d, piece, `${maison} - Recette ${t.commentaire || ''}`, [
        { compte: C.banque, debit: m }, { compte: C.recettes, credit: m }]);
      continue;
    }
    const cpt = compta.motifs[cleMotif(t.motif)] || C.defaut;
    const lib = `${maison} - ${libMotif(t.motif)}${t.commentaire ? ' - ' + t.commentaire : ''} - ${nomM(t.user_id)}`;
    if (!estPerso(t.methode_paiement)) {
      ecr('BQ', d, piece, lib, [{ compte: cpt, debit: m }, { compte: C.banque, credit: m }]);
      continue;
    }
    // Avance d'un membre : charge contre le compte du membre, puis remboursement par la banque
    const [auxNum, auxLib] = aux(t.user_id);
    const rembourse = t.statut === 'valide' && t.date_validation && t.date_validation >= debut && t.date_validation < fin;
    const l = rembourse ? lettreSuivante() : '';
    ecr('AC', d, piece, lib, [{ compte: cpt, debit: m }, { compte: C.avances, auxNum, auxLib, credit: m, let: l, dateLet: rembourse ? t.date_validation : null }]);
    if (rembourse) ecr('BQ', t.date_validation, piece, `${maison} - Remboursement avance - ${nomM(t.user_id)}`, [
      { compte: C.avances, auxNum, auxLib, debit: m, let: l, dateLet: t.date_validation }, { compte: C.banque, credit: m }]);
  }
  for (const a of allocs) {
    const d = new Date(a.annee, a.mois - 1, 1, 12).toISOString(); // rattachée au mois de l'allocation
    const m = Number(a.montant);
    ecr('BQ', d, 'AL' + String(a.id).slice(0, 6).toUpperCase(), `${nomMai(a.maison_id)} - Allocation ${MOIS[a.mois - 1]} ${a.annee} - ${nomM(a.user_id)}`, [
      { compte: C.banque, debit: m }, { compte: C.allocations, credit: m }]);
  }
  return lignes.sort((x, y) => x.date.localeCompare(y.date) || x.num.localeCompare(y.num));
}

async function exporterFEC() {
  const annee = +document.getElementById('cp-annee').value;
  if (!/^\d{9}$/.test(compta.siren || '')) { showToast('Renseignez et enregistrez d\'abord le SIREN', 'warning'); return document.getElementById('cp-siren').focus(); }
  const { debut, fin } = bornesAnnee(annee);
  showToast('Préparation du FEC…', 'info');
  try {
    const [txs, allocs] = await Promise.all([
      fetchAll(() => sb.from('transactions').select('id,user_id,maison_id,type,montant,statut,motif,commentaire,created_at,methode_paiement,date_validation').gte('created_at', debut).lt('created_at', fin).order('created_at')),
      fetchAll(() => sb.from('allocations_versees').select('*').eq('annee', annee).order('id'))
    ]);
    // Avances d'années précédentes remboursées pendant l'exercice : seul le remboursement est à passer
    const anciennes = await fetchAll(() => sb.from('transactions').select('id,user_id,maison_id,type,montant,statut,motif,commentaire,created_at,methode_paiement,date_validation')
      .lt('created_at', debut).eq('type', 'depense').eq('statut', 'valide').gte('date_validation', debut).lt('date_validation', fin).order('date_validation'));
    const nomM = id => id ? nomMembre(comptes.find(c => c.id === id)) : 'Membre supprimé';
    const nomMai = id => maisons.find(m => m.id === id)?.nom || 'Sans maison';
    const conf = allocs.filter(allocConfirmee);
    const lignes = construireEcritures(txs, conf, nomM, nomMai, debut, fin);
    // Remboursements d'avances antérieures
    const C = compta.comptes; let n = lignes.filter(l => l.journal === 'BQ').map(l => +l.num.slice(2)).reduce((a, b) => Math.max(a, b), 0);
    anciennes.filter(t => estPerso(t.methode_paiement)).forEach(t => {
      n++; const auxNum = t.user_id ? 'M' + String(t.user_id).replace(/-/g, '').slice(0, 8).toUpperCase() : 'MSUPPR', auxLib = fecTxt(nomM(t.user_id), 60), m = Number(t.montant);
      const base = { journal: 'BQ', num: `BQ${String(n).padStart(6, '0')}`, date: t.date_validation, piece: String(t.id).slice(0, 8).toUpperCase(), lib: `${nomMai(t.maison_id)} - Remboursement avance ${new Date(t.created_at).getFullYear()} - ${nomM(t.user_id)}` };
      lignes.push({ ...base, compte: C.avances, auxNum, auxLib, debit: m }, { ...base, compte: C.banque, credit: m });
    });
    lignes.sort((x, y) => x.date.localeCompare(y.date) || x.num.localeCompare(y.num));
    // Numérotation continue et chronologique par journal (exigence du FEC)
    const renum = {}, cpt = { AC: 0, BQ: 0 };
    lignes.forEach(l => { const k = l.num; if (!renum[k]) renum[k] = `${l.journal}${String(++cpt[l.journal]).padStart(6, '0')}`; l.num = renum[k]; });
    if (!lignes.length) return showToast('Aucune écriture sur cet exercice', 'warning');
    const JL = { AC: 'Achats et avances', BQ: 'Banque' };
    const entete = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];
    const rows = lignes.map(l => [l.journal, JL[l.journal], l.num, fecDate(l.date), l.compte.num, fecTxt(l.compte.lib, 60), l.auxNum || '', l.auxLib || '', l.piece, fecDate(l.date),
      fecTxt(l.lib), fecMt(l.debit), fecMt(l.credit), l.let || '', l.dateLet ? fecDate(l.dateLet) : '', fecDate(l.date), '', ''].join('\t'));
    const totD = lignes.reduce((s, l) => s + (l.debit || 0), 0), totC = lignes.reduce((s, l) => s + (l.credit || 0), 0);
    if (Math.abs(totD - totC) > 0.005) return showToast('Écritures déséquilibrées : export annulé', 'error');
    const contenu = [entete.join('\t'), ...rows].join('\r\n') + '\r\n';
    const nom = `${compta.siren}FEC${annee}1231.txt`;
    const url = URL.createObjectURL(new Blob([iso885915(contenu)], { type: 'text/plain;charset=iso-8859-15' }));
    const a = document.createElement('a'); a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast(`FEC ${annee} : ${lignes.length} lignes, ${eur(totD)} au débit et au crédit`, 'success');
  } catch (e) { showToast('Export impossible : ' + e.message, 'error'); }
}
