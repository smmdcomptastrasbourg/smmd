// SMMD - Configuration centralisée
window.SMMD_CONFIG = {
  url: "https://xccnnckuphxloxfrqtkf.supabase.co",
  key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjY25uY2t1cGh4bG94ZnJxdGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcxODA3NjEsImV4cCI6MjA4Mjc1Njc2MX0.1mIEhKfS5OSsaw78f1_Iatni39y8CoIurAd5IXP6n6g"
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
