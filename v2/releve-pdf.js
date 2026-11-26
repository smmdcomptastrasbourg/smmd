// ═══════════════════════════════════════════════════════════
// SMMD v2 — Relevé mensuel PDF par maison (chef et admin)
// ═══════════════════════════════════════════════════════════
function chargerScript(src) {
  return new Promise((ok, ko) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => ko(new Error('Bibliothèque PDF indisponible (connexion ?)'));
    document.head.appendChild(s);
  });
}
async function chargerJsPDF() {
  if (!window.jspdf) await chargerScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  if (!window.jspdf?.jsPDF?.API?.autoTable) await chargerScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
  return window.jspdf.jsPDF;
}
// jsPDF (polices standard) : remplace les caractères hors WinAnsi
const pdfTxt = s => String(s ?? '').replace(/[−–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/ | /g, ' ').replace(/[^\x00-\xFF€Œœ]/g, '?');
const pdfEur = v => pdfTxt(eur(v));

async function donneesReleve(maisonId, mois, annee) {
  const { debut } = bornesMois(annee, mois), { fin } = bornesMois(annee, mois);
  const sel = 'id,user_id,type,montant,statut,motif,commentaire,created_at,methode_paiement,date_validation,profiles(prenom,nom)';
  const [txs, allocsMois, allocsTout, txAvant] = await Promise.all([
    fetchAll(() => sb.from('transactions').select(sel).eq('maison_id', maisonId).gte('created_at', debut).lt('created_at', fin).order('created_at')),
    fetchAll(() => sb.from('allocations_versees').select('user_id,montant,statut,mois,annee,profiles(prenom,nom)').eq('maison_id', maisonId).eq('mois', mois).eq('annee', annee)),
    fetchAll(() => sb.from('allocations_versees').select('montant,statut,mois,annee').eq('maison_id', maisonId)),
    fetchAll(() => sb.from('transactions').select('type,montant').eq('maison_id', maisonId).lt('created_at', debut))
  ]);
  const avantAlloc = allocsTout.filter(a => allocConfirmee(a) && (a.annee < annee || (a.annee === annee && a.mois < mois))).reduce((s, a) => s + +a.montant, 0);
  const soldeDebut = avantAlloc + txAvant.reduce((s, t) => s + (t.type === 'recette' ? +t.montant : -t.montant), 0);
  const conf = allocsMois.filter(allocConfirmee);
  const entrees = txs.filter(t => t.type === 'recette').reduce((s, t) => s + +t.montant, 0) + conf.reduce((s, a) => s + +a.montant, 0);
  const sorties = txs.filter(t => t.type === 'depense').reduce((s, t) => s + +t.montant, 0);
  let avecJ = new Set();
  try { avecJ = await idsAvecJustif(txs.map(t => t.id)); } catch (e) { /* facultatif */ }
  return { txs, allocsMois, conf, soldeDebut, entrees, sorties, soldeFin: soldeDebut + entrees - sorties, avecJ };
}

function pageReleve(doc, nomMaison, mois, annee, d) {
  const W = doc.internal.pageSize.getWidth(), BORD = [139, 30, 45];
  doc.setFillColor(...BORD); doc.rect(0, 0, W, 22, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(pdfTxt(`Relevé mensuel - ${nomMaison}`), 14, 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  doc.text(pdfTxt(`${MOIS[mois - 1]} ${annee}`), W - 14, 14, { align: 'right' });
  doc.setTextColor(30);
  // Synthèse
  const k = [['Solde au début du mois', d.soldeDebut], ['Entrées (recettes + allocations confirmées)', d.entrees], ['Sorties (dépenses)', d.sorties], ['Solde à la fin du mois', d.soldeFin]];
  doc.autoTable({ startY: 28, theme: 'plain', styles: { fontSize: 10, cellPadding: 1.6 }, columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    body: k.map(([l, v]) => [pdfTxt(l), pdfEur(v)]), margin: { left: 14, right: W / 2 } });
  const attente = d.txs.filter(t => t.type === 'depense' && t.statut === 'attente');
  let y = doc.lastAutoTable.finalY + 2;
  doc.setFontSize(9); doc.setTextColor(110);
  doc.text(pdfTxt(`${d.txs.length} opération(s) · ${attente.length} avance(s) du mois à rembourser (${eur(attente.reduce((s, t) => s + +t.montant, 0))}) · ${d.txs.filter(t => t.type === 'depense' && !d.avecJ.has(t.id)).length} dépense(s) sans justificatif`), 14, y + 4);
  doc.setTextColor(30);
  // Par motif
  const pm = {}; d.txs.filter(t => t.type === 'depense').forEach(t => { const m = libMotif(t.motif); pm[m] = (pm[m] || 0) + +t.montant; });
  const motifs = Object.entries(pm).sort((a, b) => b[1] - a[1]);
  if (motifs.length) doc.autoTable({ startY: y + 9, head: [['Dépenses par motif', 'Montant', '%']], headStyles: { fillColor: BORD }, styles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } }, margin: { left: 14, right: W / 2 },
    body: motifs.map(([m, v]) => [pdfTxt(m), pdfEur(v), Math.round(v / (d.sorties || 1) * 100) + ' %']) });
  // Allocations
  if (d.allocsMois.length) doc.autoTable({ startY: (motifs.length ? doc.lastAutoTable.finalY : y) + 6, head: [['Allocations du mois', 'Montant', 'État']], headStyles: { fillColor: BORD }, styles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right' } }, margin: { left: 14, right: W / 2 },
    body: d.allocsMois.map(a => [pdfTxt(nomMembre(a.profiles)), pdfEur(a.montant), allocConfirmee(a) ? 'Confirmée' : 'Déclarée (non comptée)'].map(pdfTxt)) });
  // Opérations
  const stat = t => t.type === 'recette' ? '' : !estPerso(t.methode_paiement) ? 'Payé maison' : t.statut === 'valide' ? 'Remboursé' : 'À rembourser';
  doc.autoTable({ startY: doc.lastAutoTable.finalY + 8, head: [['Date', 'Membre', 'Motif', 'Commentaire', 'Paiement', 'Statut', 'Justif.', 'Montant']], headStyles: { fillColor: BORD }, styles: { fontSize: 8, cellPadding: 1.4, overflow: 'linebreak' },
    columnStyles: { 0: { cellWidth: 17 }, 3: { cellWidth: 42 }, 6: { halign: 'center', cellWidth: 12 }, 7: { halign: 'right', cellWidth: 22 } }, margin: { left: 10, right: 10 },
    body: d.txs.length ? d.txs.map(t => [new Date(t.created_at).toLocaleDateString('fr-FR'), nomMembre(t.profiles), t.type === 'recette' ? 'Recette' : libMotif(t.motif), t.commentaire || '',
      t.type === 'recette' ? '' : (PAIEMENTS[t.methode_paiement] || ''), stat(t), t.type === 'recette' ? '' : d.avecJ.has(t.id) ? 'oui' : 'non', eurSigne(t)].map(pdfTxt)) : [['', 'Aucune opération ce mois-ci', '', '', '', '', '', '']] });
}

async function genererRelevePDF(liste, mois, annee) {
  // liste : [{ id, nom }]
  try {
    showToast('Préparation du relevé PDF…', 'info');
    const jsPDF = await chargerJsPDF();
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    for (let i = 0; i < liste.length; i++) {
      if (i) doc.addPage();
      pageReleve(doc, liste[i].nom, mois, annee, await donneesReleve(liste[i].id, mois, annee));
    }
    const n = doc.internal.getNumberOfPages(), H = doc.internal.pageSize.getHeight(), W = doc.internal.pageSize.getWidth();
    for (let p = 1; p <= n; p++) { doc.setPage(p); doc.setFontSize(8); doc.setTextColor(130);
      doc.text(pdfTxt(`SMMD · édité le ${new Date().toLocaleDateString('fr-FR')}`), 10, H - 6); doc.text(`${p} / ${n}`, W - 10, H - 6, { align: 'right' }); }
    const nom = `Releve_${liste.length === 1 ? liste[0].nom.replace(/[^\w-]+/g, '_') : 'toutes_maisons'}_${annee}-${String(mois).padStart(2, '0')}.pdf`;
    doc.save(nom);
    showToast('Relevé PDF téléchargé', 'success');
  } catch (e) { showToast('Relevé PDF impossible : ' + e.message, 'error'); }
}

// Feuille de choix du mois (chef) — mois précédent par défaut
function ouvrirRelevePDF(maisonId, nomMaison) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  const opts = []; for (let i = 0; i < 18; i++) { const x = new Date(d); x.setMonth(d.getMonth() - i + 1); opts.push(`<option value="${x.getMonth() + 1}-${x.getFullYear()}" ${i === 1 ? 'selected' : ''}>${MOIS[x.getMonth()]} ${x.getFullYear()}</option>`); }
  ouvrirFeuille(`<div class="stack"><label class="field"><span>Mois</span><select id="rp-mois" class="input">${opts.join('')}</select></label>
    <button class="btn primary block" onclick="const [m,a]=document.getElementById('rp-mois').value.split('-');fermerFeuille();genererRelevePDF([{id:'${escapeHtml(maisonId)}',nom:${escapeHtml(JSON.stringify(nomMaison))}}],+m,+a)">Télécharger le PDF</button></div>`, { titre: 'Relevé mensuel PDF' });
}
