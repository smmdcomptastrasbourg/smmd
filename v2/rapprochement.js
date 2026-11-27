// ═══════════════════════════════════════════════════════════
// SMMD v2 — Rapprochement bancaire par maison (chef ; admin pour toutes les maisons)
// Relevé = un mois de la maison. Lignes importées depuis le fichier de la banque (CSV / OFX)
// ou lues par l'IA sur le relevé PDF / photo. SMMD propose les correspondances, on valide.
// ═══════════════════════════════════════════════════════════
const RAP = { maison: null, nom: '', box: null, releves: [], releve: null, lignes: [], membres: [], txs: [], allocs: [], virs: [], liens: { tx: new Set(), al: new Set() }, annee: null, mois: null };
const RAP_DEBUT = { annee: 2026, mois: 1 };
const rapNorm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const rapCents = v => Math.round(parseFloat(v) * 100);
const rapJour = d => String(d).slice(0, 10);
const rapEcart = (a, b) => Math.round((new Date(rapJour(a) + 'T12:00:00') - new Date(rapJour(b) + 'T12:00:00')) / 86400000);
const rapMoisLib = (m, a) => `${MOIS[m - 1]} ${a}`;
const rapEurS = v => (v > 0 ? '+' : v < 0 ? '−' : '') + eur(Math.abs(v));

