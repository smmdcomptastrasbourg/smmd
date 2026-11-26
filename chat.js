const sb = supabase.createClient(SMMD_CONFIG.url, SMMD_CONFIG.key);

let userProfile = null;
let allProfiles = [];
let conversations = [];
let filteredConvs = [];
let currentConvId = null;
let currentOtherId = null;
let currentOtherProfile = null;
let pendingMedia = null;
let realtimeSub = null;
let _confirmCallback = null;


// ── MARQUER LU ──
async function marquerLu(convId) {
    await sb.from('messages')
        .update({ lu: true })
        .eq('conversation_id', convId)
        .neq('sender_id', userProfile.id)
        .eq('lu', false);
}

// ── REALTIME ──
function souscriptionRealtime() {
    sb.channel('messages-global')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
            payload => {
                const msg = payload.new;
                if (msg.conversation_id === currentConvId) {
                    chargerMessages();
                    marquerLu(currentConvId);
                } else {
                    chargerConversations();
                    if (msg.sender_id !== userProfile.id) showToast('Nouveau message 💬', 'info');
                }
            })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' },
            () => { if (currentConvId) chargerMessages(); })
        .subscribe();
}

function souscriptionMessages(convId) {}


// ── MENU ACTION (appui long sur ses propres messages) ──
let _longPressTimer = null;
let _actionMsgId   = null;
let _actionMsgText = null;

function startLongPress(msgId) {
    _longPressTimer = setTimeout(() => {
        if (navigator.vibrate) navigator.vibrate(15);
        ouvrirActionMenu(msgId);
    }, 600);
}
function cancelLongPress() {
    clearTimeout(_longPressTimer);
}

function ouvrirActionMenu(msgId, msgText) {
    if (msgText === undefined) msgText = _msgTexts[msgId] || '';
    _actionMsgId   = msgId;
    _actionMsgText = msgText;
    const preview = document.getElementById('msg-action-preview');
    if (preview) preview.textContent = msgText || '(media)';
    const editBtn = document.getElementById('btn-edit-msg');
    if (editBtn) editBtn.style.display = msgText ? 'flex' : 'none';
    document.getElementById('msg-action-menu').style.display = 'block';
}
function fermerActionMenu() {
    document.getElementById('msg-action-menu').style.display = 'none';
    _actionMsgId = null;
}

function confirmerSuppressionMsg() {
    const id = _actionMsgId;
    fermerActionMenu();
    showConfirm('Supprimer ce message ?', async () => {
        await sb.from('messages')
            .update({ deleted_at: new Date().toISOString(), contenu: null, media_base64: null })
            .eq('id', id).eq('sender_id', userProfile.id);
    }, 'Supprimer', true);
}

// ── MODIFIER MESSAGE ──
function ouvrirEditionMsg() {
    const text = _actionMsgText;
    const id   = _actionMsgId;
    fermerActionMenu();
    _actionMsgId   = id;   // restore after fermerActionMenu nulled it
    _actionMsgText = text;
    const input = document.getElementById('edit-msg-input');
    if (input) input.value = text || '';
    document.getElementById('msg-edit-modal').style.display = 'block';
    if (input) input.focus();
}
function fermerEditionMsg() {
    document.getElementById('msg-edit-modal').style.display = 'none';
}
async function sauvegarderEditionMsg() {
    const input   = document.getElementById('edit-msg-input');
    const newText = input?.value.trim();
    if (!newText) { showToast('Le message ne peut pas être vide', 'warning'); return; }
    if (newText === _actionMsgText) { fermerEditionMsg(); return; }
    const { error } = await sb.from('messages')
        .update({ contenu: newText })
        .eq('id', _actionMsgId)
        .eq('sender_id', userProfile.id);
    if (error) { showToast('Erreur : ' + error.message, 'error'); return; }
    fermerEditionMsg();
    await chargerMessages();
    showToast('Message modifié ✓', 'success');
}

