// SMMD - Configuration centralisée
window.SMMD_CONFIG = {
  url: "https://xccnnckuphxloxfrqtkf.supabase.co",
  key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjY25uY2t1cGh4bG94ZnJxdGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcxODA3NjEsImV4cCI6MjA4Mjc1Njc2MX0.1mIEhKfS5OSsaw78f1_Iatni39y8CoIurAd5IXP6n6g",
};

// Utilitaires partagés
// Échappe aussi les guillemets : la valeur peut être placée dans un attribut HTML
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function validateIban(iban) {
  if (!iban) return false;
  const cleaned = iban.replace(/\s/g, '').toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(cleaned);
}

function normalizeIban(iban) {
  return iban.replace(/\s/g, '').toUpperCase();
}

function showToast(message, type = 'info') {
  const existing = document.getElementById('smmd-toast');
  if (existing) existing.remove();
  const colors = {
    success: 'bg-emerald-500',
    error: 'bg-red-500',
    info: 'bg-blue-900',
    warning: 'bg-orange-500'
  };
  const toast = document.createElement('div');
  toast.id = 'smmd-toast';
  toast.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-[999] ${colors[type] || colors.info} text-white px-6 py-4 rounded-2xl shadow-2xl font-black text-[11px] uppercase tracking-widest transition-all duration-300 flex items-center gap-3 max-w-sm text-center`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, 20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ============================================================
// MODAL CONFIRM — remplace window.confirm()
// ============================================================
let _confirmResolve = null;

function showConfirm(message, onConfirm, confirmLabel = 'Confirmer', danger = false) {
  let modal = document.getElementById('smmd-confirm-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'smmd-confirm-modal';
    modal.innerHTML = `
      <div class="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onclick="closeConfirm()"></div>
      <div class="relative bg-white rounded-[36px] w-full max-w-xs shadow-2xl p-8 mx-4">
        <p id="smmd-confirm-msg" class="text-[13px] font-bold text-slate-700 text-center leading-relaxed mb-7"></p>
        <div class="flex gap-3">
          <button onclick="closeConfirm()" class="flex-1 bg-slate-100 text-slate-600 font-black py-4 rounded-2xl uppercase text-[10px] tracking-widest hover:bg-slate-200 transition-all">Annuler</button>
          <button id="smmd-confirm-ok" class="flex-1 font-black py-4 rounded-2xl uppercase text-[10px] tracking-widest active:scale-95 transition-all"></button>
        </div>
      </div>`;
    modal.className = 'fixed inset-0 z-[300] flex items-center justify-center';
    document.body.appendChild(modal);
  }
  document.getElementById('smmd-confirm-msg').innerText = message;
  const okBtn = document.getElementById('smmd-confirm-ok');
  okBtn.innerText = confirmLabel;
  okBtn.className = `flex-1 font-black py-4 rounded-2xl uppercase text-[10px] tracking-widest active:scale-95 transition-all text-white ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-900 hover:bg-blue-800'}`;
  okBtn.onclick = () => { closeConfirm(); onConfirm(); };
  modal.classList.remove('hidden');
}

function closeConfirm() {
  const modal = document.getElementById('smmd-confirm-modal');
  if (modal) modal.classList.add('hidden');
}

// ============================================================
// MODAL PROMPT — remplace window.prompt()
// ============================================================
function confirmPromptDouble() {
  const v1 = document.getElementById('smmd-prompt-val1').value;
  const v2 = document.getElementById('smmd-prompt-val2').value;
  closePromptDouble();
  if (window._promptDoubleCallback) window._promptDoubleCallback(v1, v2);
}

function closePromptDouble() {
  const modal = document.getElementById('smmd-prompt-modal');
  if (modal) modal.classList.add('hidden');
}