// ─────────────────────────────────────────────── Lecture des fichiers de la banque
function rapMontant(s) {
  let t = String(s ?? '').replace(/[\s  €]/g, '');
  if (!t) return null;
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); else t = t.replace(/,/g, '');
  const v = parseFloat(t);
  return isNaN(v) ? null : v;
}
function rapDate(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) { const a = m[3].length === 2 ? '20' + m[3] : m[3]; return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = t.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function rapCSV(texte) {
  const lignesTxt = texte.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const sep = [';', '\t', ','].map(c => [c, (lignesTxt[0] || '').split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const cellules = l => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(c => c.trim()); };
  const iEnt = lignesTxt.findIndex(l => /date/i.test(l) && /(libell|op[ée]ration|motif)/i.test(l));
  if (iEnt < 0) throw new Error('Colonnes non reconnues (il faut au moins Date, Libellé et Montant ou Débit/Crédit)');
  const ent = cellules(lignesTxt[iEnt]).map(rapNorm);
  const col = (...noms) => ent.findIndex(h => noms.some(n => h.includes(n)));
  const cDate = ent.findIndex(h => h.includes('DATE') && !h.includes('VALEUR'));
  const cLib = col('LIBELLE', 'OPERATION', 'MOTIF'), cDeb = col('DEBIT'), cCred = col('CREDIT'), cMt = col('MONTANT'), cSolde = col('SOLDE');
  const out = [];
  for (const l of lignesTxt.slice(iEnt + 1)) {
    const c = cellules(l), date = rapDate(c[cDate]);
    if (!date) continue;
    let mt = cMt >= 0 ? rapMontant(c[cMt]) : null;
    if (mt === null) { const d = rapMontant(c[cDeb]), cr = rapMontant(c[cCred]); if (d === null && cr === null) continue; mt = (cr || 0) - Math.abs(d || 0); }
    out.push({ date, libelle: (c[cLib] || '').replace(/\s+/g, ' '), montant: Math.round(mt * 100) / 100, solde: cSolde >= 0 ? rapMontant(c[cSolde]) : null });
  }
  if (!out.length) throw new Error('Aucune opération trouvée dans le fichier');
  return { lignes: out, soldeFinal: null };
}
function rapOFX(texte) {
  const tag = (bloc, t) => (bloc.match(new RegExp('<' + t + '>([^<\\r\\n]*)', 'i')) || [])[1]?.trim() || '';
  const out = [];
  for (const b of texte.split(/<STMTTRN>/i).slice(1)) {
    const bloc = b.split(/<\/STMTTRN>/i)[0];
    const date = rapDate(tag(bloc, 'DTPOSTED').slice(0, 8)), mt = rapMontant(tag(bloc, 'TRNAMT'));
    if (!date || mt === null) continue;
    out.push({ date, libelle: [tag(bloc, 'NAME'), tag(bloc, 'MEMO')].filter(Boolean).join(' ').replace(/\s+/g, ' '), montant: mt, solde: null });
  }
  if (!out.length) throw new Error('Aucune opération trouvée dans le fichier OFX');
  const bal = texte.split(/<LEDGERBAL>/i)[1];
  return { lignes: out, soldeFinal: bal ? { montant: rapMontant(tag(bal, 'BALAMT')), date: rapDate(tag(bal, 'DTASOF').slice(0, 8)) } : null };
}
// Regroupe des lignes datées en relevés mensuels ; retrouve les soldes si le fichier en donne
function rapParMois(res, source) {
  const groupes = {};
  res.lignes.forEach(l => { const k = l.date.slice(0, 7); (groupes[k] = groupes[k] || []).push(l); });
  return Object.keys(groupes).sort().map(k => {
    const ls = groupes[k], somme = ls.reduce((s, l) => s + l.montant, 0);
    let fin = null;
    if (ls.every(l => l.solde !== null && l.solde !== undefined)) {
      // chaîne : la première ligne est celle dont le solde avant n'est le solde d'aucune autre ligne
      const avant = l => Math.round((l.solde - l.montant) * 100);
      let cur = ls.find(l => !ls.some(x => x !== l && Math.round(x.solde * 100) === avant(l)));
      const vus = new Set();
      while (cur && !vus.has(cur)) { vus.add(cur); const nxt = ls.find(x => !vus.has(x) && avant(x) === Math.round(cur.solde * 100)); if (!nxt) break; cur = nxt; }
      fin = vus.size === ls.length ? cur.solde : null;
    }
    if (fin === null && res.soldeFinal && res.soldeFinal.date?.slice(0, 7) === k) fin = res.soldeFinal.montant;
    const [a, m] = k.split('-').map(Number);
    return { annee: a, mois: m, source, solde_fin: fin, solde_debut: fin !== null ? Math.round((fin - somme) * 100) / 100 : null, lignes: ls.map(({ date, libelle, montant }) => ({ date, libelle, montant })) };
  });
}
// Relevés lus par l'IA : un relevé papier = un mois (celui de la majorité de ses opérations)
function rapDepuisIA(rep) {
  const parMois = {};
  for (const r of rep.releves || []) {
    const lignes = (r.lignes || []).map(l => ({ date: rapDate(l.date), libelle: String(l.libelle || '').replace(/\s+/g, ' ').trim(), montant: Math.round(((+l.credit || 0) - (+l.debit || 0)) * 100) / 100 })).filter(l => l.date && l.montant);
    const cpt = {}; lignes.forEach(l => { const k = l.date.slice(0, 7); cpt[k] = (cpt[k] || 0) + 1; });
    const k = Object.entries(cpt).sort((a, b) => b[1] - a[1])[0]?.[0] || (rapDate(r.date_releve) || '').slice(0, 7);
    if (!k) continue;
    // Page de suite (verso) : pas de soldes imprimés → l'IA renvoie rien ou 0
    const sansSolde = (r.solde_debut === null || r.solde_debut === undefined || +r.solde_debut === 0) && (r.solde_fin === null || r.solde_fin === undefined || +r.solde_fin === 0) && lignes.length;
    const sd = sansSolde ? null : (r.solde_debut ?? null), sf = sansSolde ? null : (r.solde_fin ?? null);
    if (!parMois[k]) parMois[k] = { annee: +k.slice(0, 4), mois: +k.slice(5, 7), source: 'scan', solde_debut: sd, solde_fin: sf, lignes: [] };
    else { if (parMois[k].solde_debut === null) parMois[k].solde_debut = sd; if (sf !== null) parMois[k].solde_fin = sf; }
    parMois[k].lignes.push(...lignes);
  }
  return Object.values(parMois).sort((a, b) => a.annee - b.annee || a.mois - b.mois);
}

// ─────────────────────────────────────────────── Import
function rapOuvrirImport() {
  ouvrirFeuille(`<div class="stack">
    <div class="card" style="padding:14px">
      <h2 style="margin:0 0 4px">Fichier de la banque <span class="pill ok" style="vertical-align:middle">le plus fiable</span></h2>
      <p class="small muted" style="margin:0 0 10px">Sur creditmutuel.fr (ordinateur) : ouvrez le compte de la maison → <b>Télécharger</b> ou <b>Exporter les opérations</b> → format <b>CSV</b> (ou OFX), puis choisissez le fichier ici. Plusieurs mois d'un coup, c'est possible.</p>
      <label class="btn primary block" style="cursor:pointer">Choisir le fichier CSV / OFX<input type="file" accept=".csv,.txt,.ofx,.qif,text/csv" hidden onchange="rapLireFichier(this.files[0])"></label>
    </div>
    <div class="card" style="padding:14px">
      <h2 style="margin:0 0 4px">Relevé PDF, scan ou photo</h2>
      <p class="small muted" style="margin:0 0 10px">L'IA lit le relevé (un ou plusieurs mois). Vous vérifiez ensuite chaque ligne avant d'importer : les soldes servent de contrôle.</p>
      <label class="btn quiet block" style="cursor:pointer">Choisir le relevé (PDF ou photo)<input type="file" accept="application/pdf,image/*" hidden onchange="rapLireScan(this.files[0])"></label>
    </div>
    <p id="rap-imp-etat" class="small muted" style="margin:0;text-align:center"></p>
  </div>`, { titre: 'Importer un relevé bancaire' });
}
async function rapLireFichier(f) {
  if (!f) return;
  try {
    const brut = await f.arrayBuffer();
    let texte = new TextDecoder('utf-8').decode(brut);
    if (texte.includes('�')) texte = new TextDecoder('windows-1252').decode(brut);
    const res = /<OFX>|<STMTTRN>/i.test(texte) ? rapOFX(texte) : rapCSV(texte);
    rapApercu(rapParMois(res, /<STMTTRN>/i.test(texte) ? 'ofx' : 'csv'), f.name);
  } catch (e) { showToast('Fichier illisible : ' + e.message, 'error'); }
}
// Google renvoie parfois « high demand » / surcharge : on réessaie automatiquement (4 tentatives, attente croissante)
// Pages déjà lues gardées en mémoire : relancer le même fichier ne relit que les pages manquantes
const _rapCacheIA = new Map();
async function rapAppelIA(base64, mime, dire) {
  const cle = base64.length + ':' + base64.slice(1000, 1200) + base64.slice(-200);
  if (_rapCacheIA.has(cle)) return _rapCacheIA.get(cle);
  const attentes = [3000, 8000, 15000];
  for (let essai = 0; ; essai++) {
    try { const r = await rapAppelIA1(base64, mime); _rapCacheIA.set(cle, r); return r; }
    catch (e) {
      const passager = /high demand|overload|try again|unavailable|temporar|rate|quota|503|502|500|546|surcharg|trop lourde/i.test(e.message);
      if (!passager || essai >= attentes.length) throw e;
      if (dire) dire(`Le service d'IA est très demandé, nouvel essai dans ${attentes[essai] / 1000} s…`);
      await new Promise(ok => setTimeout(ok, attentes[essai]));
    }
  }
}
async function rapAppelIA1(base64, mime) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${SMMD_CONFIG.url}/functions/v1/lire-releve`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SMMD_CONFIG.key, 'Authorization': `Bearer ${session?.access_token}` }, body: JSON.stringify({ base64, mime }) });
  const r = await res.json().catch(() => ({}));
  if (res.status === 404) throw new Error('Fonction « lire-releve » non déployée dans Supabase');
  if (res.status === 546) throw new Error('page trop lourde pour le serveur');
  if (!res.ok) throw new Error(r.error || r.message || 'Erreur ' + res.status);
  return r;
}
const rapB64 = octets => { let bin = ''; for (let i = 0; i < octets.length; i += 0x8000) bin += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000)); return btoa(bin); };
// Un PDF de plusieurs pages est découpé dans le navigateur : une page = un appel (le serveur a peu de mémoire)
async function rapPagesPDF(f) {
  if (!window.PDFLib) await chargerScript('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js');
  const src = await PDFLib.PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
  const pages = [];
  for (let i = 0; i < src.getPageCount(); i++) {
    const d = await PDFLib.PDFDocument.create();
    const [pg] = await d.copyPages(src, [i]); d.addPage(pg);
    pages.push(rapB64(await d.save()));
  }
  return pages;
}
async function rapLireScan(f) {
  if (!f) return;
  const etat = document.getElementById('rap-imp-etat');
  const dire = t => { if (etat) etat.textContent = t; };
  dire('Préparation du relevé…');
  try {
    let morceaux;
    if ((f.type || '').startsWith('image/')) morceaux = [{ base64: await fileToBase64(f), mime: 'image/jpeg' }];
    else {
      let pages;
      try { pages = await rapPagesPDF(f); } catch (e) { pages = null; }
      if (pages) morceaux = pages.map(b => ({ base64: b, mime: 'application/pdf' }));
      else { if (f.size > 8 * 1024 * 1024) throw new Error('PDF illisible ou trop lourd : envoyez quelques mois à la fois'); morceaux = [{ base64: await fileToBase64(f), mime: 'application/pdf' }]; }
    }
    const rep = { releves: [] }, echecs = [];
    let fait = 0;
    const suivant = async () => {
      while (morceaux.length) {
        const i = morceaux.length - 1, m = morceaux.pop();
        try { const r = await rapAppelIA(m.base64, m.mime, dire); (r.releves || []).forEach(x => rep.releves.push({ ...x, _page: i })); }
        catch (e) { echecs.push(`page ${i + 1} : ${e.message}`); }
        fait++; dire(`Lecture par l'IA : ${fait} page${fait > 1 ? 's' : ''} lue${fait > 1 ? 's' : ''}…`);
      }
    };
    const total = morceaux.length;
    dire(`Lecture par l'IA : 0 / ${total} page${total > 1 ? 's' : ''}…`);
    await Promise.all([suivant(), suivant(), suivant()]);   // 3 pages en parallèle ; le serveur bascule sur un autre modèle si l'un est saturé
    rep.releves.sort((a, b) => a._page - b._page);
    if (echecs.length === total) throw new Error(echecs[0]);
    const rel = rapDepuisIA(rep);
    if (!rel.length) throw new Error('Aucune opération trouvée sur ce document');
    if (echecs.length) showToast(`${echecs.length} page(s) non lue(s) : ${echecs.join(' · ')}. Vérifiez les contrôles de soldes.`, 'warning');
    rapApercu(rel, f.name);
  } catch (e) { dire(''); showToast('Lecture impossible : ' + e.message, 'error'); }
}
let _rapApercu = [];
function rapControle(r) {
  if (r.solde_debut === null || r.solde_debut === '' || r.solde_fin === null || r.solde_fin === '' || isNaN(+r.solde_debut) || isNaN(+r.solde_fin)) return null;
  return Math.round((+r.solde_debut + r.lignes.reduce((s, l) => s + (+l.montant || 0), 0) - +r.solde_fin) * 100) / 100;
}
function rapApercu(rel, fichier) {
  _rapApercu = rel.map(r => ({ ...r, fichier }));
  const html = _rapApercu.map((r, i) => {
    const ec = rapControle(r);
    return `<div class="card" style="padding:12px" data-r="${i}">
      <div class="between" style="flex-wrap:wrap;gap:8px"><h2 style="margin:0">${rapMoisLib(r.mois, r.annee)} · ${r.lignes.length} ligne${r.lignes.length > 1 ? 's' : ''}</h2>
        <span id="rap-ctl-${i}" class="pill ${ec === null ? 'warn' : ec === 0 ? 'ok' : 'red'}">${ec === null ? 'Soldes à saisir' : ec === 0 ? 'Contrôle OK' : 'Écart ' + eur(ec)}</span></div>
      <div class="filters" style="padding:6px 0 0">
        <label class="field"><span>Solde début</span><input class="input num" inputmode="decimal" value="${r.solde_debut ?? ''}" oninput="_rapApercu[${i}].solde_debut=rapMontant(this.value);rapMajCtl(${i})"></label>
        <label class="field"><span>Solde fin</span><input class="input num" inputmode="decimal" value="${r.solde_fin ?? ''}" oninput="_rapApercu[${i}].solde_fin=rapMontant(this.value);rapMajCtl(${i})"></label>
      </div>
      <details ${ec ? 'open' : ''}><summary class="small" style="cursor:pointer;margin:6px 0">Vérifier les lignes</summary>
      <div class="tbl-wrap"><table class="tbl" style="font-size:14px"><thead><tr><th>Date</th><th>Libellé</th><th class="r">Montant (+/−)</th><th></th></tr></thead><tbody>
      ${r.lignes.map((l, j) => `<tr data-l="${j}"><td><input class="input" type="date" style="min-height:36px" value="${l.date}" onchange="_rapApercu[${i}].lignes[${j}].date=this.value"></td>
        <td><input class="input" style="min-height:36px" value="${escapeHtml(l.libelle)}" onchange="_rapApercu[${i}].lignes[${j}].libelle=this.value"></td>
        <td class="r"><input class="input num" style="min-height:36px;max-width:120px;text-align:right" inputmode="decimal" value="${String(l.montant).replace('.', ',')}" oninput="_rapApercu[${i}].lignes[${j}].montant=rapMontant(this.value)||0;rapMajCtl(${i})"></td>
        <td><button class="iconbtn" style="width:32px;height:32px" aria-label="Supprimer la ligne" onclick="_rapApercu[${i}].lignes.splice(${j},1);rapApercu(_rapApercu,'${escapeHtml(fichier)}')">${svg(IC.close, 14)}</button></td></tr>`).join('')}
      </tbody></table></div></details></div>`;
  }).join('');
  ouvrirFeuille(`<div class="stack">
    <p class="small muted" style="margin:0">Vérifiez avant d'importer. Le contrôle compare solde début + opérations au solde de fin : <b>Contrôle OK</b> = aucune ligne oubliée ni mal lue. Les lignes déjà importées ne sont pas dupliquées.</p>
    ${html}
    <button class="btn primary block" onclick="rapImporter()">Importer ${_rapApercu.length > 1 ? 'ces ' + _rapApercu.length + ' mois' : 'ce mois'}</button>
  </div>`, { titre: 'Vérifier le relevé', large: true });
}
function rapMajCtl(i) {
  const ec = rapControle(_rapApercu[i]), el = document.getElementById('rap-ctl-' + i);
  if (el) { el.className = 'pill ' + (ec === null ? 'warn' : ec === 0 ? 'ok' : 'red'); el.textContent = ec === null ? 'Soldes à saisir' : ec === 0 ? 'Contrôle OK' : 'Écart ' + eur(ec); }
}
async function rapImporter() {
  const ecarts = _rapApercu.filter(r => { const e = rapControle(r); return e !== null && e !== 0; });
  const go2 = async () => {
    try {
      const { data: exist } = await sb.from('lignes_bancaires').select('cle').eq('maison_id', RAP.maison);
      const deja = new Set((exist || []).map(x => x.cle));
      let nb = 0, dern = null;
      for (const r of _rapApercu) {
        let { data: rel } = await sb.from('releves_bancaires').select('*').eq('maison_id', RAP.maison).eq('annee', r.annee).eq('mois', r.mois).maybeSingle();
        const champs = { source: r.source, fichier: r.fichier };
        if (r.solde_debut !== null && r.solde_debut !== undefined && !isNaN(r.solde_debut)) champs.solde_debut = r.solde_debut;
        if (r.solde_fin !== null && r.solde_fin !== undefined && !isNaN(r.solde_fin)) champs.solde_fin = r.solde_fin;
        if (!rel) {
          const { data, error } = await sb.from('releves_bancaires').insert([{ maison_id: RAP.maison, annee: r.annee, mois: r.mois, created_by: userProfile.id, ...champs }]).select('*');
          if (error) throw error; rel = data[0];
        } else {
          const { error } = await sb.from('releves_bancaires').update(champs).eq('id', rel.id);
          if (error) throw error;
        }
        const occ = {}, aInserer = [];
        for (const l of r.lignes) {
          if (!l.date || !l.montant) continue;
          const base = `${l.date}|${(+l.montant).toFixed(2)}|${rapNorm(l.libelle).slice(0, 60)}`;
          occ[base] = (occ[base] || 0) + 1;
          const cle = base + '|' + occ[base];
          if (deja.has(cle)) continue;
          deja.add(cle);
          aInserer.push({ releve_id: rel.id, maison_id: RAP.maison, date_op: l.date, libelle: l.libelle || '(sans libellé)', montant: +(+l.montant).toFixed(2), cle });
        }
        for (let i = 0; i < aInserer.length; i += 200) {
          const { error } = await sb.from('lignes_bancaires').insert(aInserer.slice(i, i + 200));
          if (error) throw error;
        }
        if (aInserer.length && rel.statut === 'rapproche') await sb.from('releves_bancaires').update({ statut: 'en_cours', rapproche_le: null }).eq('id', rel.id);
        nb += aInserer.length; dern = r;
      }
      fermerFeuille();
      showToast(`${nb} ligne${nb > 1 ? 's' : ''} importée${nb > 1 ? 's' : ''}`, 'success');
      if (dern) { RAP.annee = dern.annee; RAP.mois = dern.mois; }
      rapCharger();
    } catch (e) { showToast('Import impossible : ' + (e.message || e), 'error'); }
  };
  if (ecarts.length) showConfirm(`Le contrôle des soldes ne tombe pas juste pour ${ecarts.map(r => rapMoisLib(r.mois, r.annee)).join(', ')} : une ligne manque ou est mal lue. Importer quand même ?`, go2, 'Importer quand même');
  else go2();
}