// ── INIT ──
async function init() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = 'index.html'; return; }

    const { data: profile } = await sb.from('profiles')
        .select('*').eq('id', user.id).maybeSingle();
    if (!profile) { window.location.href = 'index.html'; return; }
    if (!(await verifierCompteActif(profile))) return;
    userProfile = profile;
    document.getElementById('header-subtitle').textContent =
        `${profile.prenom} ${profile.nom || ''} · ${({ user: 'Membre', chef: 'Chef de maison', admin: 'Administrateur' })[profile.role] || ''}`;

    // Charger tous les profils (pour nouvelle conv)
    // Annuaire minimal (id, prénom, nom, rôle, maison) — sans données sensibles
    let { data: profiles, error: annErr } = await sb.rpc('annuaire');
    if (annErr || !profiles) {
        // repli si la fonction n'existe pas encore
        const r = await sb.from('profiles').select('id,prenom,nom,role,maison_id');
        profiles = r.data || [];
    }
    allProfiles = profiles
        .filter(p => p.id !== user.id && p.actif !== false)
        .sort((a, b) => (a.prenom || '').localeCompare(b.prenom || '', 'fr'));

    await chargerConversations();
    souscriptionRealtime();
}

// ── CONVERSATIONS ──
async function chargerConversations() {
    const { data } = await sb.from('conversations')
        .select('*')
        .or(`user1_id.eq.${userProfile.id},user2_id.eq.${userProfile.id}`)
        .order('last_message_at', { ascending: false });

    conversations = data || [];
    // Les noms viennent de l'annuaire (les profils d'autres maisons ne sont plus lisibles directement)
    const _inconnu = id => ({ id, prenom: 'Utilisateur', nom: '', role: '' });
    const _byId = id => id === userProfile.id ? userProfile : (allProfiles.find(p => p.id === id) || _inconnu(id));
    conversations.forEach(c => { c.user1 = _byId(c.user1_id); c.user2 = _byId(c.user2_id); });

    // Charger dernier message + nb non lus pour chaque conv
    for (const conv of conversations) {
        const { data: msgs } = await sb.from('messages')
            .select('contenu,type,created_at,lu,sender_id,deleted_at')
            .eq('conversation_id', conv.id)
            .order('created_at', { ascending: false })
            .limit(1);
        conv._lastMsg = msgs?.[0] || null;

        const { count } = await sb.from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('conversation_id', conv.id)
            .eq('lu', false)
            .neq('sender_id', userProfile.id)
            .is('deleted_at', null);
        conv._unread = count || 0;
    }

    filteredConvs = [...conversations];
    renderConversations();
}