// ============================================================
// SCAN JUSTIFICATIF — via Edge Function Supabase (clé cachée côté serveur)
// ============================================================
async function scanJustificatif(file) {
  // Redimensionner l'image avant envoi
  const base64 = await fileToBase64(file);

  let mime = file.type;
  if (!mime || mime === 'application/octet-stream') mime = 'image/jpeg';
  // PDF non supporté — l'UI ne propose plus cette option

  // Appel à l'Edge Function Supabase — la clé Gemini reste côté serveur.
  // On envoie le jeton de session de l'utilisateur connecté (et non la clé publique)
  // pour que la fonction puisse refuser les appels anonymes.
  let token = SMMD_CONFIG.key;
  try {
    if (typeof sb !== 'undefined') {
      const { data: { session } } = await sb.auth.getSession();
      if (session?.access_token) token = session.access_token;
    }
  } catch (e) { /* on garde la clé publique en repli */ }

  let res;
  try {
    res = await fetch(
      `${SMMD_CONFIG.url}/functions/v1/scan-ticket`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SMMD_CONFIG.key,
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ base64, mime })
      }
    );
  } catch (netErr) {
    throw new Error('Pas de connexion réseau. Vérifiez votre connexion et réessayez.');
  }

  let data = {};
  try { data = await res.json(); } catch (e) { /* réponse non JSON */ }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('Session expirée — reconnectez-vous.');
    throw new Error(data.error || `Format non supporté ou image illisible (erreur ${res.status}). Essayez avec une photo plus nette.`);
  }

  return data;
}

// ============================================================
// LECTURE COMPLÈTE (au-delà de la limite de 1000 lignes de Supabase)
// buildQuery doit renvoyer une requête NEUVE à chaque appel.
// ============================================================
async function fetchAll(buildQuery) {
  const out = [], size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await buildQuery().range(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

// Bornes ISO d'un mois (heure locale) — pour filtrer côté serveur
function bornesMois(annee, mois) {
  const a = parseInt(annee), m = parseInt(mois);
  return { debut: new Date(a, m - 1, 1).toISOString(), fin: new Date(a, m, 1).toISOString() };
}
function bornesAnnee(annee) {
  const a = parseInt(annee);
  return { debut: new Date(a, 0, 1).toISOString(), fin: new Date(a + 1, 0, 1).toISOString() };
}

// Date saisie (AAAA-MM-JJ) -> horodatage stocké, et inverse, sans décalage de fuseau
function dateSaisieVersISO(d) { return new Date(d + 'T12:00:00').toISOString(); }
function isoVersDateSaisie(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso).split('T')[0];
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ============================================================
// RÈGLES MÉTIER PARTAGÉES
// ============================================================
const estPerso = m => !!m && String(m).startsWith('perso_');

// Statut après modification d'une opération :
// une dépense déjà remboursée reste « valide » tant qu'elle reste « à rembourser ».
function statutApresEdition(ancien, type, methode) {
  if (type !== 'depense' || !estPerso(methode)) return 'valide';
  if (estPerso(ancien?.methode_paiement)) return ancien.statut || 'attente';
  return 'attente';
}

// Allocation comptée dans les soldes uniquement quand le chef l'a confirmée
// (les lignes antérieures sans statut sont considérées confirmées)
const allocConfirmee = a => (a.statut || 'confirme') === 'confirme';

// Ensemble des ids de transactions qui ont au moins une photo en base
async function idsAvecJustif(ids) {
  const set = new Set();
  const uniques = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < uniques.length; i += 150) {
    const { data, error } = await sb.from('justificatifs_images')
      .select('transaction_id').in('transaction_id', uniques.slice(i, i + 150));
    if (error) throw new Error(error.message);
    (data || []).forEach(r => set.add(r.transaction_id));
  }
  return set;
}
const aJustif = (t, set) => !!(t.justificatif_url || (set && set.has(t.id)));

// ============================================================
// JUSTIFICATIFS — stockage base64 dans justificatifs_images
// ============================================================
async function resizeImageToBase64(file) {
  if (file.type === 'application/pdf') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Impossible de lire le PDF'));
      reader.readAsDataURL(file);
    });
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 1200;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else       { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Impossible de lire l'image (format non pris en charge ?)")); };
    img.src = url;
  });
}

// Remplace les photos d'une transaction. Les nouvelles sont insérées AVANT
// la suppression des anciennes : en cas d'échec, l'ancien justificatif est conservé.
async function sauvegarderImagesJustificatif(txId, photos) {
  const files = (photos || []).filter(Boolean);
  if (!files.length) return;
  const { data: anciennes } = await sb.from('justificatifs_images').select('id').eq('transaction_id', txId);
  const inserts = [];
  for (let i = 0; i < files.length; i++) {
    const b64 = typeof files[i] === 'string' ? files[i] : await resizeImageToBase64(files[i]);
    const mime = (b64.match(/^data:([^;]+);/) || [])[1] || 'image/jpeg';
    inserts.push({ transaction_id: txId, ordre: i, base64: b64, mime_type: mime });
  }
  const { error } = await sb.from('justificatifs_images').insert(inserts);
  if (error) throw new Error('Justificatif non enregistré : ' + error.message);
  const ids = (anciennes || []).map(r => r.id);
  if (ids.length) await sb.from('justificatifs_images').delete().in('id', ids);
}