// ─────────────────────────────────────────────── Chargement et affichage
function rapInit(maisonId, nom, boxId) {
  RAP.maison = maisonId; RAP.nom = nom; RAP.box = boxId;
  if (!RAP.annee) { const d = new Date(); RAP.annee = d.getFullYear(); RAP.mois = d.getMonth() + 1; }
  rapCharger();
}
async function rapCharger() {
  const box = document.getElementById(RAP.box); if (!box) return;
  box.innerHTML = '<div class="skel" style="height:160px"></div>';
  try {
    const debut = new Date(RAP_DEBUT.annee - 1, 0, 1).toISOString();
    const [rel, mb, txs, al, lk, vs] = await Promise.all([
      sb.from('releves_bancaires').select('*').eq('maison_id', RAP.maison).order('annee').order('mois'),
      fetchAll(() => sb.from('profiles').select('id,prenom,nom,allocation_mensuelle,actif').eq('maison_id', RAP.maison).order('nom')),
      fetchAll(() => sb.from('transactions').select('id,user_id,type,montant,statut,motif,commentaire,created_at,methode_paiement,date_validation').eq('maison_id', RAP.maison).gte('created_at', debut).order('created_at')),
      fetchAll(() => sb.from('allocations_versees').select('*').eq('maison_id', RAP.maison).order('id')),
      fetchAll(() => sb.from('lignes_bancaires').select('id,lien,statut').eq('maison_id', RAP.maison).eq('statut', 'pointe').order('id')),
      sb.from('virements_sepa').select('id,detail,statut').eq('maison_id', RAP.maison).eq('statut', 'genere')
    ]);
    if (rel.error) throw new Error(/releves_bancaires/.test(rel.error.message) ? 'Tables du rapprochement absentes : exécutez le script SQL « rapprochement »' : rel.error.message);
    RAP.releves = rel.data || []; RAP.membres = mb; RAP.txs = txs; RAP.allocs = al; RAP.virs = vs.data || [];
    RAP.liens = { tx: new Set(), al: new Set() };
    lk.forEach(l => { const k = l.lien || {}; (k.ids || []).forEach(i => RAP.liens.tx.add(i)); if (k.alloc) RAP.liens.al.add(k.alloc); });
    RAP.releve = RAP.releves.find(r => r.annee === RAP.annee && r.mois === RAP.mois) || null;
    RAP.lignes = RAP.releve ? await fetchAll(() => sb.from('lignes_bancaires').select('*').eq('releve_id', RAP.releve.id).order('date_op').order('id')) : [];
  } catch (e) { box.innerHTML = `<p class="empty red">${escapeHtml(e.message)}</p>`; return; }
  rapAfficher();
}
function rapMoisListe() {
  const out = [], d = new Date(); let a = RAP_DEBUT.annee, m = RAP_DEBUT.mois;
  while (a < d.getFullYear() || (a === d.getFullYear() && m <= d.getMonth() + 1)) { out.push([a, m]); m++; if (m > 12) { m = 1; a++; } }
  return out.reverse();
}
function rapEtatMois(a, m) {
  const r = RAP.releves.find(x => x.annee === a && x.mois === m);
  return !r ? 'vide' : r.statut === 'rapproche' ? 'ok' : 'cours';
}
function rapAfficher() {
  const box = document.getElementById(RAP.box); if (!box) return;
  const r = RAP.releve, L = RAP.lignes;
  const ICO = { ok: '✓', cours: '◐', vide: '·' };
  const sel = `<label class="field" style="max-width:260px"><span>Mois</span><select class="input" onchange="const [a,m]=this.value.split('-');RAP.annee=+a;RAP.mois=+m;rapCharger()">
    ${rapMoisListe().map(([a, m]) => `<option value="${a}-${m}" ${a === RAP.annee && m === RAP.mois ? 'selected' : ''}>${ICO[rapEtatMois(a, m)]} ${rapMoisLib(m, a)}</option>`).join('')}</select></label>`;
  const entete = `<div class="between" style="flex-wrap:wrap;gap:10px;align-items:flex-end">${sel}
    <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn primary" onclick="rapOuvrirImport()">Importer un relevé</button></div></div>`;
  if (!r) { box.innerHTML = entete + `<div class="card empty" style="margin-top:12px">Aucun relevé importé pour ${rapMoisLib(RAP.mois, RAP.annee)}.<br><span class="small muted">Importez le fichier de la banque ou le relevé PDF.</span></div>`; return; }
  const somme = L.reduce((s, l) => s + +l.montant, 0), ec = rapControle({ ...r, lignes: L });
  const nbP = L.filter(l => l.statut !== 'a_pointer').length;
  const sugg = L.filter(l => l.statut === 'a_pointer').map(l => [l, rapPropositions(l)]);
  const sures = sugg.filter(([, p]) => rapSure(p));
  const fini = L.length && nbP === L.length && (ec === null || ec === 0);
  box.innerHTML = entete + `
    <div class="kpis" style="margin-top:12px">
      <div class="card kpi"><p class="small muted">Solde début (banque)</p><p class="v num">${r.solde_debut !== null ? eur(r.solde_debut) : '—'}</p></div>
      <div class="card kpi"><p class="small muted">Mouvements du mois</p><p class="v num">${rapEurS(somme)}</p></div>
      <div class="card kpi"><p class="small muted">Solde fin (banque)</p><p class="v num">${r.solde_fin !== null ? eur(r.solde_fin) : '—'}</p></div>
      <div class="card kpi"><p class="small muted">Pointées</p><p class="v num ${nbP === L.length ? 'ok' : ''}">${nbP} / ${L.length}</p></div>
    </div>
    ${ec === null ? `<div class="banner warn" style="margin-top:10px">${svg(IC.alert, 18)}<span>Soldes du relevé non renseignés : le contrôle d'exhaustivité est impossible.</span><button class="link" style="margin-left:auto" onclick="rapSoldes()">Saisir les soldes</button></div>`
      : ec !== 0 ? `<div class="banner warn" style="margin-top:10px;border-color:var(--red)">${svg(IC.alert, 18)}<span>Écart de ${eur(ec)} entre les soldes et les lignes : une opération manque ou est mal lue.</span><button class="link" style="margin-left:auto" onclick="rapSoldes()">Corriger les soldes</button></div>` : ''}
    ${r.statut === 'rapproche' ? `<div class="banner" style="margin-top:10px;border-color:var(--ok)">${svg(IC.check, 18)}<span>Mois rapproché le ${new Date(r.rapproche_le).toLocaleDateString('fr-FR')}.</span><button class="link" style="margin-left:auto" onclick="rapMarquer(false)">Rouvrir</button></div>` : ''}
    <div class="row" style="gap:8px;flex-wrap:wrap;margin:12px 0">
      ${sures.length ? `<button class="btn primary" onclick="rapValiderSures()">${svg(IC.check, 18)}Valider les ${sures.length} correspondance${sures.length > 1 ? 's' : ''} sûre${sures.length > 1 ? 's' : ''}</button>` : ''}
      ${r.statut !== 'rapproche' ? `<button class="btn ${fini ? 'primary' : 'quiet'}" ${fini ? '' : 'disabled'} onclick="rapMarquer(true)" title="Toutes les lignes pointées et soldes justes">Marquer le mois rapproché</button>` : ''}
      <button class="btn quiet" onclick="rapSoldes()">Soldes du relevé</button>
    </div>
    <div class="card card-flush"><div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Date</th><th scope="col">Libellé banque</th><th scope="col" class="r">Montant</th><th scope="col">Dans SMMD</th></tr></thead><tbody>
      ${L.map(l => { const p = l.statut === 'a_pointer' ? rapPropositions(l) : null; return `<tr onclick="rapOuvrirLigne('${l.id}')">
        <td class="num" style="white-space:nowrap">${new Date(l.date_op + 'T12:00:00').toLocaleDateString('fr-FR')}</td>
        <td style="min-width:200px">${escapeHtml(l.libelle)}</td>
        <td class="r num bold ${+l.montant > 0 ? 'ok' : ''}" style="white-space:nowrap">${rapEurS(+l.montant)}</td>
        <td style="min-width:200px">${l.statut === 'pointe' ? `<span class="pill ok">✓ ${escapeHtml(rapLienTexte(l.lien))}</span>` : l.statut === 'ignore' ? `<span class="pill">Ignorée${l.note ? ' · ' + escapeHtml(l.note) : ''}</span>`
          : p.length ? `<span class="small ${rapSure(p) ? 'bold' : 'muted'}">${rapSure(p) ? 'Proposé : ' : 'Possible : '}${escapeHtml(p[0].label)}</span>` : '<span class="pill warn">Introuvable · à créer</span>'}</td></tr>`; }).join('')}
    </tbody></table></div></div>
    ${rapSansBanque()}`;
}
function rapLienTexte(k) { return k?.texte || 'pointée'; }
async function rapSoldes() {
  const r = RAP.releve; if (!r) return;
  ouvrirFeuille(`<div class="stack"><p class="small muted" style="margin:0">Recopiez les soldes imprimés sur le relevé du mois.</p>
    <label class="field"><span>Solde au début</span><input id="rap-sd" class="input num" inputmode="decimal" value="${r.solde_debut ?? ''}"></label>
    <label class="field"><span>Solde à la fin</span><input id="rap-sf" class="input num" inputmode="decimal" value="${r.solde_fin ?? ''}"></label>
    <button class="btn primary block" onclick="rapEnregSoldes()">Enregistrer</button></div>`, { titre: 'Soldes du relevé · ' + rapMoisLib(r.mois, r.annee) });
}
async function rapEnregSoldes() {
  const sd = rapMontant(document.getElementById('rap-sd').value), sf = rapMontant(document.getElementById('rap-sf').value);
  const { error } = await sb.from('releves_bancaires').update({ solde_debut: sd, solde_fin: sf }).eq('id', RAP.releve.id);
  if (error) return showToast('Erreur : ' + error.message, 'error');
  fermerFeuille(); rapCharger();
}
async function rapMarquer(ok) {
  const { error } = await sb.from('releves_bancaires').update(ok ? { statut: 'rapproche', rapproche_le: new Date().toISOString(), rapproche_par: userProfile.id } : { statut: 'en_cours', rapproche_le: null, rapproche_par: null }).eq('id', RAP.releve.id);
  if (error) return showToast('Erreur : ' + error.message, 'error');
  showToast(ok ? 'Mois rapproché' : 'Mois rouvert', 'success'); rapCharger();
}
// Ce qui est dans SMMD pour le mois, devrait passer par la banque, et n'a pas été trouvé
function rapSansBanque() {
  const { debut, fin } = bornesMois(RAP.annee, RAP.mois);
  const tx = RAP.txs.filter(t => t.created_at >= debut && t.created_at < fin && !RAP.liens.tx.has(t.id) && (t.type === 'recette' || !estPerso(t.methode_paiement)));
  const al = RAP.allocs.filter(a => a.annee === RAP.annee && a.mois === RAP.mois && allocConfirmee(a) && !RAP.liens.al.has(a.id));
  if (!tx.length && !al.length) return '';
  return `<div class="card" style="margin-top:14px"><h2 style="margin:0 0 4px">Dans SMMD, pas encore trouvé à la banque</h2>
    <p class="small muted" style="margin:0 0 8px">Paiements de la maison, recettes et allocations confirmées de ${MOIS[RAP.mois - 1]} sans ligne bancaire pointée (débit le mois suivant, erreur de saisie, espèces…).</p>
    ${tx.map(t => `<div class="between" style="padding:6px 0;border-top:1px solid var(--border)"><span>${dateFr(t.created_at)} · ${escapeHtml(t.type === 'recette' ? 'Recette' : libMotif(t.motif))}${t.commentaire ? ' · ' + escapeHtml(t.commentaire) : ''}</span><b class="num">${eurSigne(t)}</b></div>`).join('')}
    ${al.map(a => `<div class="between" style="padding:6px 0;border-top:1px solid var(--border)"><span>Allocation · ${escapeHtml(rapNomMembre(a.user_id))}</span><b class="num">+${eur(a.montant)}</b></div>`).join('')}</div>`;
}
const rapNomMembre = id => nomMembre(RAP.membres.find(m => m.id === id)) || 'Membre';

// ─────────────────────────────────────────────── Propositions de correspondance
function rapMembresDans(libelle) {
  const lib = ' ' + rapNorm(libelle) + ' ';
  return RAP.membres.filter(m => { const mots = rapNorm(m.nom).split(' ').filter(w => w.length >= 3); return mots.length && mots.every(w => lib.includes(' ' + w + ' ')); });
}
// Sous-ensemble d'avances dont la somme vaut exactement le montant (petites listes)
function rapSousEnsemble(items, cible) {
  const liste = items.slice(0, 22).map(t => ({ t, c: rapCents(t.montant) })).sort((a, b) => b.c - a.c);
  let res = null;
  const rec = (i, reste, pris) => {
    if (res) return; if (reste === 0) { res = pris.slice(); return; }
    if (i >= liste.length || reste < 0) return;
    pris.push(liste[i].t); rec(i + 1, reste - liste[i].c, pris); pris.pop(); rec(i + 1, reste, pris);
  };
  rec(0, cible, []);
  return res;
}
function rapPropositions(l) {
  const mt = +l.montant, c = Math.abs(rapCents(mt)), d = l.date_op, out = [];
  const qui = rapMembresDans(l.libelle), quiIds = new Set(qui.map(m => m.id));
  const [la, lm] = [+d.slice(0, 4), +d.slice(5, 7)];
  const libre = t => !RAP.liens.tx.has(t.id);
  if (mt > 0) {
    // Allocation déjà enregistrée (déclarée ou confirmée)
    RAP.allocs.filter(a => !RAP.liens.al.has(a.id) && rapCents(a.montant) === c && Math.abs((a.annee * 12 + a.mois) - (la * 12 + lm)) <= 1)
      .forEach(a => out.push({ score: (quiIds.has(a.user_id) ? 92 : (qui.length ? 30 : 60)) - 12 * Math.abs((a.annee * 12 + a.mois) - (la * 12 + lm)), label: `Allocation ${rapNomMembre(a.user_id)} · ${rapMoisLib(a.mois, a.annee)}${allocConfirmee(a) ? '' : ' (déclarée → confirmée)'}`, fn: () => rapPointerAlloc(l, a) }));
    // Nouvelle allocation pour le membre nommé sur la ligne
    qui.forEach(m => { if (!out.some(o => o.score >= 90)) out.push({ score: rapCents(m.allocation_mensuelle) === c ? 82 : 66, label: `Nouvelle allocation ${nomMembre(m)} · ${rapMoisLib(lm, la)}`, fn: () => rapPointerNouvelleAlloc(l, m, lm, la) }); });
    // Recette saisie dans SMMD
    RAP.txs.filter(t => t.type === 'recette' && libre(t) && rapCents(t.montant) === c && Math.abs(rapEcart(d, t.created_at)) <= 10)
      .forEach(t => out.push({ score: 84 - Math.abs(rapEcart(d, t.created_at)), label: `Recette du ${dateFr(t.created_at)}${t.commentaire ? ' · ' + t.commentaire : ''}`, fn: () => rapPointerOps(l, [t], 'Recette') }));
  } else {
    // Paiement de la maison (CB maison) saisi dans SMMD
    RAP.txs.filter(t => t.type === 'depense' && !estPerso(t.methode_paiement) && libre(t) && rapCents(t.montant) === c && rapEcart(d, t.created_at) >= -2 && rapEcart(d, t.created_at) <= 10)
      .forEach(t => out.push({ score: 90 - Math.abs(rapEcart(d, t.created_at)), label: `${libMotif(t.motif)} du ${dateFr(t.created_at)}${t.commentaire ? ' · ' + t.commentaire : ''}`, fn: () => rapPointerOps(l, [t], libMotif(t.motif)) }));
    // Remboursement d'avances à un membre
    const cibles = qui.length ? qui : RAP.membres;
    for (const m of cibles) {
      const av = RAP.txs.filter(t => t.user_id === m.id && t.type === 'depense' && estPerso(t.methode_paiement) && libre(t));
      const faites = av.filter(t => t.statut === 'valide' && t.date_validation && Math.abs(rapEcart(d, t.date_validation)) <= 20);
      const ens1 = rapSousEnsemble(faites, c);
      if (ens1) { out.push({ score: qui.length ? 90 : 62, label: `Remboursement ${nomMembre(m)} · ${ens1.length} avance${ens1.length > 1 ? 's' : ''} déjà remboursée${ens1.length > 1 ? 's' : ''}`, fn: () => rapPointerOps(l, ens1, 'Remboursement ' + nomMembre(m), m.id) }); continue; }
      const ens2 = rapSousEnsemble(av.filter(t => t.statut === 'attente' && rapEcart(d, t.created_at) >= 0), c);
      if (ens2) out.push({ score: qui.length ? 80 : 55, label: `Remboursement ${nomMembre(m)} · ${ens2.length} avance${ens2.length > 1 ? 's' : ''} à marquer remboursée${ens2.length > 1 ? 's' : ''}`, fn: () => rapPointerRemb(l, ens2, m) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
const rapSure = p => p.length && p[0].score >= 80 && (!p[1] || p[1].score < p[0].score - 10);

// ─────────────────────────────────────────────── Pointage
async function rapEnregLigne(l, champs) {
  const { error } = await sb.from('lignes_bancaires').update({ ...champs, pointe_par: userProfile.id, pointe_le: new Date().toISOString() }).eq('id', l.id);
  if (error) throw error;
  Object.assign(l, champs);
  const k = champs.lien || {};
  (k.ids || []).forEach(i => RAP.liens.tx.add(i)); if (k.alloc) RAP.liens.al.add(k.alloc);
}
async function rapPointerOps(l, ops, texte, userId) {
  await rapEnregLigne(l, { statut: 'pointe', lien: { type: 'operations', ids: ops.map(t => t.id), user_id: userId || null, texte } });
}
async function rapPointerAlloc(l, a) {
  const maj = { montant: Math.abs(+l.montant) };
  if (!allocConfirmee(a)) Object.assign(maj, { statut: 'confirme', valide_par: userProfile.id, date_confirmation: new Date().toISOString() });
  const { error } = await sb.from('allocations_versees').update(maj).eq('id', a.id);
  if (error) throw error;
  Object.assign(a, maj);
  await rapEnregLigne(l, { statut: 'pointe', lien: { type: 'allocation', alloc: a.id, texte: `Allocation ${rapNomMembre(a.user_id)} ${MOIS[a.mois - 1]}` } });
}
async function rapPointerNouvelleAlloc(l, m, mois, annee) {
  const deja = RAP.allocs.find(a => a.user_id === m.id && a.mois === mois && a.annee === annee && !RAP.liens.al.has(a.id));
  if (deja) return rapPointerAlloc(l, deja);
  const { data, error } = await sb.from('allocations_versees').insert([{ user_id: m.id, maison_id: RAP.maison, mois, annee, montant: Math.abs(+l.montant), statut: 'confirme', valide_par: userProfile.id, date_confirmation: new Date().toISOString() }]).select('*');
  if (error) throw error;
  RAP.allocs.push(data[0]);
  await rapEnregLigne(l, { statut: 'pointe', lien: { type: 'allocation', alloc: data[0].id, texte: `Allocation ${nomMembre(m)} ${MOIS[mois - 1]}` } });
}
async function rapPointerRemb(l, ops, m) {
  const quand = new Date(l.date_op + 'T12:00:00').toISOString(), ids = ops.map(t => t.id);
  const { error } = await sb.from('transactions').update({ statut: 'valide', date_validation: quand }).in('id', ids).eq('maison_id', RAP.maison).eq('statut', 'attente');
  if (error) throw error;
  ops.forEach(t => { t.statut = 'valide'; t.date_validation = quand; });
  const total = ops.reduce((s, t) => s + +t.montant, 0);
  const msg = `Votre remboursement de ${eur(total)} (${ops.length} avance${ops.length > 1 ? 's' : ''}) a été reçu par virement.`;
  await sb.from('notifications').insert([{ user_id: m.id, lu: false, type: 'remboursement', message: msg }]);
  if (typeof envoyerPush === 'function') envoyerPush([m.id], 'Remboursement reçu', msg, './v2/membre.html');
  // Un virement SMMD en attente dont toutes les avances sont maintenant remboursées est clos
  for (const v of RAP.virs) {
    const tous = (v.detail || []).flatMap(x => x.tx_ids || []);
    if (tous.length && tous.every(id => RAP.txs.find(t => t.id === id)?.statut === 'valide')) await sb.from('virements_sepa').update({ statut: 'effectue', date_statut: new Date().toISOString() }).eq('id', v.id);
  }
  await rapEnregLigne(l, { statut: 'pointe', lien: { type: 'operations', ids, user_id: m.id, texte: `Remboursement ${nomMembre(m)}` } });
}
async function rapValiderSures() {
  let n = 0;
  try {
    for (const l of RAP.lignes.filter(x => x.statut === 'a_pointer')) {
      const p = rapPropositions(l);   // recalculé à chaque ligne : une opération ne sert qu'une fois
      if (rapSure(p)) { await p[0].fn(); n++; }
    }
    showToast(`${n} ligne${n > 1 ? 's' : ''} pointée${n > 1 ? 's' : ''}`, 'success');
  } catch (e) { showToast('Erreur : ' + (e.message || e), 'error'); }
  rapCharger();
}

// ─────────────────────────────────────────────── Détail d'une ligne
let _rapProps = [];
function rapOuvrirLigne(id) {
  const l = RAP.lignes.find(x => x.id === id); if (!l) return;
  const mt = +l.montant;
  const tete = `<div class="card" style="padding:12px;margin-bottom:12px"><div class="between"><span class="small muted">${new Date(l.date_op + 'T12:00:00').toLocaleDateString('fr-FR')}</span><b class="num ${mt > 0 ? 'ok' : ''}">${rapEurS(mt)}</b></div><p style="margin:4px 0 0">${escapeHtml(l.libelle)}</p></div>`;
  if (l.statut !== 'a_pointer') {
    return ouvrirFeuille(tete + `<p style="margin:0 0 12px">${l.statut === 'pointe' ? 'Pointée : <b>' + escapeHtml(rapLienTexte(l.lien)) + '</b>' : 'Ignorée' + (l.note ? ' : ' + escapeHtml(l.note) : '')}</p>
      <button class="btn quiet block" onclick="rapDepointer('${l.id}')">Dépointer</button>
      <p class="xs muted" style="margin:8px 0 0">Dépointer ne défait pas ce qui a été fait dans SMMD (allocation confirmée, opération créée, avances remboursées).</p>`, { titre: 'Ligne bancaire' });
  }
  _rapProps = rapPropositions(l);
  const motifsOpts = (typeof motifs !== 'undefined' ? motifs : []).map(m => `<option value="${escapeHtml(m.nom)}">${escapeHtml(libMotif(m.nom))}</option>`).join('');
  const qui = rapMembresDans(l.libelle);
  const lm = +l.date_op.slice(5, 7), la = +l.date_op.slice(0, 4);
  ouvrirFeuille(tete + `<div class="stack" style="gap:10px">
    ${_rapProps.length ? `<p class="bold" style="margin:0">Correspondances proposées</p>
      ${_rapProps.map((p, i) => `<button class="btn ${i === 0 && rapSure(_rapProps) ? 'primary' : 'quiet'} block" style="justify-content:flex-start;text-align:left" onclick="rapAppliquer(${i})">${escapeHtml(p.label)}</button>`).join('')}` : '<p class="small muted" style="margin:0">Aucune opération correspondante dans SMMD.</p>'}
    <details ${_rapProps.length ? '' : 'open'}><summary class="bold" style="cursor:pointer">Créer dans SMMD</summary>
      <div class="stack" style="gap:8px;margin-top:8px">
      ${mt < 0 ? `<label class="field"><span>Dépense payée par la maison · motif</span><select id="rap-motif" class="input">${motifsOpts}</select></label>
        <button class="btn quiet block" onclick="rapCreerOp('${l.id}')">Créer la dépense (CB / virement maison)</button>`
      : `<button class="btn quiet block" onclick="rapCreerOp('${l.id}')">Créer une recette</button>
        <label class="field"><span>…ou une allocation de</span><select id="rap-membre" class="input">${RAP.membres.map(m => `<option value="${m.id}" ${qui[0]?.id === m.id ? 'selected' : ''}>${escapeHtml(nomMembre(m))}</option>`).join('')}</select></label>
        <label class="field"><span>pour le mois de</span><select id="rap-am" class="input">${[-1, 0, 1].map(k => { const dd = new Date(la, lm - 1 + k, 1); return `<option value="${dd.getMonth() + 1}-${dd.getFullYear()}" ${k === 0 ? 'selected' : ''}>${rapMoisLib(dd.getMonth() + 1, dd.getFullYear())}</option>`; }).join('')}</select></label>
        <button class="btn quiet block" onclick="rapCreerAlloc('${l.id}')">Enregistrer l'allocation confirmée</button>`}
      <p class="xs muted" style="margin:0">Le libellé de la banque est repris en commentaire ; ajoutez le justificatif ensuite depuis le relevé de la maison.</p></div></details>
    <details><summary class="bold" style="cursor:pointer">Ignorer cette ligne</summary>
      <div class="stack" style="gap:8px;margin-top:8px"><input id="rap-note" class="input" placeholder="Raison (ex. frais bancaires, virement interne)">
      <button class="btn quiet block" onclick="rapIgnorer('${l.id}')">Ignorer</button></div></details>
  </div>`, { titre: 'Pointer la ligne' });
}
async function rapAppliquer(i) {
  try { await _rapProps[i].fn(); fermerFeuille(); showToast('Ligne pointée', 'success'); } catch (e) { showToast('Erreur : ' + (e.message || e), 'error'); }
  rapCharger();
}
async function rapCreerOp(id) {
  const l = RAP.lignes.find(x => x.id === id); if (!l) return;
  const dep = +l.montant < 0;
  const payload = { user_id: userProfile.id, maison_id: RAP.maison, type: dep ? 'depense' : 'recette', montant: Math.abs(+l.montant), commentaire: l.libelle.slice(0, 200),
    created_at: new Date(l.date_op + 'T12:00:00').toISOString(), statut: 'valide', justificatif_url: null };
  if (dep) { payload.motif = document.getElementById('rap-motif')?.value || 'autre'; payload.methode_paiement = 'cb_maison'; }
  try {
    const { data, error } = await sb.from('transactions').insert([payload]).select('*');
    if (error) throw error;
    RAP.txs.push(data[0]);
    await rapEnregLigne(l, { statut: 'pointe', lien: { type: 'operations', ids: [data[0].id], cree: true, texte: (dep ? libMotif(payload.motif) : 'Recette') + ' créée' } });
    fermerFeuille(); showToast(dep ? 'Dépense créée et pointée' : 'Recette créée et pointée', 'success');
  } catch (e) { showToast('Erreur : ' + (e.message || e), 'error'); }
  rapCharger();
}
async function rapCreerAlloc(id) {
  const l = RAP.lignes.find(x => x.id === id); if (!l) return;
  const m = RAP.membres.find(x => x.id === document.getElementById('rap-membre').value);
  const [mo, an] = document.getElementById('rap-am').value.split('-').map(Number);
  try { await rapPointerNouvelleAlloc(l, m, mo, an); fermerFeuille(); showToast('Allocation confirmée et pointée', 'success'); } catch (e) { showToast('Erreur : ' + (e.message || e), 'error'); }
  rapCharger();
}
async function rapIgnorer(id) {
  const l = RAP.lignes.find(x => x.id === id); if (!l) return;
  try { await rapEnregLigne(l, { statut: 'ignore', lien: null, note: document.getElementById('rap-note').value.trim() || null }); fermerFeuille(); } catch (e) { showToast('Erreur : ' + (e.message || e), 'error'); }
  rapCharger();
}
async function rapDepointer(id) {
  const { error } = await sb.from('lignes_bancaires').update({ statut: 'a_pointer', lien: null, note: null, pointe_par: null, pointe_le: null }).eq('id', id);
  if (error) return showToast('Erreur : ' + error.message, 'error');
  if (RAP.releve?.statut === 'rapproche') await sb.from('releves_bancaires').update({ statut: 'en_cours', rapproche_le: null }).eq('id', RAP.releve.id);
  fermerFeuille(); rapCharger();
}

// ─────────────────────────────────────────────── Vue admin : état de toutes les maisons
async function rapVueAdmin(boxId, listeMaisons) {
  const box = document.getElementById(boxId); if (!box) return;
  box.innerHTML = '<div class="skel" style="height:160px"></div>';
  const { data, error } = await sb.from('releves_bancaires').select('id,maison_id,annee,mois,statut');
  if (error) { box.innerHTML = `<p class="empty red">${escapeHtml(/releves_bancaires/.test(error.message) ? 'Tables du rapprochement absentes : exécutez le script SQL « rapprochement »' : error.message)}</p>`; return; }
  const { data: ap } = await sb.from('lignes_bancaires').select('releve_id').eq('statut', 'a_pointer');
  const reste = {}; (ap || []).forEach(x => reste[x.releve_id] = (reste[x.releve_id] || 0) + 1);
  const mois = rapMoisListe().slice().reverse();
  box.innerHTML = `<p class="small muted" style="margin:0 0 10px">✓ rapproché · nombre = lignes encore à pointer · — rien d'importé. Cliquez une case pour ouvrir le mois de la maison.</p>
    <div class="card card-flush"><div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Maison</th>${mois.map(([a, m]) => `<th scope="col" class="r">${MOIS[m - 1].slice(0, 4)}.${String(a).slice(2)}</th>`).join('')}</tr></thead><tbody>
    ${listeMaisons.map(mai => `<tr style="cursor:default"><td class="bold">${escapeHtml(mai.nom)}</td>${mois.map(([a, m]) => {
      const r = (data || []).find(x => x.maison_id === mai.id && x.annee === a && x.mois === m);
      const txt = !r ? '<span class="muted">—</span>' : r.statut === 'rapproche' ? '<b class="ok">✓</b>' : `<b class="warn">${reste[r.id] || '◐'}</b>`;
      return `<td class="r" style="cursor:pointer" onclick="rapAdminOuvrir('${mai.id}',${a},${m})">${txt}</td>`;
    }).join('')}</tr>`).join('')}
    </tbody></table></div></div>
    <div id="rap-admin-detail" style="margin-top:16px"></div>`;
}
function rapAdminOuvrir(maisonId, a, m) {
  const mai = (typeof maisons !== 'undefined' ? maisons : []).find(x => x.id === maisonId);
  RAP.annee = a; RAP.mois = m;
  document.getElementById('rap-admin-detail').innerHTML = `<h2 style="margin:0 0 8px">${escapeHtml(mai?.nom || 'Maison')}</h2><div id="rap-admin-box"></div>`;
  rapInit(maisonId, mai?.nom || '', 'rap-admin-box');
  document.getElementById('rap-admin-detail').scrollIntoView({ behavior: 'smooth' });
}