function renderConversations() {
    const el = document.getElementById('conv-list');
    if (!filteredConvs.length) {
        el.innerHTML = `<div class="text-center py-16">
            <div class="text-5xl mb-3">💬</div>
            <p style="font-size:17px;font-weight:700;color:#1C1917;margin:0">Aucune conversation</p>
            <p style="font-size:15px;color:#57534E;margin:6px 0 0">Appuyez sur + pour écrire à quelqu'un</p>
        </div>`;
        return;
    }
    el.innerHTML = filteredConvs.map(conv => {
        const other = conv.user1_id === userProfile.id ? conv.user2 : conv.user1;
        const initials = escapeHtml(`${(other.prenom||'?')[0]}${(other.nom||'')[0]||''}`.toUpperCase());
        const lastMsg = conv._lastMsg;
        let lastText = 'Commencer la conversation';
        if (lastMsg) {
            if (lastMsg.deleted_at) lastText = '🚫 Message supprimé';
            else if (lastMsg.type === 'image') lastText = '📷 Image';
            else if (lastMsg.type === 'pdf') lastText = '📄 PDF';
            else lastText = lastMsg.contenu || '';
            if (lastText.length > 40) lastText = lastText.slice(0, 40) + '...';
        }
        const time = lastMsg ? formatTime(lastMsg.created_at) : '';
        const unread = conv._unread > 0;

        return `<div class="conv-item" onclick="ouvrirConversation('${escapeHtml(conv.id)}','${escapeHtml(other.id)}')">
            <div class="conv-avatar">${initials}</div>
            <div class="flex-1 min-w-0">
                <div class="flex justify-between items-center">
                    <span class="conv-name ${unread ? 'font-black' : ''}">${escapeHtml(other.prenom)} ${escapeHtml(other.nom||'')}</span>
                    <span class="conv-time ml-2">${time}</span>
                </div>
                <div class="flex justify-between items-center mt-0.5">
                    <span class="conv-last ${unread ? 'font-bold text-slate-700' : ''}">${escapeHtml(lastText)}</span>
                    ${unread ? `<span class="conv-badge ml-2">${conv._unread}</span>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');
}

function filterConversations(q) {
    if (!q.trim()) { filteredConvs = [...conversations]; }
    else {
        const sq = q.toLowerCase();
        filteredConvs = conversations.filter(conv => {
            const other = conv.user1_id === userProfile.id ? conv.user2 : conv.user1;
            return `${other.prenom} ${other.nom}`.toLowerCase().includes(sq);
        });
    }
    renderConversations();
}

// ── NOUVELLE CONVERSATION ──
function ouvrirNouvelleConv() {
    document.getElementById('new-conv-modal').classList.remove('hidden');
    document.getElementById('search-contacts').value = '';
    renderContacts(allProfiles);
}
function fermerNouvelleConv() {
    document.getElementById('new-conv-modal').classList.add('hidden');
}
function filterContacts(q) {
    const sq = q.toLowerCase();
    renderContacts(allProfiles.filter(p =>
        `${p.prenom} ${p.nom}`.toLowerCase().includes(sq)
    ));
}
function renderContacts(profiles) {
    const el = document.getElementById('contacts-list');
    if (!profiles.length) {
        el.innerHTML = '<p class="text-center text-slate-400 text-[12px] py-4">Aucun contact trouvé</p>';
        return;
    }
    const ROLES = { chef: '👑 Chef', admin: '⚙️ Admin', user: '👤 Membre' };
    el.innerHTML = profiles.map(p => {
        const initials = escapeHtml(`${(p.prenom||'?')[0]}${(p.nom||'')[0]||''}`.toUpperCase());
        return `<button class="new-conv-btn" onclick="demarrerConversation('${escapeHtml(p.id)}')">
            <div class="conv-avatar" style="width:38px;height:38px;font-size:14px;flex-shrink:0">${initials}</div>
            <div class="text-left">
                <p class="font-black text-[13px] text-slate-800">${escapeHtml(p.prenom)} ${escapeHtml(p.nom||'')}</p>
                <p class="text-[10px] text-slate-400 font-bold">${ROLES[p.role]||p.role}</p>
            </div>
        </button>`;
    }).join('');
}

async function demarrerConversation(otherId) {
    fermerNouvelleConv();
    // Chercher conv existante
    const existing = conversations.find(c =>
        (c.user1_id === userProfile.id && c.user2_id === otherId) ||
        (c.user2_id === userProfile.id && c.user1_id === otherId)
    );
    if (existing) {
        ouvrirConversation(existing.id, otherId);
        return;
    }
    // Créer nouvelle conv
    const u1 = userProfile.id < otherId ? userProfile.id : otherId;
    const u2 = userProfile.id < otherId ? otherId : userProfile.id;
    const { data, error } = await sb.from('conversations')
        .insert([{ user1_id: u1, user2_id: u2 }])
        .select().single();
    if (error) { showToast('Erreur création conversation', 'error'); return; }
    await chargerConversations();
    ouvrirConversation(data.id, otherId);
}

// ── OUVRIR CONVERSATION ──
async function ouvrirConversation(convId, otherId) {
    currentConvId = convId;
    currentOtherId = otherId;
    currentOtherProfile = allProfiles.find(p => p.id === otherId)
        || conversations.map(c => c.user1_id === otherId ? c.user1 : c.user2_id === otherId ? c.user2 : null).find(Boolean);

    const ROLES = { chef: 'Chef de maison', admin: 'Administrateur', user: 'Membre' };
    const initials = currentOtherProfile
        ? `${currentOtherProfile.prenom[0]}${(currentOtherProfile.nom||'')[0]||''}`.toUpperCase()
        : '?';

    document.getElementById('chat-avatar').textContent = initials;
    document.getElementById('chat-name').textContent =
        currentOtherProfile ? `${currentOtherProfile.prenom} ${currentOtherProfile.nom||''}` : '';
    document.getElementById('chat-role').textContent =
        currentOtherProfile ? ROLES[currentOtherProfile.role]||'' : '';

    document.getElementById('screen-chat').classList.add('active');
    document.getElementById('msg-input').focus();

    await chargerMessages();
    marquerLu(convId);
    souscriptionMessages(convId);
}

function retourListe() {
    document.getElementById('screen-chat').classList.remove('active');
    currentConvId = null;
    if (realtimeSub?.channel) {
        sb.removeChannel(realtimeSub.channel);
        realtimeSub = null;
    }
    chargerConversations();
}

function retourApp() {
    const from = localStorage.getItem('smmd_chat_from') || 'v2/index.html';
    window.location.href = from;
}

// ── MESSAGES ──
async function chargerMessages() {
    const list = document.getElementById('messages-list');
    list.innerHTML = `<div class="text-center py-8">
        <div class="w-6 h-6 border-2 border-slate-200 border-t-red-700 rounded-full animate-spin mx-auto"></div>
    </div>`;

    const { data } = await sb.from('messages')
        .select('*')
        .eq('conversation_id', currentConvId)
        .order('created_at', { ascending: true });

    renderMessages(data || []);
    scrollBas();
}

let _msgTexts = {};
// N'accepte qu'un data-URI image/PDF en base64 (empêche l'injection via media_base64)
function mediaSur(b64, type) {
    if (!b64 || typeof b64 !== 'string') return null;
    const re = type === 'pdf'
        ? /^data:application\/pdf;base64,[A-Za-z0-9+/=\s]+$/
        : /^data:image\/(png|jpe?g|gif|webp|heic|heif);base64,[A-Za-z0-9+/=\s]+$/;
    return re.test(b64) ? b64 : null;
}

function renderMessages(msgs) {
    _mediaCache = {}; // Reset cache
    _msgTexts = {};
    const list = document.getElementById('messages-list');
    if (!msgs.length) {
        list.innerHTML = `<div class="text-center py-12">
            <div class="text-4xl mb-3">👋</div>
            <p class="text-[12px] text-slate-400 font-bold">Commencez la conversation !</p>
        </div>`;
        return;
    }

    let html = '';
    let lastDate = '';

    msgs.forEach((msg, i) => {
        const isMine = msg.sender_id === userProfile.id;
        const date = new Date(msg.created_at);
        const dateStr = date.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });

        // Séparateur de date
        if (dateStr !== lastDate) {
            html += `<div class="date-sep"><span>${dateStr}</span></div>`;
            lastDate = dateStr;
        }

        const time = date.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
        const isDeleted = !!msg.deleted_at;

        // Stocker media dans cache pour onclick (uniquement de vraies données image/PDF)
        const mediaOk = mediaSur(msg.media_base64, msg.type);
        if (mediaOk) _mediaCache[msg.id] = mediaOk;

        // Contenu message
        let content = '';
        if (isDeleted) {
            content = `<span class="msg-deleted">🚫 Message supprimé</span>`;
        } else if (msg.type === 'image' && mediaOk) {
            content = `<img src="${mediaOk}" class="msg-img" onclick="_viewMedia('${escapeHtml(msg.id)}','image')" loading="lazy" alt="Image">`;
            if (msg.contenu) content += `<div style="margin-top:4px">${escapeHtml(msg.contenu)}</div>`;
        } else if (msg.type === 'pdf' && mediaOk) {
            content = `<div class="msg-pdf" onclick="_viewMedia('${escapeHtml(msg.id)}','pdf')">
                <span class="msg-pdf-icon">📄</span>
                <span class="msg-pdf-name">Document PDF — Appuyer pour télécharger</span>
            </div>`;
            if (msg.contenu) content += `<div style="margin-top:4px">${escapeHtml(msg.contenu)}</div>`;
        } else {
            content = escapeHtml(msg.contenu || '');
        }

        // Statut lecture
        let checks = '';
        if (isMine && !isDeleted) {
            const read = msg.lu;
            checks = `<span class="msg-check ${read ? 'read' : 'sent'}">✓✓</span>`;
        }

        // Long press pour supprimer (seulement ses propres messages)
        // Le texte n'est plus injecté dans les attributs : on le retrouve par l'id
        if (isMine && !isDeleted) _msgTexts[msg.id] = msg.type === 'text' ? (msg.contenu || '') : '';
        const idSafe = escapeHtml(msg.id);
        const onLongPress = isMine && !isDeleted
            ? `oncontextmenu="event.preventDefault();ouvrirActionMenu('${idSafe}')" ontouchstart="startLongPress('${idSafe}')" ontouchend="cancelLongPress()" ontouchmove="cancelLongPress()"`
            : '';

        html += `<div class="msg-row ${isMine ? 'mine' : 'other'} anim-slide" ${onLongPress}>
            <div class="msg-bubble">${content}</div>
            <div class="msg-meta">
                <span class="${isMine ? 'msg-time' : 'msg-time-other'}">${time}</span>
                ${checks}
            </div>
        </div>`;
    });

    list.innerHTML = html;
}

