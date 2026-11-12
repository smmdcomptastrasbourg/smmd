// SMMD - Configuration centralisée
window.SMMD_CONFIG = {
  url: "https://xccnnckuphxloxfrqtkf.supabase.co",
  key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjY25uY2t1cGh4bG94ZnJxdGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcxODA3NjEsImV4cCI6MjA4Mjc1Njc2MX0.1mIEhKfS5OSsaw78f1_Iatni39y8CoIurAd5IXP6n6g",
};

// Utilitaires partagés
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str)));
  return d.innerHTML;
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
function showPromptDouble(label1, label2, default2, onConfirm) {
  let modal = document.getElementById('smmd-prompt-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'smmd-prompt-modal';
    modal.innerHTML = `
      <div class="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onclick="closePromptDouble()"></div>
      <div class="relative bg-white rounded-[36px] w-full max-w-xs shadow-2xl p-8 mx-4">
        <h3 class="text-[13px] font-black uppercase tracking-widest text-slate-800 text-center mb-6">Export Excel</h3>
        <div class="space-y-4 mb-6">
          <div>
            <label id="smmd-prompt-label1" class="text-[9px] font-black uppercase text-slate-400 ml-2 mb-1 block tracking-widest"></label>
            <select id="smmd-prompt-val1" class="w-full p-3 bg-slate-50 rounded-xl font-bold text-sm outline-none border-none">
              <option value="01">Janvier</option><option value="02">Février</option><option value="03">Mars</option>
              <option value="04">Avril</option><option value="05">Mai</option><option value="06">Juin</option>
              <option value="07">Juillet</option><option value="08">Août</option><option value="09">Septembre</option>
              <option value="10">Octobre</option><option value="11">Novembre</option><option value="12">Décembre</option>
            </select>
          </div>
          <div>
            <label id="smmd-prompt-label2" class="text-[9px] font-black uppercase text-slate-400 ml-2 mb-1 block tracking-widest"></label>
            <select id="smmd-prompt-val2" class="w-full p-3 bg-slate-50 rounded-xl font-bold text-sm outline-none border-none"></select>
          </div>
        </div>
        <div class="flex gap-3">
          <button onclick="closePromptDouble()" class="flex-1 bg-slate-100 text-slate-600 font-black py-4 rounded-2xl uppercase text-[10px] tracking-widest">Annuler</button>
          <button onclick="confirmPromptDouble()" class="flex-1 bg-blue-900 text-white font-black py-4 rounded-2xl uppercase text-[10px] tracking-widest active:scale-95">Exporter</button>
        </div>
      </div>`;
    modal.className = 'fixed inset-0 z-[300] flex items-center justify-center';
    document.body.appendChild(modal);
  }

  document.getElementById('smmd-prompt-label1').innerText = label1;
  document.getElementById('smmd-prompt-label2').innerText = label2;

  // Remplir années
  const yearSel = document.getElementById('smmd-prompt-val2');
  yearSel.innerHTML = '';
  const now = new Date();
  for (let y = now.getFullYear(); y >= 2026; y--) {
    yearSel.innerHTML += `<option value="${y}" ${y == default2 ? 'selected' : ''}>${y}</option>`;
  }
  // Pré-sélectionner mois courant
  document.getElementById('smmd-prompt-val1').value = String(now.getMonth() + 1).padStart(2, '0');

  window._promptDoubleCallback = onConfirm;
  modal.classList.remove('hidden');
}

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

  // Appel à l'Edge Function Supabase — la clé Gemini reste côté serveur
  let res;
  try {
    res = await fetch(
      `${SMMD_CONFIG.url}/functions/v1/scan-ticket`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SMMD_CONFIG.key}`
        },
        body: JSON.stringify({ base64, mime })
      }
    );
  } catch (netErr) {
    throw new Error('Pas de connexion réseau. Vérifiez votre connexion et réessayez.');
  }

  const data = await res.json();

  if (!res.ok) {
    // Afficher le debug complet si disponible
    const msg = data._debug_raw
      ? `${data.error} | RAW: ${data._debug_raw}`
      : (data.error || `Erreur serveur (${res.status}). Réessayez.`);
    throw new Error(msg);
  }

  return data;
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
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
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

      // Repli sur l'ancien stockage
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
