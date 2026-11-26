        const sb = supabase.createClient(SMMD_CONFIG.url, SMMD_CONFIG.key);
        let allMaisonsCache = [];

        // Offline
        window.addEventListener('offline', ()=>document.getElementById('offline-banner').classList.remove('hidden'));
        window.addEventListener('online',  ()=>document.getElementById('offline-banner').classList.add('hidden'));

        // Compact nav
        new IntersectionObserver(([e]) => {
            const compact = !e.isIntersecting;
            const exp = document.getElementById('nav-expanded');
            const cmp = document.getElementById('nav-compact');
            const nav = document.getElementById('main-nav');
            exp.style.maxHeight = compact ? '0'    : '300px';
            exp.style.opacity   = compact ? '0'    : '1';
            cmp.classList.toggle('hidden', !compact);
            nav.style.paddingTop    = compact ? '14px' : '24px';
            nav.style.paddingBottom = compact ? '14px' : '20px';
            nav.style.borderRadius  = compact ? '0 0 20px 20px' : '0 0 40px 40px';
        }, { threshold:0 }).observe(document.getElementById('scroll-sentinel'));

        function switchTab(name, btn) {
            document.querySelectorAll('.section-panel').forEach(s=>s.classList.remove('active'));
            document.getElementById('section-'+name).classList.add('active');
            document.querySelectorAll('.bar-btn').forEach(b=>b.classList.remove('active'));
            btn.classList.add('active');
            window.scrollTo({top:0,behavior:'smooth'});
        }

        async function init() {
            const { data: { session } } = await sb.auth.getSession();
            if (!session) { window.location.href='index.html'; return; }
            const { data: me } = await sb.from('profiles').select('role,actif').eq('id', session.user.id).maybeSingle();
            if (!me || me.role !== 'admin') { window.location.href='index.html'; return; }
            if (!(await verifierCompteActif(me))) return;
            const now = new Date();
            document.getElementById('export-month').value = String(now.getMonth()+1).padStart(2,'0');
            const ySel = document.getElementById('export-year');
            for (let y=now.getFullYear(); y>=2026; y--) ySel.innerHTML+=`<option value="${y}">${y}</option>`;
            await loadMaisons();
            await loadUsers();
            await loadMotifs();
            compterErreurs();
        }

        async function loadMaisons() {
            const {data,error}=await sb.from('maisons').select('*').order('nom');
            if(error||!data){ showToast("Erreur chargement maisons","error"); return; }
            allMaisonsCache=data;
            document.getElementById('export-maison').innerHTML=
                `<option value="all">Toutes les maisons</option>`+
                data.map(m=>`<option value="${escapeHtml(m.id)}">${escapeHtml(m.nom)}</option>`).join('');
            document.getElementById('user-maison').innerHTML=
                data.filter(m=>m.nom!=='ADMINISTRATION')
                    .map(m=>`<option value="${escapeHtml(m.id)}">${escapeHtml(m.nom)}</option>`).join('');
            document.getElementById('maisons-list').innerHTML=data.map(m=>`
                <div class="flex justify-between items-center p-3.5 bg-slate-50 rounded-2xl">
                    <span class="text-[11px] font-black uppercase italic text-slate-700">${escapeHtml(m.nom)}</span>
                    <button onclick="deleteMaison('${escapeHtml(m.id)}')" class="text-red-300 hover:text-red-500 font-black text-sm transition-colors" aria-label="Supprimer">✕</button>
                </div>`).join('');
        }

        async function loadUsers() {
            const {data:users,error}=await sb.from('profiles').select('*, maisons(id,nom)').order('prenom');
            if(error||!users){ showToast("Erreur chargement membres","error"); return; }
            users.sort((a,b)=>(a.actif===false)-(b.actif===false));
            document.getElementById('users-list').innerHTML=users.map((u,i)=>`
                <div class="bg-white p-5 rounded-[26px] border border-slate-100 shadow-sm anim-slide ${u.actif===false?'opacity-50':''}" style="animation-delay:${i*.03}s">
                    <div class="flex items-center gap-3 mb-4">
                        <div class="w-9 h-9 rounded-full bg-red-900 text-white flex items-center justify-center font-black text-xs italic flex-shrink-0">
                            ${escapeHtml((u.prenom||'?')[0])}${escapeHtml((u.nom||'?')[0])}
                        </div>
                        <div class="min-w-0 flex-1">
                            <p class="text-[12px] font-black uppercase text-slate-800 truncate">${escapeHtml(u.prenom||'')} ${escapeHtml(u.nom||'')}${u.actif===false?' · <span class="text-red-500">désactivé</span>':''}</p>
                            <p class="text-[9px] text-slate-400 font-bold lowercase truncate">${escapeHtml(u.email||u.id)}</p>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="resetPassword('${escapeHtml(u.email||'')}')" title="Reset mdp" class="bg-red-50 text-red-600 w-8 h-8 rounded-xl flex items-center justify-center text-sm hover:bg-blue-100 transition-all">🔑</button>
                            <button onclick="basculerActif('${escapeHtml(u.id)}', ${u.actif===false})" title="${u.actif===false?'Réactiver':'Désactiver'}" class="${u.actif===false?'bg-emerald-50 text-emerald-600 hover:bg-emerald-100':'bg-red-50 text-red-400 hover:bg-red-100'} w-8 h-8 rounded-xl flex items-center justify-center font-black transition-all" aria-label="${u.actif===false?'Réactiver le compte':'Désactiver le compte'}">${u.actif===false?'↺':'⏻'}</button>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-2 mb-3">
                        <div class="relative">
                            <select onchange="updateUserMaison('${escapeHtml(u.id)}',this.value)"
                                class="w-full bg-slate-50 p-3 rounded-xl text-[10px] font-bold uppercase outline-none appearance-none border border-slate-100">
                                ${allMaisonsCache.map(m=>`<option value="${escapeHtml(m.id)}" ${u.maison_id===m.id?'selected':''}>${escapeHtml(m.nom)}</option>`).join('')}
                            </select>
                        </div>
                        <div class="relative">
                            <select onchange="updateUserRole('${escapeHtml(u.id)}',this.value)"
                                class="w-full bg-slate-50 p-3 rounded-xl text-[10px] font-bold uppercase outline-none appearance-none border border-slate-100">
                                <option value="user"  ${u.role==='user' ?'selected':''}>Utilisateur</option>
                                <option value="chef"  ${u.role==='chef' ?'selected':''}>Chef</option>
                                <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
                            </select>
                        </div>
                    </div>
                    <div class="flex items-center gap-3 bg-red-50 border border-red-100 p-3 rounded-xl">
                        <span class="text-[9px] font-black text-blue-700 uppercase flex-shrink-0">Allocation</span>
                        <input type="number" value="${parseFloat(u.allocation_mensuelle)||0}" step="0.01" min="0"
                            onchange="updateUserAlloc('${escapeHtml(u.id)}',this.value)"
                            class="flex-1 bg-transparent border-none text-[13px] font-black text-blue-800 outline-none min-w-0 text-right">
                        <span class="text-[10px] font-black text-blue-700 flex-shrink-0">€/mois</span>
                    </div>
                </div>`).join('');
        }

        async function updateUserMaison(uid, mid) {
            const{error}=await sb.from('profiles').update({maison_id:mid}).eq('id',uid);
            if(error) showToast("Erreur","error"); else showToast("Maison mise à jour","success");
        }
        async function updateUserRole(uid, role) {
            const{error}=await sb.from('profiles').update({role}).eq('id',uid);
            if(error) showToast("Erreur","error"); else showToast("Rôle mis à jour","success");
        }
        async function updateUserAlloc(uid, val) {
            const v=parseFloat(val);
            if(isNaN(v)||v<0) return showToast("Valeur invalide","error");
            const{error}=await sb.from('profiles').update({allocation_mensuelle:v}).eq('id',uid);
            if(error) showToast("Erreur","error"); else showToast("Allocation mise à jour","success");
        }
        async function resetPassword(email) {
            if(!email) return showToast("Email absent","error");
            const{error}=await sb.auth.resetPasswordForEmail(email);
            if(error) showToast(error.message,"error"); else showToast("Email de récupération envoyé !","success");
        }
        // Désactivation : le compte ne peut plus se connecter, tout l'historique est conservé.
        function basculerActif(id, reactiver) {
            const msg = reactiver
                ? 'Réactiver ce compte ? Le membre pourra de nouveau se connecter.'
                : "Désactiver ce compte ? Le membre ne pourra plus se connecter ; ses opérations, allocations et justificatifs sont conservés.";
            showConfirm(msg, async () => {
                const { data, error } = await sb.from('profiles').update({ actif: !!reactiver }).eq('id', id).select('id');
                if (error) return showToast('Erreur : ' + error.message, 'error');
                if (!(data||[]).length) return showToast('Refusé par la base (droits insuffisants)', 'error');
                showToast(reactiver ? 'Compte réactivé' : 'Compte désactivé — historique conservé', 'info');
                loadUsers();
            }, reactiver ? 'Réactiver' : 'Désactiver', !reactiver);
        }
        async function registerUser() {
            const email=document.getElementById('user-email').value.trim();
            const pass=document.getElementById('user-pass').value;
            const prenom=document.getElementById('user-prenom').value.trim();
            const nom=document.getElementById('user-nom').value.trim().toUpperCase();
            const maison=document.getElementById('user-maison').value;
            const role=document.getElementById('user-role').value;
            if(!email||!pass||!prenom||!nom) return showToast("Tous les champs requis","error");
            if(pass.length<6) return showToast("Mot de passe : 6 car. minimum","error");
            // Client temporaire sans session : la création du compte ne remplace jamais la session de l'admin
            const sbTmp=supabase.createClient(SMMD_CONFIG.url,SMMD_CONFIG.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
            const{data,error}=await sbTmp.auth.signUp({email,password:pass});
            if(error) return showToast(error.message,"error");
            const{error:pErr}=await sb.from('profiles').insert([{id:data.user.id,prenom,nom,nom_complet:`${prenom} ${nom}`,email,maison_id:maison,role,allocation_mensuelle:0,actif:true}]);
            if(pErr) showToast("Compte créé mais erreur profil : "+pErr.message,"warning");
            else{
                showToast("Compte créé !","success");
                ['user-prenom','user-nom','user-email','user-pass'].forEach(id=>document.getElementById(id).value='');
                loadUsers();
            }
        }

        async function exportData() {
            if(!navigator.onLine) return showToast("Pas de connexion réseau","error");
            const month=document.getElementById('export-month').value;
            const year=document.getElementById('export-year').value;
            const maisonId=document.getElementById('export-maison').value;

            const { debut, fin } = bornesMois(year, month);
            let txs, avsAll;
            try {
                [txs, avsAll] = await Promise.all([
                    fetchAll(() => { let q=sb.from('transactions')
                        .select('created_at,type,montant,motif,commentaire,methode_paiement,statut,maison_id,profiles(prenom,nom),maisons(nom)')
                        .gte('created_at',debut).lt('created_at',fin)
                        .order('created_at',{ascending:true});
                        return maisonId!=='all' ? q.eq('maison_id',maisonId) : q; }),
                    fetchAll(() => { let q=sb.from('allocations_versees')
                        .select('montant,user_id,statut,profiles!allocations_versees_user_id_fkey(prenom,nom),maisons(nom)')
                        .eq('mois',parseInt(month)).eq('annee',parseInt(year));
                        return maisonId!=='all' ? q.eq('maison_id',maisonId) : q; })
                ]);
            } catch (e) { return showToast("Erreur export : "+e.message,"error"); }
            const avs = avsAll.filter(allocConfirmee);

            let csv="\uFEFFDate;Maison;Membre;Type;Motif;Montant;Méthode;Statut;Commentaire\n";

            (avs||[]).forEach(a=>{
                csv+=`01/${month}/${year};${a.maisons?.nom||'-'};${a.profiles?.prenom||''} ${a.profiles?.nom||''};ALLOCATION;ALLOCATION VERSÉE;${parseFloat(a.montant).toFixed(2).replace('.',',')};VIREMENT;Validé;Versement mensuel\n`;
            });

            (txs||[]).forEach(t=>{
                const d=new Date(t.created_at).toLocaleDateString('fr-FR');
                const m=parseFloat(t.montant).toFixed(2).replace('.',',');
                const note=(t.commentaire||'').replace(/;/g,',').replace(/\n/g,' ');
                csv+=`${d};${t.maisons?.nom||'-'};${t.profiles?.prenom||''} ${t.profiles?.nom||''};${t.type.toUpperCase()};${t.motif||'RECETTE'};${m};${t.methode_paiement||'-'};${t.statut==='attente'?'En attente':'Validé'};${note}\n`;
            });

            const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
            const a=document.createElement('a');
            a.href=URL.createObjectURL(blob);
            a.download=`SMMD_Compta_${month}_${year}.csv`;
            a.click();
            showToast("Export CSV téléchargé !","success");
        }

        async function loadMotifs() {
            const{data,error}=await sb.from('motifs').select('*').order('nom');
            if(error||!data) return;
            document.getElementById('motifs-list').innerHTML=data.map(m=>`
                <div class="bg-slate-50 border border-slate-200 px-3 py-2 rounded-full flex items-center gap-2">
                    <span class="text-[10px] font-black uppercase text-slate-700">${escapeHtml(m.nom)}</span>
                    <button onclick="deleteMotif('${escapeHtml(m.id)}')" class="text-slate-300 hover:text-red-500 font-black text-sm transition-colors" aria-label="Supprimer">×</button>
                </div>`).join('');
        }

        async function addMaison() {
            const nom=document.getElementById('new-maison-name').value.trim().toUpperCase();
            if(!nom) return showToast("Saisissez un nom","error");
            const{error}=await sb.from('maisons').insert([{nom}]);
            if(error) showToast("Erreur : "+error.message,"error");
            else{document.getElementById('new-maison-name').value='';showToast("Maison ajoutée !","success");loadMaisons();}
        }
        async function deleteMaison(id) {
            showConfirm('Supprimer cette maison ? (Impossible si des membres ou des opérations y sont rattachés.)',async()=>{
                const{error}=await sb.from('maisons').delete().eq('id',id);
                if(error) showToast("Erreur : "+error.message,"error");
                else{showToast("Maison supprimée","info");loadMaisons();}
            },'Supprimer',true);
        }
        async function addMotif() {
            const nom=document.getElementById('new-motif').value.trim();
            if(!nom) return showToast("Saisissez un motif","error");
            const{error}=await sb.from('motifs').insert([{nom}]);
            if(error) showToast("Erreur","error");
            else{document.getElementById('new-motif').value='';showToast("Motif ajouté !","success");loadMotifs();}
        }
        function deleteMotif(id) {
            showConfirm('Supprimer ce motif ? Les opérations existantes gardent leur motif.', async () => {
                const{error}=await sb.from('motifs').delete().eq('id',id);
                if(error) showToast("Erreur : "+error.message,"error"); else loadMotifs();
            }, 'Supprimer', true);
        }

        // ── RAPATRIEMENT DES JUSTIFICATIFS ──
        // Sources anciennes : fichier du bucket (justificatif_url) ou base64 dans la colonne
        // transactions.justificatif_base64. Tout est copié dans justificatifs_images ;
        // les originaux ne sont JAMAIS supprimés.
        function blobVersDataUrl(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }
        async function lireFichierBucket(url) {
            // 1) lien public ; 2) téléchargement authentifié (bucket privé)
            try {
                const res = await fetch(url, { cache: 'no-cache' });
                if (res.ok) return await blobVersDataUrl(await res.blob());
            } catch (e) {}
            const m = String(url).match(/\/object\/(?:public|sign|authenticated)\/justificatifs\/([^?]+)/);
            if (!m) throw new Error('lien illisible');
            const { data, error } = await sb.storage.from('justificatifs').download(decodeURIComponent(m[1]));
            if (error || !data) throw new Error(error?.message || 'fichier introuvable dans le bucket');
            return await blobVersDataUrl(data);
        }
        function normaliserBase64(b64, mimeDefaut) {
            let s = String(b64 || '').trim();
            if (!s) return null;
            if (s.startsWith('data:')) return s;
            s = s.replace(/\s+/g, '');
            const mime = s.startsWith('JVBER') ? 'application/pdf' : s.startsWith('iVBOR') ? 'image/png' : (mimeDefaut || 'image/jpeg');
            return `data:${mime};base64,${s}`;
        }

        async function migrateJustificatifs() {
            const btn = document.getElementById('btn-migrate');
            const prog = document.getElementById('migration-progress');
            const status = document.getElementById('migration-status');
            const bar = document.getElementById('migration-bar');
            const detail = document.getElementById('migration-detail');
            const result = document.getElementById('migration-result');
            const resultText = document.getElementById('migration-result-text');
            const fin = () => { btn.disabled = false; btn.textContent = '🔄 Rapatrier tous les justificatifs'; };

            btn.disabled = true; btn.textContent = '...';
            prog.classList.remove('hidden'); result.classList.add('hidden');
            status.textContent = 'Inventaire...';

            let avecUrl, avecB64, dejaIds;
            try {
                [avecUrl, avecB64, dejaIds] = await Promise.all([
                    fetchAll(() => sb.from('transactions').select('id, created_at, motif, montant, justificatif_url').not('justificatif_url', 'is', null).order('id')),
                    fetchAll(() => sb.from('transactions').select('id, created_at, motif, montant').not('justificatif_base64', 'is', null).order('id')),
                    fetchAll(() => sb.from('justificatifs_images').select('id, transaction_id').order('id'))
                ]);
            } catch (e) {
                status.textContent = 'Erreur : ' + e.message; fin(); return;
            }
            const deja = new Set(dejaIds.map(r => r.transaction_id));
            const parId = {};
            avecB64.forEach(t => { if (!deja.has(t.id)) parId[t.id] = { ...t, b64: true }; });
            avecUrl.forEach(t => { if (!deja.has(t.id)) parId[t.id] = { ...(parId[t.id] || t), ...t, url: t.justificatif_url }; });
            const aTraiter = Object.values(parId);
            const total = aTraiter.length;

            let ok = 0; const echecs = [];
            for (let i = 0; i < total; i++) {
                const t = aTraiter[i];
                status.textContent = `Rapatriement ${i + 1} / ${total}...`;
                bar.style.width = `${Math.round(i / Math.max(total, 1) * 100)}%`;
                detail.textContent = `${new Date(t.created_at).toLocaleDateString('fr-FR')} · ${t.motif || ''} · ${parseFloat(t.montant || 0).toFixed(2)}€`;
                try {
                    let dataUrl = null, erreurs = [];
                    if (t.b64) {
                        const { data, error } = await sb.from('transactions').select('justificatif_base64').eq('id', t.id).maybeSingle();
                        if (error) erreurs.push(error.message);
                        dataUrl = normaliserBase64(data?.justificatif_base64);
                    }
                    if (!dataUrl && t.url) {
                        try { dataUrl = await lireFichierBucket(t.url); } catch (e) { erreurs.push(e.message); }
                    }
                    if (!dataUrl) throw new Error(erreurs.join(' / ') || 'aucune donnée');
                    const mime = (dataUrl.match(/^data:([^;]+);/) || [])[1] || 'image/jpeg';
                    const { error: insErr } = await sb.from('justificatifs_images').insert([{ transaction_id: t.id, ordre: 0, base64: dataUrl, mime_type: mime }]);
                    if (insErr) throw new Error(insErr.message);
                    ok++;
                } catch (e) {
                    echecs.push(`${new Date(t.created_at).toLocaleDateString('fr-FR')} · ${t.motif || '-'} · ${parseFloat(t.montant || 0).toFixed(2)}€ — ${e.message}`);
                }
            }

            bar.style.width = '100%';
            prog.classList.add('hidden');
            result.classList.remove('hidden');
            resultText.innerHTML = total === 0
                ? '✓ Tous les justificatifs sont déjà dans la base.'
                : `✓ ${ok} rapatrié${ok > 1 ? 's' : ''} · ${echecs.length} échec${echecs.length > 1 ? 's' : ''} · ${deja.size} déjà en base` +
                  (echecs.length ? `<br><span class="text-red-600">Non récupérés :</span><br>${echecs.map(escapeHtml).join('<br>')}` : '');
            fin();
        }

        // ── JOURNAL D'ERREURS ──
        let _profilsErreurs = {};
        async function compterErreurs() {
            const depuis = new Date(Date.now() - 86400000).toISOString();
            const { count } = await sb.from('erreurs_app').select('id', { count: 'exact', head: true }).gte('created_at', depuis);
            const b = document.getElementById('erreurs-badge');
            if (b) { b.textContent = count > 99 ? '99+' : count; b.style.display = count > 0 ? 'flex' : 'none'; }
        }
        async function loadErreurs() {
            const box = document.getElementById('erreurs-list');
            box.innerHTML = '<p class="text-center text-slate-400 text-[13px] font-bold py-6">Chargement…</p>';
            const jours = parseInt(document.getElementById('erreurs-periode').value);
            const depuis = new Date(Date.now() - jours * 86400000).toISOString();
            let rows;
            try {
                rows = await fetchAll(() => sb.from('erreurs_app').select('*').gte('created_at', depuis).order('created_at', { ascending: false }));
                if (!Object.keys(_profilsErreurs).length) {
                    const profs = await fetchAll(() => sb.from('profiles').select('id,prenom,nom'));
                    profs.forEach(p => _profilsErreurs[p.id] = `${p.prenom} ${p.nom || ''}`.trim());
                }
            } catch (e) {
                box.innerHTML = `<p class="text-center text-red-500 text-[13px] font-bold py-6">Lecture impossible : ${escapeHtml(e.message)}</p>`;
                return;
            }
            if (!rows.length) { box.innerHTML = '<p class="text-center text-emerald-600 text-[14px] font-bold py-6">✓ Aucune erreur sur la période</p>'; return; }
            // Regroupement par page + message
            const groupes = {};
            rows.forEach(r => {
                const k = r.page + '|' + r.message;
                (groupes[k] = groupes[k] || []).push(r);
            });
            const nom = id => id ? (_profilsErreurs[id] || 'Compte inconnu') : 'Non connecté';
            box.innerHTML = Object.values(groupes).sort((a, b) => b.length - a.length).map(g => {
                const r = g[0];
                const qui = [...new Set(g.map(x => nom(x.user_id)))];
                const apps = [...new Set(g.map(x => x.appareil).filter(Boolean))];
                const ids = g.map(x => x.id);
                return `<details class="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                    <summary class="cursor-pointer list-none">
                        <div class="flex justify-between gap-3">
                            <p class="text-[14px] font-bold text-slate-800 leading-snug">${escapeHtml(r.message)}</p>
                            <span class="flex-shrink-0 bg-red-100 text-red-700 text-[12px] font-black rounded-full px-2.5 py-0.5 h-fit">${g.length}×</span>
                        </div>
                        <p class="text-[12px] text-slate-500 font-semibold mt-1">${escapeHtml(r.page)} · ${escapeHtml(r.type)} · dernière fois ${new Date(r.created_at).toLocaleString('fr-FR')}</p>
                    </summary>
                    <div class="mt-3 space-y-1 text-[12px] text-slate-600">
                        <p><b>Qui :</b> ${escapeHtml(qui.join(', '))}</p>
                        <p><b>Appareils :</b> ${escapeHtml(apps.join(' ; '))}</p>
                        ${r.action ? `<p><b>Dernière action :</b> ${escapeHtml(r.action)}</p>` : ''}
                        <p><b>Version :</b> ${escapeHtml(r.version || '?')}${r.en_ligne === false ? ' · hors connexion' : ''}</p>
                        ${r.detail ? `<pre class="whitespace-pre-wrap break-all bg-white border border-slate-200 rounded-xl p-2 mt-2 text-[11px]">${escapeHtml(r.detail)}</pre>` : ''}
                        <button type="button" data-ids="${escapeHtml(ids.join(','))}" onclick="erreurTraitee(this)" class="mt-2 bg-slate-900 text-white rounded-xl px-4 py-2 text-[12px] font-bold">Marquer comme traitée</button>
                    </div>
                </details>`;
            }).join('');
        }
        async function erreurTraitee(btn) {
            const ids = btn.dataset.ids.split(',');
            for (let i = 0; i < ids.length; i += 100) {
                const { error } = await sb.from('erreurs_app').delete().in('id', ids.slice(i, i + 100));
                if (error) return showToast('Erreur : ' + error.message, 'error');
            }
            showToast('Erreur marquée comme traitée', 'success');
            loadErreurs(); compterErreurs();
        }

        // ── MISE À JOUR APPLICATION ──
        const APP_VERSION = '1.2.0';
        let _swUpdateAvailable = false;
        let _swWaiting = null;

        function initAppUpdate() {
            if (!('serviceWorker' in navigator)) return;
            navigator.serviceWorker.ready.then(reg => {
                if (reg.waiting) { _swWaiting = reg.waiting; _swUpdateAvailable = true; showUpdateBadge(); }
                reg.addEventListener('updatefound', () => {
                    const nw = reg.installing;
                    nw.addEventListener('statechange', () => {
                        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                            _swWaiting = nw; _swUpdateAvailable = true; showUpdateBadge();
                        }
                    });
                });
            });
            navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
            setInterval(() => navigator.serviceWorker.ready.then(r => r.update()), 60000);
        }

        function showUpdateBadge() {
            const badge = document.getElementById('update-badge-admin');
            if (badge) { badge.classList.remove('hidden'); badge.style.display = 'flex'; }
        }

        async function mettreAJourApp() {
            try {
                const reg = await navigator.serviceWorker.ready;
                if (_swWaiting) {
                    _swWaiting.postMessage({ type: 'SKIP_WAITING' });
                } else {
                    await reg.update();
                    await new Promise(r => setTimeout(r, 2000));
                    if (_swWaiting) { _swWaiting.postMessage({ type: 'SKIP_WAITING' }); }
                    else {
                        const keys = await caches.keys();
                        await Promise.all(keys.map(k => caches.delete(k)));
                        showToast('App à jour ! Rechargement...', 'success');
                        setTimeout(() => window.location.reload(true), 1000);
                    }
                }
            } catch(e) { window.location.reload(true); }
        }

        function logout(){sb.auth.signOut().then(()=>location.href='index.html');}


        // ══════════════════════════════════
        //   EXPORTS ADMIN — TOUTES MAISONS
        // ══════════════════════════════════

        function ouvrirExportsAdmin() {
            const now = new Date();
            const sel = document.getElementById('admin-export-mois');
            const selA = document.getElementById('admin-export-annee');
            if (sel) sel.value = String(now.getMonth()+1).padStart(2,'0');
            if (selA) selA.value = String(now.getFullYear());
            document.getElementById('exports-admin-modal').style.display = 'block';
            document.getElementById('admin-export-progress').style.display = 'none';
        }

        function fermerExportsAdmin() {
            document.getElementById('exports-admin-modal').style.display = 'none';
        }

        function setAdminProgress(text, pct) {
            document.getElementById('admin-export-progress').style.display = 'block';
            document.getElementById('admin-export-progress-text').textContent = text;
            document.getElementById('admin-export-bar').style.width = pct + '%';
        }

        // mois = null → année entière ; annee = null → tout depuis le début
        async function adminZipJustifs(mois, annee, moisNom) {
            setAdminProgress('Chargement des dépenses...', 5);
            const borne = annee === null ? null : (mois === null ? bornesAnnee(annee) : bornesMois(annee, mois));
            const txs = await fetchAll(() => {
                let q = sb.from('transactions')
                    .select('id, user_id, created_at, motif, montant, commentaire, justificatif_url, profiles(prenom,nom), maisons(nom)')
                    .eq('type', 'depense')
                    .order('created_at', { ascending: true });
                return borne ? q.gte('created_at', borne.debut).lt('created_at', borne.fin) : q;
            });
            if (!txs.length) { showToast('Aucune dépense sur cette période', 'warning'); document.getElementById('admin-export-progress').style.display = 'none'; return; }
            const S = SMMD_EXPORT.slug;
            const nomZip = annee === null ? `Justificatifs_SMMD_tout_${new Date().toISOString().slice(0,10)}.zip`
                         : `Justificatifs_toutes_maisons_${moisNom}_${annee}.zip`;
            const r = await SMMD_EXPORT.exporterJustificatifs({
                sb, txs, JSZip,
                // Maison / Membre / AAAA-MM
                dossier: t => S(t.maisons?.nom, 'Sans_maison') + '/'
                    + (t.profiles ? S(t.profiles.prenom, 'Membre') + '_' + S((t.profiles.nom || '').toUpperCase(), '') : 'Membres_supprimes')
                    + '/' + SMMD_EXPORT.dateISO(t).slice(0, 7),
                nomZip,
                onProgress: setAdminProgress
            });
            document.getElementById('admin-export-progress').style.display = 'none';
            showToast(`${r.nbFichiers} fichier(s)` + (r.nbSans ? ` · ${r.nbSans} sans justificatif` : '') + (r.problemes ? ` · ${r.problemes} problème(s) (voir LISEZMOI.txt)` : ''), r.problemes ? 'warning' : 'success');
        }

        async function adminLancerExport(type) {
            const mois  = document.getElementById('admin-export-mois').value;
            const annee = document.getElementById('admin-export-annee').value;
            const moisNoms = ['Janvier','Février','Mars','Avril','Mai','Juin',
                              'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
            const moisNom = moisNoms[parseInt(mois)-1];

            try {
                if (type === 'excel-mensuel') await adminExportMensuel(mois, annee, moisNom);
                else if (type === 'excel-annuel') await adminExportAnnuel(annee);
                else if (type === 'zip-mensuel') await adminZipJustifs(mois, annee, moisNom);
                else if (type === 'zip-annuel') await adminZipJustifs(null, annee, 'Annee');
                else if (type === 'zip-tout') await adminZipJustifs(null, null, 'Tout');
            } catch(e) {
                showToast('Erreur : ' + e.message, 'error');
                document.getElementById('admin-export-progress').style.display = 'none';
            }
        }

        // Nom d'onglet Excel valide (31 car., sans : \\ / ? * [ ]) et unique
        function nomOnglet(wb, nom) {
            const base = String(nom || 'Maison').replace(/[:\\\/?*\[\]]/g, ' ').slice(0, 28).trim() || 'Maison';
            let n = base, k = 2;
            while (wb.SheetNames.includes(n)) n = `${base.slice(0, 26)} ${k++}`;
            return n;
        }

        // ── Export mensuel toutes maisons ──
        async function adminExportMensuel(mois, annee, moisNom) {
            setAdminProgress('Chargement des maisons...', 10);

            const { debut, fin } = bornesMois(annee, mois);
            const [maiRes, allTx, allocAll] = await Promise.all([
                sb.from('maisons').select('id,nom').order('nom'),
                fetchAll(() => sb.from('transactions').select('*, profiles(prenom,nom)')
                    .gte('created_at', debut).lt('created_at', fin)
                    .order('created_at', { ascending: true })),
                fetchAll(() => sb.from('allocations_versees').select('maison_id,montant,statut')
                    .eq('mois', parseInt(mois)).eq('annee', parseInt(annee)))
            ]);
            const maisons = maiRes.data || [];
            const allocMois = allocAll.filter(allocConfirmee);

            if (!allTx.length && !allocMois.length) { showToast('Aucune donnée ce mois', 'warning'); document.getElementById('admin-export-progress').style.display = 'none'; return; }

            const wb = XLSX.utils.book_new();

            // Onglet récapitulatif global
            const recapGlobal = {};
            const R = nom => (recapGlobal[nom] = recapGlobal[nom] || { depenses:0, recettes:0, allocations:0, attente:0, nb:0 });
            const nomMaison = id => maisons.find(m => m.id === id)?.nom || 'Inconnue';
            allTx.forEach(t => {
                const r = R(nomMaison(t.maison_id));
                if (t.type === 'recette') r.recettes += parseFloat(t.montant||0);
                else r.depenses += parseFloat(t.montant||0);
                if (t.type === 'depense' && t.statut === 'attente') r.attente += parseFloat(t.montant||0);
                r.nb++;
            });
            allocMois.forEach(a => { R(nomMaison(a.maison_id)).allocations += parseFloat(a.montant||0); });

            const recapRows = Object.entries(recapGlobal).map(([maison, d]) => ({
                'Maison': maison,
                'Allocations (€)': d.allocations.toFixed(2),
                'Recettes (€)': d.recettes.toFixed(2),
                'Dépenses (€)': d.depenses.toFixed(2),
                'Solde du mois (€)': (d.allocations + d.recettes - d.depenses).toFixed(2),
                'Avances à rembourser (€)': d.attente.toFixed(2),
                'Nb opérations': d.nb
            }));
            const wsRecap = XLSX.utils.json_to_sheet(recapRows);
            wsRecap['!cols'] = [{wch:20},{wch:14},{wch:14},{wch:14},{wch:16},{wch:22},{wch:15}];
            XLSX.utils.book_append_sheet(wb, wsRecap, 'Récapitulatif');

            // Un onglet par maison
            maisons.forEach((maison, idx) => {
                setAdminProgress(`Maison ${maison.nom}...`, 20 + idx * (70/maisons.length));
                const txMaison = allTx.filter(t => t.maison_id === maison.id);
                if (!txMaison.length) return;

                const rows = txMaison.map(t => ({
                    'Date': new Date(t.created_at).toLocaleDateString('fr-FR'),
                    'Membre': t.profiles ? `${t.profiles.prenom} ${t.profiles.nom||''}`.trim() : 'Membre supprimé',
                    'Type': t.type === 'recette' ? 'Recette' : 'Dépense',
                    'Motif': t.motif || '',
                    'Commentaire': t.commentaire || '',
                    'Montant (€)': parseFloat(t.montant||0).toFixed(2),
                    'Paiement': t.methode_paiement || '',
                    'Statut': t.statut === 'attente' ? 'En attente' : 'Validé'
                }));
                const ws = XLSX.utils.json_to_sheet(rows);
                ws['!cols'] = [{wch:12},{wch:22},{wch:10},{wch:20},{wch:25},{wch:12},{wch:14},{wch:12}];
                // Limiter le nom de l'onglet à 31 chars (limite Excel)
                XLSX.utils.book_append_sheet(wb, ws, nomOnglet(wb, maison.nom));
            });

            setAdminProgress('Téléchargement...', 95);
            XLSX.writeFile(wb, `Journal_Global_${moisNom}_${annee}.xlsx`);
            showToast(`Journal ${moisNom} ${annee} téléchargé ✓`, 'success');
            fermerExportsAdmin();
        }

        // ── Export annuel toutes maisons ──
        async function adminExportAnnuel(annee) {
            setAdminProgress('Chargement des données...', 8);

            const { debut, fin } = bornesAnnee(annee);
            const [maiRes, allTx, allocAll, profs] = await Promise.all([
                sb.from('maisons').select('id,nom').order('nom'),
                fetchAll(() => sb.from('transactions').select('*, profiles(prenom,nom)')
                    .gte('created_at', debut).lt('created_at', fin)
                    .order('created_at', { ascending: true })),
                fetchAll(() => sb.from('allocations_versees')
                    .select('*')
                    .eq('annee', parseInt(annee))),
                fetchAll(() => sb.from('profiles').select('id,prenom,nom,maison_id'))
            ]);

            const maisons   = maiRes.data || [];
            const allAlloc  = allocAll.filter(allocConfirmee);
            const profilesMap = {};
            profs.forEach(p => { profilesMap[p.id] = p; });

            const wb = XLSX.utils.book_new();
            const moisNoms = ['Janvier','Février','Mars','Avril','Mai','Juin',
                              'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

            // ── Récapitulatif global ──
            setAdminProgress('Récapitulatif global...', 20);
            const recapGlobal = {};
            allTx.forEach(t => {
                const maison = maisons.find(m => m.id === t.maison_id)?.nom || 'Inconnue';
                if (!recapGlobal[maison]) recapGlobal[maison] = { depenses:0, recettes:0, allocations:0, attente:0, nbTx:0 };
                if (t.type === 'recette') recapGlobal[maison].recettes += parseFloat(t.montant||0);
                else recapGlobal[maison].depenses += parseFloat(t.montant||0);
                if (t.type === 'depense' && t.statut === 'attente') recapGlobal[maison].attente += parseFloat(t.montant||0);
                recapGlobal[maison].nbTx++;
            });
            allAlloc.forEach(a => {
                const maison = maisons.find(m => m.id === a.maison_id)?.nom || 'Inconnue';
                if (!recapGlobal[maison]) recapGlobal[maison] = { depenses:0, recettes:0, allocations:0, attente:0, nbTx:0 };
                recapGlobal[maison].allocations += parseFloat(a.montant||0);
            });

            const recapRows = Object.entries(recapGlobal).map(([maison, d]) => ({
                'Maison': maison,
                'Dépenses (€)': d.depenses.toFixed(2),
                'Recettes (€)': d.recettes.toFixed(2),
                'Allocations versées (€)': d.allocations.toFixed(2),
                'Solde de l\'année (€)': (d.allocations + d.recettes - d.depenses).toFixed(2),
                'Avances à rembourser (€)': d.attente.toFixed(2),
                'Nb transactions': d.nbTx
            }));
            const wsRecap = XLSX.utils.json_to_sheet(recapRows);
            wsRecap['!cols'] = [{wch:20},{wch:14},{wch:14},{wch:22},{wch:18},{wch:16}];
            XLSX.utils.book_append_sheet(wb, wsRecap, 'Récapitulatif Global');

            // ── Un onglet par maison (récap membres) ──
            maisons.forEach((maison, idx) => {
                setAdminProgress(`Maison ${maison.nom}...`, 25 + idx * (50/maisons.length));
                const txMaison = allTx.filter(t => t.maison_id === maison.id);
                const allocMaison = allAlloc.filter(a => a.maison_id === maison.id);
                if (!txMaison.length && !allocMaison.length) return;

                // Récap par membre pour cette maison
                const recapM = {};
                txMaison.forEach(t => {
                    const m = t.profiles ? `${t.profiles.prenom} ${t.profiles.nom||''}`.trim() : 'Membre supprimé';
                    if (!recapM[m]) recapM[m] = { depenses:0, recettes:0, allocations:0, attente:0, nb:0 };
                    if (t.type === 'recette') recapM[m].recettes += parseFloat(t.montant||0);
                    else recapM[m].depenses += parseFloat(t.montant||0);
                    if (t.type === 'depense' && t.statut === 'attente') recapM[m].attente += parseFloat(t.montant||0);
                    recapM[m].nb++;
                });
                allocMaison.forEach(a => {
                    const p = profilesMap[a.user_id];
                    const m = p ? `${p.prenom} ${p.nom||''}`.trim() : 'Membre supprimé';
                    if (!recapM[m]) recapM[m] = { depenses:0, recettes:0, allocations:0, attente:0, nb:0 };
                    recapM[m].allocations += parseFloat(a.montant||0);
                });

                const rows = Object.entries(recapM).map(([membre, d]) => ({
                    'Membre': membre,
                    'Dépenses (€)': d.depenses.toFixed(2),
                    'Recettes (€)': d.recettes.toFixed(2),
                    'Allocations (€)': d.allocations.toFixed(2),
                    'Avances à rembourser (€)': d.attente.toFixed(2),
                    'Nb opérations': d.nb
                }));
                const ws = XLSX.utils.json_to_sheet(rows);
                ws['!cols'] = [{wch:22},{wch:14},{wch:14},{wch:16},{wch:18},{wch:15}];
                XLSX.utils.book_append_sheet(wb, ws, nomOnglet(wb, maison.nom));
            });

            // ── Onglet détail toutes transactions ──
            setAdminProgress('Détail transactions...', 80);
            if (allTx.length) {
                const rows = allTx.map(t => ({
                    'Date': new Date(t.created_at).toLocaleDateString('fr-FR'),
                    'Maison': maisons.find(m => m.id === t.maison_id)?.nom || '',
                    'Membre': t.profiles ? `${t.profiles.prenom} ${t.profiles.nom||''}`.trim() : 'Membre supprimé',
                    'Type': t.type === 'recette' ? 'Recette' : 'Dépense',
                    'Motif': t.motif || '',
                    'Montant (€)': parseFloat(t.montant||0).toFixed(2),
                    'Statut': t.statut === 'attente' ? 'En attente' : 'Validé'
                }));
                const ws = XLSX.utils.json_to_sheet(rows);
                ws['!cols'] = [{wch:12},{wch:16},{wch:22},{wch:10},{wch:20},{wch:12},{wch:12}];
                XLSX.utils.book_append_sheet(wb, ws, 'Toutes transactions');
            }

            // ── Onglet allocations global ──
            if (allAlloc.length) {
                const rows = allAlloc.map(a => {
                    const p = profilesMap[a.user_id];
                    return {
                        'Mois': moisNoms[(a.mois||1)-1],
                        'Maison': maisons.find(m => m.id === a.maison_id)?.nom || '',
                        'Membre': p ? `${p.prenom} ${p.nom||''}`.trim() : 'Membre supprimé',
                        'Montant (€)': parseFloat(a.montant||0).toFixed(2)
                    };
                });
                const ws = XLSX.utils.json_to_sheet(rows);
                ws['!cols'] = [{wch:14},{wch:16},{wch:22},{wch:14}];
                XLSX.utils.book_append_sheet(wb, ws, 'Allocations');
            }

            setAdminProgress('Téléchargement...', 97);
            XLSX.writeFile(wb, `Rapport_Global_${annee}.xlsx`);
            showToast(`Rapport global ${annee} téléchargé ✓`, 'success');
            fermerExportsAdmin();
        }

        function ouvrirMessagerie() {
            localStorage.setItem('smmd_chat_from', 'admin.html');
            window.location.href = 'chat.html';
        }

        async function checkUnreadMessages() {
            try {
                const { data: { user } } = await sb.auth.getUser();
                if (!user) return;
                const { data: convs } = await sb.from('conversations')
                    .select('id')
                    .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`);
                if (!convs?.length) return;
                const { count } = await sb.from('messages')
                    .select('*', { count: 'exact', head: true })
                    .in('conversation_id', convs.map(c => c.id))
                    .eq('lu', false)
                    .neq('sender_id', user.id)
                    .is('deleted_at', null);
                const badge = document.getElementById('msg-badge');
                if (badge && count > 0) {
                    badge.textContent = count > 9 ? '9+' : count;
                    badge.style.display = 'flex';
                }
            } catch(e) { console.warn('badge messages non lus (admin) :', e.message || e); }
        }
        setTimeout(checkUnreadMessages, 1500);
        initAppUpdate();

        init();
    