function scrollBas(smooth = false) {
    const list = document.getElementById('messages-list');
    list.scrollTo({ top: list.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
}

// ── ENVOYER MESSAGE ──
async function envoyerMessage() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text && !pendingMedia) return;

    const msg = {
        conversation_id: currentConvId,
        sender_id: userProfile.id,
        contenu: text || null,
        type: pendingMedia ? pendingMedia.type : 'text',
        media_base64: pendingMedia ? pendingMedia.base64 : null,
        media_mime: pendingMedia ? pendingMedia.mime : null,
    };

    input.value = '';
    input.style.height = 'auto';
    annulerMedia();

    const { error } = await sb.from('messages').insert([msg]);
    if (error) { showToast('Erreur envoi : ' + error.message, 'error'); return; }

    // Màj last_message_at
    await sb.from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', currentConvId);
}

// ── PIÈCE JOINTE ──
async function attacherFichier(input) {
    const file = input.files[0];
    if (!file) return;
    const MAX = 2 * 1024 * 1024; // 2MB max
    if (file.size > MAX) {
        showToast('Fichier trop lourd (max 2MB)', 'error');
        input.value = '';
        return;
    }

    const isPdf = file.type === 'application/pdf';
    const isImg = file.type.startsWith('image/');

    if (!isPdf && !isImg) {
        showToast('Format non supporté (image ou PDF uniquement)', 'error');
        input.value = '';
        return;
    }

    // Lire en base64
    const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

    pendingMedia = { type: isPdf ? 'pdf' : 'image', base64, mime: file.type, name: file.name };

    // Afficher preview
    const bar = document.getElementById('media-preview-bar');
    const thumb = document.getElementById('media-thumb-container');
    document.getElementById('media-name').textContent = file.name;
    document.getElementById('media-size').textContent = `${(file.size/1024).toFixed(0)} KB`;

    if (isImg) {
        thumb.innerHTML = `<img src="${base64}" class="media-thumb">`;
    } else {
        thumb.innerHTML = `<div class="media-pdf-thumb">📄</div>`;
    }
    bar.classList.remove('hidden');
    input.value = '';
}

