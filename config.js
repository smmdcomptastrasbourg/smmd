// SMMD - Configuration centralisée
window.SMMD_CONFIG = {
  url: "https://xccnnckuphxloxfrqtkf.supabase.co",
  key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjY25uY2t1cGh4bG94ZnJxdGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcxODA3NjEsImV4cCI6MjA4Mjc1Njc2MX0.1mIEhKfS5OSsaw78f1_Iatni39y8CoIurAd5IXP6n6g",
  gemini_key: "AIzaSyC2bl2zL_deTWDSPfBy_5OgNjpZUFUQgcI"
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
// SCAN JUSTIFICATIF — Gemini Vision
// ============================================================
async function scanJustificatif(file) {
  // Redimensionner l'image si trop grande (max 1024px, améliore la vitesse)
  const base64 = await fileToBase64(file);

  // Déterminer le bon mime type
  let mime = file.type;
  if (!mime || mime === 'application/octet-stream') mime = 'image/jpeg';
  // Gemini ne supporte pas les PDF en inline_data — on avertit
  if (mime === 'application/pdf') {
    throw new Error('Les PDF ne sont pas encore supportés. Prenez une photo du document.');
  }

  const prompt = `Tu es un assistant comptable expert. Analyse ce justificatif de dépense (ticket de caisse, facture, reçu).
Extrais les informations et réponds UNIQUEMENT avec un JSON valide sur une seule ligne, sans markdown ni backticks :
{"montant":<nombre ex:29.90 ou null>,"date":"<YYYY-MM-DD ou null>","commentaire":"<commerce max 40 car ou null>","confiance":"<haute|moyenne|basse>"}
Règles : montant = total TTC final. Date du jour = ${new Date().toISOString().split('T')[0]}. Si incertain mets null.`;

  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: mime, data: base64 } },
        { text: prompt }
      ]
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
  };

  let res;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${SMMD_CONFIG.gemini_key}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
  } catch (netErr) {
    throw new Error('Pas de connexion réseau. Vérifiez votre connexion et réessayez.');
  }

  if (!res.ok) {
    const errBody = await res.text().catch(()=>'');
    if (res.status === 400) throw new Error('Image non reconnue. Essayez avec une photo plus nette et bien cadrée.');
    if (res.status === 403) throw new Error("Clé API invalide ou expirée. Contactez l'administrateur.");
    if (res.status === 429) throw new Error('Trop de requêtes. Attendez quelques secondes et réessayez.');
    throw new Error('Erreur API (' + res.status + '). Réessayez.');
  }

  const data = await res.json();

  // Extraire le texte de la réponse
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error('Réponse vide de Gemini. Réessayez avec une meilleure photo.');

  // Nettoyer : enlever markdown, espaces
  const clean = text.replace(/```json|```/gi, '').replace(/\n/g, ' ').trim();

  // Parser le JSON
  try {
    const parsed = JSON.parse(clean);
    // Normaliser le montant (virgule → point)
    if (typeof parsed.montant === 'string') {
      parsed.montant = parseFloat(parsed.montant.replace(',', '.')) || null;
    }
    return parsed;
  } catch {
    // Tenter d'extraire un JSON partiel avec regex
    const match = clean.match(/\{[^}]+\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    throw new Error('Impossible de lire le ticket. Essayez avec une photo plus nette, bien éclairée et droite.');
  }
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
