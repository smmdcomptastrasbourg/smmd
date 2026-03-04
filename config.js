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