function annulerMedia() {
    pendingMedia = null;
    document.getElementById('media-preview-bar').classList.add('hidden');
    document.getElementById('media-thumb-container').innerHTML = '';
}

// ── SUPPRIMER MESSAGE ──
let _mediaCache = {};

function _viewMedia(msgId, type) {
    const base64 = _mediaCache[msgId];
    if (!base64) { showToast('Media non disponible', 'error'); return; }
    if (type === 'image') voirImage(base64);
    else telechargerPDF(base64, 'document.pdf');
}


function souscriptionMessages(convId) {
    // Déjà géré par souscriptionRealtime
}

// ── TYPING INDICATOR ──
let _typingTimeout = null;
function envoyerTyping() {
    // Simple — pas de canal typing pour garder simple
}

// ── VIEWERS ──
function voirImage(base64) {
    document.getElementById('img-viewer-src').src = base64;
    document.getElementById('img-viewer').classList.remove('hidden');
}

function telechargerPDF(base64, name) {
    const b64 = base64.includes(',') ? base64.split(',')[1] : base64;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], {type:'application/pdf'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name || 'document.pdf';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── AUTO RESIZE TEXTAREA ──
function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ── FORMAT DATE ──
function formatTime(iso) {
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 86400000) return d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    if (diff < 604800000) return d.toLocaleDateString('fr-FR',{weekday:'short'});
    return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'});
}

// ── CONFIRM MODAL ──
function showConfirm(msg, onConfirm, label='Confirmer', danger=false) {
    _confirmCallback = onConfirm;
    document.getElementById('confirm-msg').textContent = msg;
    document.getElementById('confirm-icon').textContent = danger ? '⚠️' : '❓';
    const ok = document.getElementById('confirm-ok');
    ok.textContent = label;
    ok.className = `flex-1 ${danger?'bg-red-600':'bg-red-800'} text-white font-black py-4 rounded-2xl uppercase text-[10px] tracking-widest shadow-lg`;
    document.getElementById('confirm-modal').classList.remove('hidden');
}
function _confirmOk() {
    document.getElementById('confirm-modal').classList.add('hidden');
    if (_confirmCallback) { _confirmCallback(); _confirmCallback = null; }
}
function _confirmCancel() {
    document.getElementById('confirm-modal').classList.add('hidden');
    _confirmCallback = null;
}

// escapeHtml vient de config.js
init();