async function chargerImagesJustificatif(txId) {
  const { data, error } = await sb.from('justificatifs_images')
    .select('base64, mime_type, ordre')
    .eq('transaction_id', txId)
    .order('ordre', { ascending: true });
  if (error) { showToast('Erreur de lecture du justificatif', 'error'); return []; }
  return data || [];
}

function detectMimeType(base64, declaredMime) {
  if (!base64) return declaredMime || 'image/jpeg';
  const header = base64.substring(0, 40);
  if (header.includes('data:application/pdf') || header.startsWith('JVBER')) return 'application/pdf';
  if (header.includes('data:image/png') || header.startsWith('iVBOR')) return 'image/png';
  if (header.includes('data:image/jpeg') || header.startsWith('/9j/')) return 'image/jpeg';
  return declaredMime || 'image/jpeg';
}
function getExtFromMime(mime) {
  if (mime?.includes('pdf')) return 'pdf';
  if (mime?.includes('png')) return 'png';
  return 'jpg';
}
function telechargerJustificatif(img) {
  const mime = detectMimeType(img.base64, img.mime_type);
  const ext = getExtFromMime(mime);
  const b64 = img.base64.includes(',') ? img.base64.split(',')[1] : img.base64;
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = `justificatif_${Date.now()}.${ext}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) {
    showToast('Téléchargement impossible : fichier illisible', 'error');
  }
}

// Vérifie que le compte connecté est actif ; sinon déconnexion
async function verifierCompteActif(profile) {
  if (profile && profile.actif === false) {
    try { await sb.auth.signOut(); } catch (e) {}
    window.location.href = 'index.html?desactive=1';
    return false;
  }
  return true;
}

// Convertir fichier en base64 avec redimensionnement optionnel
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (file.type.startsWith('image/')) {
      // Redimensionner via canvas pour alléger l'envoi
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const MAX = 1600;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else       { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        // JPEG qualité 0.85 pour réduire la taille
        const b64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
        resolve(b64);
      };
      img.onerror = () => reject(new Error("Impossible de lire l'image."));
      img.src = url;
    } else {
      // Autres formats (PDF) : lecture directe
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result.split(',')[1]);
      reader.onerror = () => reject(new Error("Erreur lecture fichier."));
      reader.readAsDataURL(file);
    }
  });
}


// ════════════════════════════════════════════════════════════
// EXPORT DES JUSTIFICATIFS (partagé chef + admin)
// ════════════════════════════════════════════════════════════
window.SMMD_EXPORT = (function () {
  const MOIS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

  function slug(s, fallback) {
    const r = String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    return r || fallback || 'x';
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function dateISO(t) {
    const d = new Date(t.created_at);
    return isNaN(d) ? '0000-00-00' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // Vrai type d'après le contenu (magic bytes en base64), sinon type déclaré
  function detect(b64, declared) {
    const h = (b64 || '').slice(0, 16);
    if (h.startsWith('JVBER')) return { ext: 'pdf', mime: 'application/pdf' };
    if (h.startsWith('iVBOR')) return { ext: 'png', mime: 'image/png' };
    if (h.startsWith('/9j/'))  return { ext: 'jpg', mime: 'image/jpeg' };
    if (h.startsWith('R0lGOD')) return { ext: 'gif', mime: 'image/gif' };
    if (h.startsWith('UklGR')) return { ext: 'webp', mime: 'image/webp' };
    const d = (declared || '').toLowerCase();
    if (d.includes('pdf'))  return { ext: 'pdf', mime: 'application/pdf' };
    if (d.includes('png'))  return { ext: 'png', mime: 'image/png' };
    if (d.includes('webp')) return { ext: 'webp', mime: 'image/webp' };
    if (d.includes('heic')) return { ext: 'heic', mime: 'image/heic' };
    return { ext: 'jpg', mime: 'image/jpeg' };
  }

  function cleanB64(raw) {
    if (!raw) return '';
    let s = String(raw);
    const i = s.indexOf('base64,');
    if (i !== -1) s = s.slice(i + 7);
    return s.replace(/\s+/g, '');
  }

  // Décodage strict : lève une erreur si le base64 est invalide (évite de casser tout le ZIP)
  function b64ToBytes(b64) {
    let s = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    if (!u.length) throw new Error('fichier vide');
    return u;
  }

  // Lecture complète d'une requête (contourne la limite de 1000 lignes)
  async function fetchAll(buildQuery) {
    const out = [], size = 1000;
    for (let from = 0; ; from += size) {
      const { data, error } = await buildQuery().range(from, from + size - 1);
      if (error) throw new Error(error.message);
      out.push(...(data || []));
      if (!data || data.length < size) break;
    }
    return out;
  }

  async function withRetry(fn, tries) {
    let last;
    for (let i = 0; i < (tries || 3); i++) {
      try { return await fn(); } catch (e) { last = e; await new Promise(r => setTimeout(r, 400 * (i + 1))); }
    }
    throw last;
  }

  // Images d'un lot de transactions : { txId: [rows] }
  async function chargerImages(sb, ids, onProgress) {
    const map = {}, errors = [];
    const CH = 8;
    for (let i = 0; i < ids.length; i += CH) {
      const lot = ids.slice(i, i + CH);
      try {
        const rows = await withRetry(async () => {
          const { data, error } = await sb.from('justificatifs_images')
            .select('transaction_id, ordre, base64, mime_type')
            .in('transaction_id', lot).order('ordre', { ascending: true });
          if (error) throw new Error(error.message);
          return data || [];
        });
        rows.forEach(r => (map[r.transaction_id] = map[r.transaction_id] || []).push(r));
      } catch (e) {
        // repli : une requête par transaction
        for (const id of lot) {
          try {
            const rows = await withRetry(async () => {
              const { data, error } = await sb.from('justificatifs_images')
                .select('transaction_id, ordre, base64, mime_type')
                .eq('transaction_id', id).order('ordre', { ascending: true });
              if (error) throw new Error(error.message);
              return data || [];
            });
            map[id] = rows;
          } catch (e2) { errors.push(`Lecture impossible (${id.slice(0, 8)}) : ${e2.message}`); }
        }
      }
      if (onProgress) onProgress(Math.min(i + CH, ids.length), ids.length);
    }
    return { map, errors };
  }

  // Ancien stockage : fichier public du bucket via justificatif_url
  async function telechargerUrl(url) {
    let blob = null;
    try {
      const res = await fetch(url);
      if (res.ok) blob = await res.blob();
    } catch (e) {}
    if (!blob) {
      const m = String(url).match(/\/object\/(?:public|sign|authenticated)\/justificatifs\/([^?]+)/);
      if (!m || typeof sb === 'undefined') throw new Error('fichier inaccessible');
      const { data, error } = await sb.storage.from('justificatifs').download(decodeURIComponent(m[1]));
      if (error || !data) throw new Error(error?.message || 'fichier introuvable');
      blob = data;
    }
    const m = (url.split('?')[0].match(/\.([a-zA-Z0-9]{2,4})$/) || [])[1];
    let ext = m ? m.toLowerCase().replace('jpeg', 'jpg') : null;
    if (!ext) ext = blob.type.includes('pdf') ? 'pdf' : blob.type.includes('png') ? 'png' : 'jpg';
    return { blob, ext };
  }

  /**
   * opts: {
   *   sb, txs, JSZip,
   *   dossier: tx => 'Chemin/du/dossier' ('' = racine),
   *   nomZip: 'xxx.zip',
   *   onProgress: (texte, pct) => {}
   * }
   * Ne s'arrête jamais sur une erreur isolée ; produit LISEZMOI.txt + index.csv
   */
  async function exporterJustificatifs(opts) {
    const { sb, txs, dossier, nomZip, onProgress } = opts;
    const Z = opts.JSZip || window.JSZip;
    if (!Z) throw new Error('JSZip non chargé');
    const prog = (t, p) => { if (onProgress) onProgress(t, p); };

    const zip = new Z();
    const used = new Set();
    const index = [['Date', 'Dossier', 'Motif', 'Montant', 'Commentaire', 'Fichier', 'Statut']];
    const problemes = [];
    let nbFichiers = 0, nbSans = 0;

    prog('Lecture des justificatifs...', 10);
    const ids = txs.map(t => t.id);
    const { map, errors } = await chargerImages(sb, ids, (n, tot) => prog(`Lecture ${n} / ${tot}...`, 10 + (n / Math.max(tot, 1)) * 40));
    problemes.push(...errors);

    let done = 0;
    for (const t of txs) {
      const dir = (dossier ? dossier(t) : '') || '';
      const base = `${dateISO(t)}_${slug(t.motif, 'depense')}_${parseFloat(t.montant || 0).toFixed(2).replace('.', '-')}EUR_${String(t.id).slice(0, 8)}`;
      const rows = map[t.id] || [];
      let nbTx = 0;

      for (let i = 0; i < rows.length; i++) {
        try {
          const b64 = cleanB64(rows[i].base64);
          if (!b64) throw new Error('contenu vide');
          const bytes = b64ToBytes(b64);
          const { ext } = detect(b64, rows[i].mime_type);
          const suffix = rows.length > 1 ? `_${i + 1}` : '';
          let nom = `${base}${suffix}.${ext}`, k = 2;
          while (used.has(dir + '/' + nom)) nom = `${base}${suffix}_${k++}.${ext}`;
          used.add(dir + '/' + nom);
          zip.file((dir ? dir + '/' : '') + nom, bytes);
          index.push([dateISO(t), dir, t.motif || '', t.montant, t.commentaire || '', (dir ? dir + '/' : '') + nom, 'OK']);
          nbFichiers++; nbTx++;
        } catch (e) {
          problemes.push(`Image ${i + 1} de la dépense ${base} illisible : ${e.message}`);
        }
      }

      // Repli 1 : ancienne colonne transactions.justificatif_base64
      if (nbTx === 0) {
        try {
          const { data } = await sb.from('transactions').select('justificatif_base64').eq('id', t.id).maybeSingle();
          const b64 = cleanB64(data?.justificatif_base64);
          if (b64) {
            const bytes = b64ToBytes(b64);
            const { ext } = detect(b64, (String(data.justificatif_base64).match(/^data:([^;]+);/) || [])[1]);
            let nom = `${base}.${ext}`, k = 2;
            while (used.has(dir + '/' + nom)) nom = `${base}_${k++}.${ext}`;
            used.add(dir + '/' + nom);
            zip.file((dir ? dir + '/' : '') + nom, bytes);
            index.push([dateISO(t), dir, t.motif || '', t.montant, t.commentaire || '', (dir ? dir + '/' : '') + nom, 'OK (ancienne colonne)']);
            nbFichiers++; nbTx++;
          }
        } catch (e) {
          problemes.push(`Ancien justificatif (colonne) illisible pour ${base} : ${e.message}`);
        }
      }

      // Repli 2 : ancien fichier du bucket
      if (nbTx === 0 && t.justificatif_url) {
        try {
          const { blob, ext } = await withRetry(() => telechargerUrl(t.justificatif_url), 2);
          let nom = `${base}.${ext}`, k = 2;
          while (used.has(dir + '/' + nom)) nom = `${base}_${k++}.${ext}`;
          used.add(dir + '/' + nom);
          zip.file((dir ? dir + '/' : '') + nom, blob);
          index.push([dateISO(t), dir, t.motif || '', t.montant, t.commentaire || '', (dir ? dir + '/' : '') + nom, 'OK (ancien stockage)']);
          nbFichiers++; nbTx++;
        } catch (e) {
          problemes.push(`Ancien justificatif introuvable pour ${base} : ${e.message}`);
        }
      }

      if (nbTx === 0) {
        nbSans++;
        index.push([dateISO(t), dir, t.motif || '', t.montant, t.commentaire || '', '', 'SANS JUSTIFICATIF']);
      }
      done++;
      prog(`Préparation ${done} / ${txs.length}...`, 50 + (done / Math.max(txs.length, 1)) * 35);
    }

    const csv = '﻿' + index.map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
    zip.file('index.csv', csv);
    zip.file('LISEZMOI.txt',
      `Export des justificatifs SMMD\r\n` +
      `Généré le ${new Date().toLocaleString('fr-FR')}\r\n\r\n` +
      `Dépenses : ${txs.length}\r\n` +
      `Fichiers exportés : ${nbFichiers}\r\n` +
      `Dépenses sans justificatif : ${nbSans}\r\n` +
      `Problèmes : ${problemes.length}\r\n` +
      (problemes.length ? '\r\n' + problemes.map(p => '- ' + p).join('\r\n') + '\r\n' : '') +
      `\r\nLe fichier index.csv liste chaque dépense avec son fichier.\r\n`);

    prog('Compression...', 90);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 }, streamFiles: true });
    prog('Téléchargement...', 98);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nomZip;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return { nbFichiers, nbSans, problemes: problemes.length, total: txs.length };
  }

  return { MOIS_FR, slug, dateISO, detect, cleanB64, fetchAll, exporterJustificatifs };
})();

// ════════════════════════════════════════════════════════════
// JOURNAL D'ERREURS — enregistre les pannes rencontrées par les
// utilisateurs dans la table erreurs_app (lisible par l'admin).
// Aucune donnée privée : montants, emails, IBAN et chiffres longs sont masqués.
// ════════════════════════════════════════════════════════════
window.SMMD_VERSION = '2026-11-26c';
(function () {
  const MAX_PAR_SESSION = 25;
  let envoyes = 0;
  const recents = {};
  let derniereAction = '';

  function masquer(txt) {
    return String(txt == null ? '' : txt)
      .replace(/[A-Z]{2}\d{2}[A-Z0-9 ]{11,40}/g, '[IBAN]')
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
      .replace(/\d+(?:[  ]\d{3})*(?:[.,]\d{1,2})?\s?€/g, '[montant]')
      .replace(/\b\d{5,}\b/g, '[nombre]')
      .slice(0, 500);
  }
  function appareil() {
    const ua = navigator.userAgent || '';
    let os = /iPhone|iPad|iPod/.test(ua) ? 'iOS ' + ((ua.match(/OS (\d+)_(\d+)/) || []).slice(1).join('.') || '?')
           : /Android/.test(ua) ? 'Android ' + ((ua.match(/Android ([\d.]+)/) || [])[1] || '?')
           : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Autre';
    const nav = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
              : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox'
              : /Safari\//.test(ua) ? 'Safari' : 'Autre';
    const pwa = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone ? ' · app installée' : '';
    return `${os} · ${nav}${pwa}`;
  }

  async function signaler(type, message, detail) {
    try {
      if (envoyes >= MAX_PAR_SESSION || !message) return;
      const cle = type + '|' + String(message).slice(0, 120);
      if (recents[cle] && Date.now() - recents[cle] < 60000) return;
      recents[cle] = Date.now(); envoyes++;
      if (typeof sb === 'undefined' || !navigator.onLine) return;
      let uid = null, role = null;
      try {
        const { data: { session } } = await sb.auth.getSession();
        uid = session?.user?.id || null;
        if (typeof userProfile !== 'undefined' && userProfile) role = userProfile.role || null;
      } catch (e) {}
      await sb.from('erreurs_app').insert([{
        user_id: uid, role, type,
        page: (location.pathname.split('/').pop() || 'index.html').slice(0, 60),
        action: masquer(derniereAction).slice(0, 120),
        message: masquer(message),
        detail: masquer(detail || '').slice(0, 1500),
        appareil: appareil(),
        version: window.SMMD_VERSION,
        en_ligne: navigator.onLine
      }]);
    } catch (e) { /* le journal ne doit jamais casser l'app */ }
  }
  window.smmdSignaler = signaler;

  // Dernière action de l'utilisateur (libellé du bouton touché)
  document.addEventListener('click', e => {
    const el = e.target && e.target.closest && e.target.closest('button, a, [onclick]');
    if (!el) return;
    derniereAction = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }, { capture: true, passive: true });

  window.addEventListener('error', e => {
    if (e.target && e.target !== window && (e.target.src || e.target.href)) {
      const src = e.target.src || e.target.href;
      if (/supabase-js|tailwind|config\.js|user\.js|chef\.js|admin\.js|chat\.js|xlsx|jszip/.test(src)) signaler('chargement', 'Fichier non chargé : ' + src.split('/').pop().split('?')[0]);
      return;
    }
    signaler('js', e.message || 'Erreur JavaScript', (e.filename || '').split('/').pop() + ':' + (e.lineno || '') + ':' + (e.colno || '') + '\n' + (e.error?.stack || ''));
  }, true);
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    signaler('promesse', (r && (r.message || r.error_description)) || String(r), r?.stack || '');
  });

  // Toute erreur affichée à l'utilisateur est aussi journalisée
  const _toast = window.showToast;
  if (typeof _toast === 'function') {
    window.showToast = function (message, type) {
      if (type === 'error') signaler('message', message);
      return _toast.apply(this, arguments);
    };
  }
})();
