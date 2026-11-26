        const sb = supabase.createClient(SMMD_CONFIG.url, SMMD_CONFIG.key);
        let scannedFile = null;
        let _lastBase64 = null;
        window.addEventListener('offline', ()=>document.getElementById('offline-banner').classList.remove('hidden'));
        window.addEventListener('online',  ()=>document.getElementById('offline-banner').classList.add('hidden'));
        let userProfile = null, currentType = 'depense';
        const MOIS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];


        // ── Compact nav au scroll ──
        new IntersectionObserver(([e]) => {
            const compact = !e.isIntersecting;
            const exp = document.getElementById('nav-expanded');
            const cmp = document.getElementById('nav-compact');
            const nav = document.getElementById('main-nav');
            exp.style.maxHeight = compact ? '0'    : '500px';
            exp.style.opacity   = compact ? '0'    : '1';
            cmp.classList.toggle('hidden', !compact);
            nav.style.paddingTop    = compact ? '14px' : '24px';
            nav.style.paddingBottom = compact ? '14px' : '20px';
            nav.style.borderRadius  = compact ? '0 0 20px 20px' : '0 0 40px 40px';
        }, { threshold: 0 }).observe(document.getElementById('scroll-sentinel'));

        // ── Compteur animé ──
        function animCounter(el, target, suffix='€', duration=550) {
            const neg=target<0, abs=Math.abs(target), start=performance.now();
            el.style.color = neg ? '#ef4444' : '';
            const tick = now => {
                const p=Math.min((now-start)/duration,1), ease=1-Math.pow(1-p,3);
                el.textContent=(neg?'-':'')+(abs*ease).toFixed(2)+suffix;
                if(p<1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        }

        // ── Tab switch ──

        // ── SCAN JUSTIFICATIF ──
        function openScanModal() {
            resetScanModal();
            document.getElementById('scan-modal').classList.remove('hidden');
        }
        function closeScanModal() {
            document.getElementById('scan-modal').classList.add('hidden');
            const ids = ['scan-montant','scan-date','scan-commentaire'];
            ids.forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
            const preview = document.getElementById('scan-preview');
            if (preview) preview.src = '';
            const confiance = document.getElementById('scan-confiance');
            if (confiance) { confiance.textContent=''; confiance.className=''; }
            scannedFile = null;
            extraPhotos = [];
            resetScanModal();
        }
        function resetScanModal() {
            extraPhotos = [];
            const grid = document.getElementById('scan-extra-previews');
            if (grid) grid.innerHTML = '';
            document.getElementById('scan-step-pick').classList.remove('hidden');
            document.getElementById('scan-step-loading').classList.add('hidden');
            document.getElementById('scan-step-result').classList.add('hidden');
            document.getElementById('scan-step-error').classList.add('hidden');
        }

        async function handleScanFile(input) {
            const file = input.files[0];
            if (!file) return;

            // Afficher loading
            document.getElementById('scan-step-pick').classList.add('hidden');
            document.getElementById('scan-step-loading').classList.remove('hidden');

            // Preview image
            if (file.type.startsWith('image/')) {
                const url = URL.createObjectURL(file);
                document.getElementById('scan-preview').src = url;
            } else {
                document.getElementById('scan-preview').src = '';
            }

            try {
                const result = await scanJustificatif(file);

                // Remplir les champs de vérification
                document.getElementById('scan-montant').value    = result.montant !== null ? result.montant : '';
                document.getElementById('scan-date').value       = result.date    !== null ? result.date    : new Date().toISOString().split('T')[0];
                document.getElementById('scan-commentaire').value = result.commentaire || '';

                // Badge confiance
                const badge = document.getElementById('scan-confiance');
                const conf  = result.confiance || 'basse';
                const confMap = {
                    haute:   { label: '✓ Confiance haute',   cls: 'bg-emerald-100 text-emerald-700' },
                    moyenne: { label: '~ Confiance moyenne', cls: 'bg-amber-100 text-amber-700'    },
                    basse:   { label: '! Confiance basse',   cls: 'bg-red-100 text-red-600'         }
                };
                badge.textContent  = confMap[conf]?.label || conf;
                badge.className    = `inline-block mt-1 text-[8px] font-black uppercase px-2 py-0.5 rounded-full ${confMap[conf]?.cls || ''}`;

                document.getElementById('scan-step-loading').classList.add('hidden');
                document.getElementById('scan-step-result').classList.remove('hidden');
                scannedFile = file;

            } catch (err) {
                document.getElementById('scan-step-loading').classList.add('hidden');
                document.getElementById('scan-step-error').classList.remove('hidden');
                // Afficher le message d'erreur précis retourné par scanJustificatif
                document.getElementById('scan-error-msg').textContent = err.message || "Erreur inconnue. Réessayez.";
                console.error('[SCAN]', err);
            }
        }

        async function validerDepenseScan() {
            const amount = parseFloat(document.getElementById('scan-montant').value);
            const date   = document.getElementById('scan-date').value;
            const comment= document.getElementById('scan-commentaire').value.trim();
            const motif  = document.getElementById('scan-motif').value;
            const method = document.getElementById('scan-method').value;
            if (!amount||amount<=0) return showToast('Saisissez un montant valide','error');
            if (!date) return showToast('Saisissez une date','error');

            const btn = document.getElementById('scan-submit-btn');
            const setBtn = (html, disabled) => { if(btn){btn.innerHTML=html;btn.disabled=disabled;} };

            setBtn('<span class="btn-spinner"></span>Enregistrement...', true);

            const { data: insertData, error } = await sb.from('transactions').insert([{
                user_id: userProfile.id, maison_id: userProfile.maison_id,
                montant: amount, motif, commentaire: comment||null,
                created_at: dateSaisieVersISO(date),
                type: 'depense', methode_paiement: method,
                statut: estPerso(method) ? 'attente' : 'valide',
                justificatif_url: null
            }]).select('id');

            if (error) { setBtn('Enregistrer la dépense', false); showToast('Erreur : '+error.message,'error'); return; }
            let justifOk = false;
            const allPhotos = [scannedFile, ...extraPhotos].filter(Boolean);
            if (insertData?.[0]?.id && allPhotos.length) {
                setBtn('<span class="btn-spinner"></span>Justificatif...', true);
                try { await sauvegarderImagesJustificatif(insertData[0].id, allPhotos); justifOk = true; }
                catch (e) { showToast(e.message + ' — ajoutez-le depuis le journal', 'error'); }
            }
            setBtn('Enregistrer la dépense', false);
            scannedFile = null;
            closeScanModal();
            if (justifOk) showToast('Dépense enregistrée avec justificatif !','success');
            else if (!allPhotos.length) showToast('Dépense enregistrée (sans justificatif)','warning');
            refreshAll();
        }

        function applyScanResult() {
            // Remplir le formulaire manuel à partir du scan (option secondaire)
            const montant     = document.getElementById('scan-montant').value;
            const date        = document.getElementById('scan-date').value;
            const commentaire = document.getElementById('scan-commentaire').value;
            if (montant)  document.getElementById('tx-amount').value = montant;
            if (date)     document.getElementById('tx-date').value   = date;
            if (commentaire) {
                const el = document.getElementById('tx-note');
                if (el) el.value = commentaire;
            }
            closeScanModal();
            showToast('Données copiées dans le formulaire', 'info');
        }


        // ── JOURNAL CHEF ──
        async function initJournalFiltres() {
            const now = new Date();
            document.getElementById('journal-mois').value = String(now.getMonth()+1).padStart(2,'0');
            const ySel = document.getElementById('journal-annee');
            ySel.innerHTML = '';
            for (let y = now.getFullYear(); y >= 2026; y--) {
                ySel.innerHTML += `<option value="${y}">${y}</option>`;
            }
            // Populate membres filter
            const { data: membres } = await sb.from('profiles').select('*').eq('maison_id', userProfile.maison_id).order('prenom');
            const mSel = document.getElementById('journal-membre');
            mSel.innerHTML = '<option value="all">Tous les membres</option>' +
                (membres||[]).map(m=>`<option value="${escapeHtml(m.id)}">${escapeHtml(m.prenom)} ${escapeHtml(m.nom||'')}${m.actif===false?' (désactivé)':''}</option>`).join('') +
                '<option value="deleted">Membres supprimés</option>';
        }

        let _txCache = {}; // cache des transactions pour l'édition

        async function loadJournal() {
            const mois   = document.getElementById('journal-mois').value;
            const annee  = document.getElementById('journal-annee').value;
            const membre = document.getElementById('journal-membre').value;
            const list   = document.getElementById('journal-list');
            renderJournalSkeleton(list);

            const { debut, fin } = bornesMois(annee, mois);
            let data, justifSet;
            try {
                data = await fetchAll(() => {
                    let q = sb.from('transactions')
                        .select('*, profiles(prenom,nom)')
                        .eq('maison_id', userProfile.maison_id)
                        .gte('created_at', debut).lt('created_at', fin)
                        .order('created_at', { ascending: false });
                    if (membre === 'deleted') q = q.is('user_id', null);
                    else if (membre !== 'all') q = q.eq('user_id', membre);
                    return q;
                });
                justifSet = await idsAvecJustif(data.map(t => t.id));
            } catch (e) { list.innerHTML=`<p class="text-center text-red-400 text-[11px] font-bold py-8">Erreur de chargement</p>`; return; }

            const motifFilter = document.getElementById('journal-motif')?.value || 'all';
            const filtered = data.filter(t => motifFilter === 'all' || t.motif === motifFilter);
            filtered.forEach(t => { _txCache[t.id] = t; t._hasJustif = justifSet.has(t.id); });

            if (!filtered.length) {
                list.innerHTML = `<div class="bg-white rounded-[28px] border border-slate-100 shadow-premium p-8 text-center">
                    <p class="text-slate-300 text-[11px] font-black uppercase tracking-widest">Aucune opération ce mois</p>
                </div>`;
                return;
            }

            const totalDep = filtered.filter(t=>t.type==='depense').reduce((s,t)=>s+parseFloat(t.montant),0);
            const totalRec = filtered.filter(t=>t.type==='recette').reduce((s,t)=>s+parseFloat(t.montant),0);

            list.innerHTML = `
                <div class="flex justify-between items-center px-1 pb-1">
                    <p class="text-[9px] font-bold text-slate-400 uppercase">${filtered.length} opération${filtered.length>1?'s':''}</p>
                    <div class="flex gap-3">
                        ${totalDep>0?`<p class="text-[9px] font-black text-slate-600">-${totalDep.toFixed(2)}€</p>`:''}
                        ${totalRec>0?`<p class="text-[9px] font-black text-emerald-600">+${totalRec.toFixed(2)}€</p>`:''}
                    </div>
                </div>
                ${filtered.map((t,i)=>`
                <div class="swipe-item rounded-[20px] anim-slide" style="animation-delay:${i*.03}s" data-swipe-id="${escapeHtml(t.id)}">
                    <div class="swipe-delete-btn rounded-[20px]">🗑️</div>
                    <div class="swipe-item-inner bg-white rounded-[20px] border border-slate-100 p-4">
                    <div class="flex justify-between items-start">
                        <div class="flex items-start gap-3 flex-1 min-w-0">
                            ${motifIconHTML(t.motif, t.type)}
                            <div class="min-w-0 flex-1">
                                <p class="text-[10px] font-black text-slate-400 uppercase">${t.profiles ? escapeHtml(t.profiles.prenom+' '+(t.profiles.nom||'')) : '<span style="color:#94a3b8;font-style:italic">Membre supprimé</span>'}</p>
                                <p class="text-[11px] font-black uppercase text-slate-800">${escapeHtml(t.motif||'RECETTE')}</p>
                                <p class="text-[9px] text-slate-400 font-bold">${new Date(t.created_at).toLocaleDateString('fr-FR')}${t.commentaire?' · '+escapeHtml(t.commentaire):''}</p>
                                <span class="text-[8px] uppercase font-black px-2 py-0.5 rounded-full ${t.statut==='attente'?'bg-amber-50 text-amber-500':'bg-emerald-50 text-emerald-600'}">${t.statut==='attente'?'En attente':'Validé'}</span>
                                
                            </div>
                        </div>
                        <div class="text-right flex-shrink-0 ml-2">
                            <p class="font-black text-sm ${t.type==='recette'?'text-emerald-500':'text-slate-900'} mb-2">${t.type==='recette'?'+':'-'}${parseFloat(t.montant).toFixed(2)}€</p>
                            
                            <div class="flex flex-wrap gap-1 mt-1.5">
                                ${t.type==='depense' ? (t.justificatif_url || t._hasJustif
                                    ? `<button onclick="previewJustificatif('${escapeHtml(t.id)}','${escapeHtml(t.justificatif_url||'')}')" class="text-[8px] font-black text-emerald-600 uppercase bg-emerald-50 px-2 py-1 rounded-full border border-emerald-200 hover:bg-emerald-100 transition-colors">${t.justificatif_url?.includes('.pdf') ? '📄 Voir PDF' : '📎 Voir'}</button>
                                       <button onclick="ouvrirAjoutJustificatif('${escapeHtml(t.id)}')" class="text-[8px] font-black text-blue-600 uppercase bg-blue-50 px-2 py-1 rounded-full border border-blue-200 hover:bg-blue-100 transition-colors">📋 Remplacer</button>`
                                    : `<button onclick="ouvrirAjoutJustificatif('${escapeHtml(t.id)}')" class="text-[8px] font-black text-amber-600 uppercase bg-amber-50 px-2 py-1 rounded-full border border-amber-200 hover:bg-amber-100 transition-colors">📎 Ajouter justif</button>`)
                                : ''}
                                <button onclick="ouvrirEditById('${escapeHtml(t.id)}')" class="text-[8px] font-black text-slate-600 uppercase bg-slate-50 px-2 py-1 rounded-full border border-slate-200 hover:bg-slate-100 transition-colors">✏️ Modifier</button>
                                <button onclick="supprimerOperation('${escapeHtml(t.id)}')" class="text-[8px] font-black text-red-500 uppercase bg-red-50 px-2 py-1 rounded-full border border-red-100 hover:bg-red-100 transition-colors">🗑️ Suppr</button>
                            </div>
                    </div>
                    </div>
                    </div>
                </div>`).join('')}`;
            // Init swipe-to-delete on journal items
            setTimeout(() => {
                document.querySelectorAll('.swipe-item').forEach(el => {
                    const id = el.dataset.swipeId;
                    if (id) initSwipeDelete(el, () => supprimerOperation(id));
                });
            }, 100);
        }

        function supprimerOperation(id) {
            showConfirm('Supprimer cette opération ?', async () => {
                const { error } = await sb.from('transactions').delete().eq('id', id).eq('maison_id', userProfile.maison_id);
                if (error) { showToast('Erreur : '+error.message,'error'); return; }
                // Supprimer du cache et recharger immédiatement
                delete _txCache[id];
                showToast('Opération supprimée','info');
                await loadJournal();
                refreshAll();
            }, 'Supprimer', true);
        }

        async function ouvrirEditById(id) {
            let tx = _txCache[id];
            if (!tx) {
                // Pas dans le cache — charger depuis Supabase
                const { data } = await sb.from('transactions')
                    .select('*').eq('id', id).maybeSingle();
                if (!data) { showToast('Opération introuvable', 'error'); return; }
                tx = data;
                _txCache[id] = tx;
            }
            ouvrirEditModal(tx);
        }

        function ouvrirEditModal(tx) {
            document.getElementById('edit-tx-id').value   = tx.id;
            document.getElementById('edit-tx-type').value = tx.type;
            document.getElementById('edit-tx-user').value = tx.user_id;
            document.getElementById('edit-montant').value = parseFloat(tx.montant);
            document.getElementById('edit-date').value    = isoVersDateSaisie(tx.created_at);
            document.getElementById('edit-commentaire').value = tx.commentaire||'';
            document.getElementById('edit-methode').value = tx.methode_paiement||'cb_maison';
            const isR = tx.type === 'recette';
            document.getElementById('edit-container-motif').classList.toggle('hidden', isR);
            document.getElementById('edit-container-paiement').classList.toggle('hidden', isR);
            const sel = document.getElementById('edit-motif');
            if (sel && tx.motif) Array.from(sel.options).forEach(o => { o.selected = o.value === tx.motif; });
            document.getElementById('edit-modal').classList.remove('hidden');
        }

        function fermerEditModal() { document.getElementById('edit-modal').classList.add('hidden'); }

        async function sauvegarderEdit() {
            const id      = document.getElementById('edit-tx-id').value;
            const type    = document.getElementById('edit-tx-type').value;
            const montant = parseFloat(document.getElementById('edit-montant').value);
            const date    = document.getElementById('edit-date').value;
            const motif   = document.getElementById('edit-motif').value;
            const comment = document.getElementById('edit-commentaire').value.trim();
            const methode = document.getElementById('edit-methode').value;
            if (!montant||montant<=0) return showToast('Montant invalide','error');
            if (!date) return showToast('Date requise','error');

            const btn = document.getElementById('edit-save-btn');
            if(btn){btn.innerHTML='<span class="btn-spinner"></span>Enregistrement...';btn.disabled=true;}

            const update = {
                montant,
                created_at: dateSaisieVersISO(date),
                commentaire: comment||null,
                methode_paiement: type==='recette' ? null : methode,
                statut: statutApresEdition(_txCache[id], type, methode)
            };
            if (type !== 'recette') update.motif = motif;

            const { error } = await sb.from('transactions').update(update).eq('id', id).eq('maison_id', userProfile.maison_id);
            if(btn){btn.textContent='Enregistrer';btn.disabled=false;}
            if (error) { showToast('Erreur : '+error.message,'error'); return; }
            fermerEditModal();
            showToast('Opération modifiée !','success');
            await loadJournal();
            refreshAll();
        }

        

        async function initResumeAnnee() {
            const sel = document.getElementById('resume-annee');
            if (!sel) return;
            const now = new Date().getFullYear();
            sel.innerHTML = '';
            for (let y = now; y >= 2026; y--) {
                sel.innerHTML += `<option value="${y}">${y}</option>`;
            }
        }

        async function loadResumeAnnuel() {
            const annee = parseInt(document.getElementById('resume-annee')?.value || new Date().getFullYear());
            const container = document.getElementById('resume-content');
            container.innerHTML = `<div class="text-center py-8"><div class="w-8 h-8 rounded-full border-2 border-slate-200 border-t-red-700 animate-spin mx-auto"></div></div>`;

            const { debut, fin } = bornesAnnee(annee);
            let txs, avsAll, membres;
            try {
                [txs, avsAll, membres] = await Promise.all([
                    fetchAll(() => sb.from('transactions').select('*').eq('maison_id', userProfile.maison_id).gte('created_at', debut).lt('created_at', fin)),
                    fetchAll(() => sb.from('allocations_versees').select('*').eq('maison_id', userProfile.maison_id).eq('annee', annee)),
                    fetchAll(() => sb.from('profiles').select('*').eq('maison_id', userProfile.maison_id))
                ]);
            } catch (e) { container.innerHTML = `<p class="text-center text-red-400 text-[11px] font-bold py-8">Erreur de chargement</p>`; return; }
            const avs = avsAll.filter(allocConfirmee);

            const totalAlloc   = avs.reduce((s,a)=>s+parseFloat(a.montant),0);
            const totalDep     = txs.filter(t=>t.type==='depense').reduce((s,t)=>s+parseFloat(t.montant),0);
            const totalRec     = txs.filter(t=>t.type==='recette').reduce((s,t)=>s+parseFloat(t.montant),0);
            const totalAttente = txs.filter(t=>t.type==='depense'&&t.statut==='attente').reduce((s,t)=>s+parseFloat(t.montant),0);
            const solde        = totalAlloc + totalRec - totalDep;

            // Par membre
            const byMembre = {};
            membres.filter(m => m.actif !== false || txs.some(t=>t.user_id===m.id) || avs.some(a=>a.user_id===m.id)).forEach(m => {
                const mTxs = txs.filter(t=>t.user_id===m.id);
                const mAvs = avs.filter(a=>a.user_id===m.id);
                byMembre[m.id] = {
                    name: `${m.prenom} ${m.nom||''}`.trim() + (m.actif===false?' (désactivé)':''),
                    alloc: mAvs.reduce((s,a)=>s+parseFloat(a.montant),0),
                    dep:   mTxs.filter(t=>t.type==='depense').reduce((s,t)=>s+parseFloat(t.montant),0),
                    moisVerses: mAvs.length
                };
            });

            // Top motifs maison
            const motifMap = {};
            txs.filter(t=>t.type==='depense').forEach(t => {
                motifMap[t.motif||'Autre'] = (motifMap[t.motif||'Autre']||0)+parseFloat(t.montant);
            });
            const topMotifs = Object.entries(motifMap).sort((a,b)=>b[1]-a[1]).slice(0,5);

            container.innerHTML = `
                <div class="grid grid-cols-2 gap-3 anim-slide">
                    <div class="bg-white rounded-[24px] border border-emerald-100 p-5">
                        <p class="text-[8px] font-black uppercase text-slate-400 tracking-widest mb-1">Allocations reçues</p>
                        <p class="text-2xl font-black text-emerald-600">${totalAlloc.toFixed(2)}€</p>
                    </div>
                    <div class="bg-white rounded-[24px] border border-slate-100 shadow-premium p-5">
                        <p class="text-[8px] font-black uppercase text-slate-400 tracking-widest mb-1">Dépenses maison</p>
                        <p class="text-2xl font-black text-slate-800">${totalDep.toFixed(2)}€</p>
                    </div>
                    <div class="bg-white rounded-[24px] border border-slate-100 shadow-premium p-5">
                        <p class="text-[8px] font-black uppercase text-slate-400 tracking-widest mb-1">Recettes</p>
                        <p class="text-2xl font-black text-red-700">+${totalRec.toFixed(2)}€</p>
                    </div>
                    <div class="bg-white rounded-[24px] border ${solde<0?'border-red-100':'border-emerald-100'} p-5">
                        <p class="text-[8px] font-black uppercase text-slate-400 tracking-widest mb-1">Solde annuel</p>
                        <p class="text-2xl font-black ${solde<0?'text-red-500':'text-emerald-600'}">${solde<0?'':'+'}${solde.toFixed(2)}€</p>
                    </div>
                </div>

                ${totalAttente>0?`<div class="bg-amber-50 border border-amber-100 rounded-[24px] p-4 anim-slide">
                    <p class="text-[10px] font-black text-amber-700 uppercase tracking-widest">⚠️ ${totalAttente.toFixed(2)}€ en attente de remboursement</p>
                </div>`:''}

                <div class="bg-white rounded-[28px] border border-slate-100 shadow-premium overflow-hidden anim-slide" style="animation-delay:.05s">
                    <div class="px-5 py-4 border-b border-slate-50">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-700">Par membre</p>
                    </div>
                    <div class="divide-y divide-slate-50">
                        ${Object.values(byMembre).map(m=>`
                        <div class="px-5 py-3 flex justify-between items-center">
                            <div>
                                <p class="text-[10px] font-black uppercase text-slate-700">${escapeHtml(m.name)}</p>
                                <p class="text-[8px] text-slate-400 font-bold">${m.moisVerses} mois versés</p>
                            </div>
                            <div class="text-right">
                                <p class="text-[11px] font-black text-emerald-600">${m.alloc.toFixed(2)}€ alloc</p>
                                <p class="text-[9px] text-slate-400 font-bold">${m.dep.toFixed(2)}€ dép</p>
                            </div>
                        </div>`).join('')}
                    </div>
                </div>

                ${topMotifs.length>0?`
                <div class="bg-white rounded-[28px] border border-slate-100 shadow-premium overflow-hidden anim-slide" style="animation-delay:.1s">
                    <div class="px-5 py-4 border-b border-slate-50">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-700">Top dépenses maison</p>
                    </div>
                    <div class="divide-y divide-slate-50">
                        ${topMotifs.map(([motif,total],i)=>`
                        <div class="px-5 py-3 flex justify-between items-center">
                            <div class="flex items-center gap-3">
                                <span class="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[9px] font-black text-slate-500">${i+1}</span>
                                <p class="text-[10px] font-black uppercase text-slate-700">${escapeHtml(motif)}</p>
                            </div>
                            <p class="text-[11px] font-black text-slate-800">${total.toFixed(2)}€</p>
                        </div>`).join('')}
                    </div>
                </div>`:''}
            `;
        }

        let extraPhotos = []; // photos supplémentaires pour le scan

        function ajouterPhotosExtra(input) {
            const files = Array.from(input.files);
            if (!files.length) return;
            extraPhotos = [...extraPhotos, ...files];
            const grid = document.getElementById('scan-extra-previews');
            if (!grid) return;
            grid.innerHTML = extraPhotos.map((f, i) => {
                const url = URL.createObjectURL(f);
                return `<div class="relative">
                    <img src="${url}" class="w-14 h-14 object-cover rounded-xl border border-slate-100">
                    <button onclick="supprimerPhotoExtra(${i})" class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[9px] font-black flex items-center justify-center" aria-label="Supprimer">✕</button>
                </div>`;
            }).join('');
        }

        function supprimerPhotoExtra(idx) {
            extraPhotos.splice(idx, 1);
            ajouterPhotosExtra({ files: [] });
            const grid = document.getElementById('scan-extra-previews');
            if (grid) grid.innerHTML = extraPhotos.map((f, i) => {
                const url = URL.createObjectURL(f);
                return `<div class="relative">
                    <img src="${url}" class="w-14 h-14 object-cover rounded-xl border border-slate-100">
                    <button onclick="supprimerPhotoExtra(${i})" class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[9px] font-black flex items-center justify-center" aria-label="Supprimer">✕</button>
                </div>`;
            }).join('');
        }

        function setLoading(btnId, loading, step) {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            if (loading) {
                btn.disabled = true;
                btn.dataset.originalText = btn.textContent;
                btn.innerHTML = `<span class="btn-spinner"></span>${step||'Chargement...'}`;
            } else {
                btn.disabled = false;
                btn.textContent = btn.dataset.originalText || 'Enregistrer';
            }
        }

        // ── INIT ──
        async function checkAuth() {
            const { data: { user } } = await sb.auth.getUser();
            if (!user) { window.location.href="index.html"; return; }
            const { data: profile } = await sb.from('profiles').select('*, maisons(*)').eq('id', user.id).single();
            if (!profile || profile.role !== 'chef') { window.location.href="index.html"; return; }
            if (!(await verifierCompteActif(profile))) return;
            userProfile = profile;

            const fullName = `${profile.prenom} ${profile.nom||''}`.trim();
            document.getElementById('user-name').textContent = fullName;
            document.getElementById('maison-name').textContent = `Maison ${profile.maisons?.nom||''}`;
            document.getElementById('compact-name').textContent = fullName;
            document.getElementById('compact-maison').textContent = profile.maisons?.nom||'';
            document.getElementById('tx-date').valueAsDate = new Date();
            document.getElementById('settings-iban').value = profile.iban||'';
            document.getElementById('settings-allocation').value = parseFloat(profile.allocation_mensuelle)||'';

            loadMotifs();
            initResumeAnnee();
            initJournalFiltres();
            await refreshAll();
            checkNotifications();
            initChefAllocBtn();
            checkUnreadMessages();
            initAppUpdate();
            initPullToRefresh(async () => { await refreshAll(); if (document.getElementById('section-journal')?.classList.contains('active')) await loadJournal(); });
        }

        async function refreshAll() {
            await Promise.all([refreshSoldes(), loadAvancesChef(), loadVersements(), loadMembres()]);
        }

        async function refreshSoldes() {
            let txs, avs;
            try {
                [txs, avs] = await Promise.all([
                    fetchAll(() => sb.from('transactions').select('user_id,type,montant').eq('maison_id', userProfile.maison_id)),
                    fetchAll(() => sb.from('allocations_versees').select('user_id,montant,statut').eq('maison_id', userProfile.maison_id))
                ]);
            } catch (e) { showToast("Erreur de chargement","error"); return; }
            avs = avs.filter(allocConfirmee);

            const houseAlloc = (avs||[]).reduce((s,a)=>s+parseFloat(a.montant),0);
            const houseDep   = (txs||[]).filter(t=>t.type==='depense').reduce((s,t)=>s+parseFloat(t.montant),0);
            const houseRec   = (txs||[]).filter(t=>t.type==='recette').reduce((s,t)=>s+parseFloat(t.montant),0);
            const myAvs      = (avs||[]).filter(a=>a.user_id===userProfile.id).reduce((s,a)=>s+parseFloat(a.montant),0);
            const myTx       = (txs||[]).filter(t=>t.user_id===userProfile.id);
            const myDep      = myTx.filter(t=>t.type==='depense').reduce((s,t)=>s+parseFloat(t.montant),0);
            const myRec      = myTx.filter(t=>t.type==='recette').reduce((s,t)=>s+parseFloat(t.montant),0);
            const maisTotal  = houseAlloc+houseRec-houseDep;
            const perso      = myAvs+myRec-myDep;
            const alloc      = parseFloat(userProfile.allocation_mensuelle)||0;

            animCounter(document.getElementById('solde-maison'), maisTotal);
            animCounter(document.getElementById('solde-perso'),  perso);
            const compEl = document.getElementById('compact-maison-solde');
            compEl.textContent = maisTotal.toFixed(2)+'€';
            compEl.style.color = maisTotal < 0 ? '#ef4444' : '';
            document.getElementById('alloc-badge').textContent = alloc>0 ? `${alloc.toFixed(2)}€/mois` : 'Allocation non définie';
        }

        async function loadAvancesChef() {
            let data, justifSet;
            try {
                data = await fetchAll(() => sb.from('transactions')
                    .select('*, profiles(prenom,nom,iban)')
                    .eq('maison_id', userProfile.maison_id)
                    .eq('type', 'depense')
                    .eq('statut', 'attente')
                    .order('created_at', { ascending: true }));
                justifSet = await idsAvecJustif(data.map(t => t.id));
            } catch (e) { showToast("Erreur de chargement des remboursements","error"); return; }
            data.forEach(t => { t._hasJustif = justifSet.has(t.id); });

            if (!data || data.length === 0) {
                document.getElementById('total-dettes').classList.add('hidden');
                document.getElementById('list-avances-attente').innerHTML =
                    `<div class="text-center py-12"><svg class="w-10 h-10 mx-auto mb-2 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><p class="text-slate-300 text-[11px] font-black uppercase tracking-widest">Aucun remboursement en attente</p></div>`;
                return;
            }

            const totalDettes = data.reduce((s,t)=>s+parseFloat(t.montant),0);
            const badge = document.getElementById('total-dettes');
            badge.classList.remove('hidden');
            badge.textContent = `Total : ${totalDettes.toFixed(2)}€`;

            // Grouper par membre → puis par mois
            const byMember = {};
            data.forEach(t => {
                const uidKey = t.user_id || 'null';
                if (!byMember[uidKey]) byMember[uidKey] = {
                    name: t.profiles ? `${t.profiles.prenom} ${t.profiles.nom||''}`.trim() : 'Membre supprimé',
                    iban: t.profiles?.iban||null, months: {}
                };
                const d = new Date(t.created_at);
                const mKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
                if (!byMember[uidKey].months[mKey]) byMember[uidKey].months[mKey] = { label:`${MOIS_FR[d.getMonth()]} ${d.getFullYear()}`, txs:[], total:0 };
                byMember[uidKey].months[mKey].txs.push(t);
                byMember[uidKey].months[mKey].total += parseFloat(t.montant);
            });

            document.getElementById('list-avances-attente').innerHTML = Object.entries(byMember).map(([uid, member], mi) => {
                const totalMember = Object.values(member.months).reduce((s,m)=>s+m.total,0);
                const monthsHtml = Object.entries(member.months).sort((a,b)=>a[0].localeCompare(b[0])).map(([mKey, month]) => `
                    <div class="bg-amber-50 rounded-2xl border border-amber-100 overflow-hidden mb-3" data-mois-key="${escapeHtml(uid)}-${escapeHtml(mKey)}">
                        <div class="flex justify-between items-center px-4 py-3 border-b border-amber-100/60">
                            <p class="text-[10px] font-black uppercase text-amber-700 tracking-wider">${escapeHtml(month.label)}</p>
                            <p class="text-[12px] font-black text-slate-800">${month.total.toFixed(2)}€</p>
                        </div>
                        <div class="divide-y divide-amber-50">
                            ${month.txs.map(t=>`
                            <div class="px-4 py-2.5 flex justify-between items-start">
                                <div class="flex-1 min-w-0">
                                    <p class="text-[10px] font-bold text-slate-700">${escapeHtml(t.motif||'-')}</p>
                                    <p class="text-[8px] text-slate-400">${new Date(t.created_at).toLocaleDateString('fr-FR')}${t.commentaire?' · '+escapeHtml(t.commentaire):''}</p>
                                    ${t.justificatif_url || t._hasJustif
                                        ? `<button onclick="previewJustificatif('${escapeHtml(t.id)}','${escapeHtml(t.justificatif_url||'')}')" class="text-[8px] font-black text-emerald-500 uppercase">✓ Justificatif joint — voir</button>`
                                        : `<span class="sans-justif sans-justif-${t.user_id} text-[8px] font-black text-red-400 uppercase">⚠️ Sans justificatif</span>`}
                                </div>
                                <p class="text-[11px] font-black text-slate-700 flex-shrink-0 ml-2">${parseFloat(t.montant).toFixed(2)}€</p>
                            </div>`).join('')}
                        </div>
                        <div class="px-4 pb-3 pt-2">
                            <button onclick="validerMois('${escapeHtml(uid)}','${escapeHtml(mKey)}',${month.total.toFixed(2)})"
                                class="w-full bg-amber-500 text-white py-2.5 rounded-xl text-[10px] font-black uppercase shadow-md active:scale-95 transition-all">
                                Valider virement ${month.total.toFixed(2)}€
                            </button>
                        </div>
                    </div>`).join('');

                return `<div class="bg-white p-5 rounded-[28px] border border-amber-100 shadow-sm anim-slide" style="animation-delay:${mi*.06}s">
                    <div class="flex justify-between items-center mb-4">
                        <div class="flex items-center gap-3">
                            <div class="w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-black text-xs flex-shrink-0">${escapeHtml(member.name.charAt(0))}</div>
                            <p class="font-black text-[12px] uppercase tracking-wider text-slate-800">${escapeHtml(member.name)}</p>
                        </div>
                        <p class="font-black text-base text-slate-900">${totalMember.toFixed(2)}€</p>
                    </div>
                    <div class="bg-slate-50 p-3 rounded-2xl flex items-center justify-between gap-3 mb-4">
                        <p class="text-[9px] font-mono text-slate-500 truncate flex-1 uppercase">${member.iban?escapeHtml(member.iban):'IBAN MANQUANT'}</p>
                        ${member.iban?`<button onclick="copyIban('${escapeHtml(member.iban)}')" class="text-[9px] font-black text-red-700 uppercase flex-shrink-0 hover:text-red-800 transition-colors">Copier</button>`:''}
                    </div>
                    ${monthsHtml}
                    <button onclick="validerTout('${escapeHtml(uid)}',${totalMember.toFixed(2)})"
                        class="w-full bg-slate-900 text-white py-3.5 rounded-2xl text-[10px] font-black uppercase shadow-lg active:scale-95 transition-all">
                        Tout valider — ${totalMember.toFixed(2)}€
                    </button>
                </div>`;
            }).join('');
        }

        function validerMois(uid, moisKey, montant) {
            showConfirm(`Confirmer le virement de ${montant}€ pour ce mois ?`, ()=>_doValiderMois(uid, moisKey, montant), 'Valider');
        }
        // uid 'null' = avances d'un membre supprimé (user_id vide)
        function filtreMembre(q, uid) { return uid === 'null' ? q.is('user_id', null) : q.eq('user_id', uid); }

        async function _doValiderMois(uid, moisKey, montant) {
            const [year, month] = moisKey.split('-');
            const { debut, fin } = bornesMois(year, month);
            const { error } = await filtreMembre(sb.from('transactions')
                .update({ statut:'valide', date_validation:new Date().toISOString() })
                .eq('maison_id', userProfile.maison_id).eq('type','depense').eq('statut','attente')
                .gte('created_at', debut).lt('created_at', fin), uid);
            if (error) { showToast("Erreur : "+error.message,"error"); return; }
            if (uid !== 'null') {
                const { error: nErr } = await sb.from('notifications').insert([{
                    user_id:uid, lu:false, type:'remboursement',
                    message:`Votre chef de maison a effectué un virement de ${parseFloat(montant).toFixed(2)}€ pour vos avances du mois de ${MOIS_FR[parseInt(month)-1]} ${year}.`
                }]);
                if (nErr) showToast("Virement validé, mais le membre n'a pas pu être notifié","warning");
            }
            showToast("Virement validé !","success"); refreshAll();
        }

        function validerTout(uid, montantTotal) {
            showConfirm(`Confirmer le virement global de ${montantTotal.toFixed(2)}€ ?`, ()=>_doValiderTout(uid, montantTotal), 'Valider');
        }
        async function _doValiderTout(uid, montantTotal) {
            const { error } = await filtreMembre(sb.from('transactions')
                .update({ statut:'valide', date_validation:new Date().toISOString() })
                .eq('maison_id', userProfile.maison_id).eq('type','depense').eq('statut','attente'), uid);
            if (error) { showToast("Erreur : "+error.message,"error"); return; }
            if (uid !== 'null') {
                const { error: nErr } = await sb.from('notifications').insert([{
                    user_id:uid, lu:false, type:'remboursement',
                    message:`Votre chef de maison a effectué un virement global de ${montantTotal.toFixed(2)}€ pour toutes vos avances de frais.`
                }]);
                if (nErr) showToast("Virement validé, mais le membre n'a pas pu être notifié","warning");
            }
            showToast("Remboursement validé !","success"); refreshAll();
        }

        // ── VERSEMENTS TIMELINE ──
        function getMoisDepuis2026() {
            const liste=[], debut=new Date(2026,0,1), now=new Date();
            let cur=new Date(debut);
            while(cur<=now){ liste.push({mois:cur.getMonth()+1, annee:cur.getFullYear()}); cur.setMonth(cur.getMonth()+1); }
            return liste.reverse();
        }

        // ── ALLOCATIONS : le membre déclare, le chef confirme ──
        let _pushVersementsMontre = false;
        async function loadVersements() {
            let membres, vers;
            try {
                [membres, vers] = await Promise.all([
                    fetchAll(() => sb.from('profiles').select('*').eq('maison_id', userProfile.maison_id).order('prenom')),
                    fetchAll(() => sb.from('allocations_versees').select('*').eq('maison_id', userProfile.maison_id))
                ]);
            } catch (e) { showToast("Erreur de chargement des versements","error"); return; }
            const allMois = getMoisDepuis2026();
            const now = new Date(), moisCur=now.getMonth()+1, anneeCur=now.getFullYear();
            const trouver = (uid, mois, annee) => vers.find(v=>v.user_id===uid&&parseInt(v.mois)===mois&&parseInt(v.annee)===annee);

            // Badge : mois courant non confirmé + déclarations en attente (tous mois)
            const actifsAlloc = membres.filter(m=>m.actif!==false && parseFloat(m.allocation_mensuelle)>0);
            const nonConfCur = actifsAlloc.filter(m=>{ const v=trouver(m.id,moisCur,anneeCur); return !v || !allocConfirmee(v); });
            const aConfirmer = vers.filter(v=>!allocConfirmee(v)).length;
            const dot = document.getElementById('fab-badge');
            const nb = Math.max(nonConfCur.length, aConfirmer);
            if (dot) { dot.classList.toggle('hidden', nb===0); dot.textContent = nb; }
            if (aConfirmer>0 && !_pushVersementsMontre) {
                _pushVersementsMontre = true;
                showPushNotif('Versements à confirmer', `${aConfirmer} déclaration${aConfirmer>1?'s':''} de versement en attente`, '⚠️', 7000);
            }

            document.getElementById('list-versements').innerHTML = allMois.map(({mois, annee}, idx) => {
                const isCur = mois===moisCur && annee===anneeCur;
                const moisLabel = `${MOIS_FR[mois-1]} ${annee}`;
                // Membres concernés : actifs avec allocation, ou toute personne ayant une ligne ce mois-là
                const concernes = membres.filter(m => (m.actif!==false && parseFloat(m.allocation_mensuelle)>0) || trouver(m.id,mois,annee));
                const sansAlloc = membres.filter(m => m.actif!==false && !(parseFloat(m.allocation_mensuelle)>0) && !trouver(m.id,mois,annee));
                const nonConf = concernes.filter(m => { const v=trouver(m.id,mois,annee); return !v || !allocConfirmee(v); });
                const totalMois  = concernes.reduce((s,m)=>{ const v=trouver(m.id,mois,annee); return s+(v?parseFloat(v.montant):parseFloat(m.allocation_mensuelle)||0); },0);
                const totalConf  = concernes.reduce((s,m)=>{ const v=trouver(m.id,mois,annee); return s+(v&&allocConfirmee(v)?parseFloat(v.montant):0); },0);

                const rows = concernes.map(m => {
                    const v = trouver(m.id,mois,annee);
                    const etat = !v ? 'aucun' : (allocConfirmee(v) ? 'confirme' : 'declare');
                    const montant = v ? parseFloat(v.montant) : parseFloat(m.allocation_mensuelle)||0;
                    const nomAff = `${m.prenom} ${m.nom||''}`.trim();
                    const info = etat==='confirme' ? '✓ Confirmé le '+new Date(v.date_confirmation||v.created_at).toLocaleDateString('fr-FR')
                               : etat==='declare' ? '⏳ Déclaré le '+new Date(v.created_at).toLocaleDateString('fr-FR')+' — appuyer pour confirmer'
                               : 'Pas encore versé';
                    return `<button type="button"
                        data-uid="${escapeHtml(m.id)}" data-nom="${escapeHtml(nomAff)}" data-mois="${mois}" data-annee="${annee}" data-montant="${montant}" data-vid="${v?escapeHtml(v.id):''}" data-etat="${etat}"
                        onclick="chefToggleVersement(this)"
                        class="w-full flex items-center justify-between py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors rounded-xl px-2 -mx-2 active:scale-[.98]">
                        <div class="flex items-center gap-3">
                            <span class="w-6 h-6 rounded-lg flex-shrink-0 flex items-center justify-center transition-all ${etat==='confirme'?'bg-emerald-500':etat==='declare'?'bg-amber-400':'bg-slate-100 border-2 border-slate-200'}">
                                ${etat!=='aucun'?`<svg class="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`:''}
                            </span>
                            <div class="text-left">
                                <p class="text-[11px] font-black uppercase text-slate-800">${escapeHtml(nomAff)}${m.actif===false?' <span class="text-slate-400">(désactivé)</span>':''}</p>
                                <p class="text-[9px] font-bold ${etat==='confirme'?'text-emerald-600':'text-amber-500'}">${info}</p>
                            </div>
                        </div>
                        <p class="font-black text-[13px] ${etat==='confirme'?'text-emerald-600':etat==='declare'?'text-amber-500':'text-slate-400'}">${montant.toFixed(2)}€</p>
                    </button>`;
                }).join('');

                const rowsBlocked = sansAlloc.map(m=>`
                    <div class="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0 opacity-40 px-2">
                        <div class="flex items-center gap-3">
                            <span class="w-6 h-6 rounded-lg border-2 border-red-200 bg-red-50 flex items-center justify-center text-red-400 text-[10px] font-black flex-shrink-0">!</span>
                            <div>
                                <p class="text-[11px] font-black uppercase text-slate-500">${escapeHtml(m.prenom)} ${escapeHtml(m.nom||'')}</p>
                                <p class="text-[9px] font-bold text-red-400">Allocation non définie</p>
                            </div>
                        </div>
                        <p class="text-[10px] font-black text-red-300">--</p>
                    </div>`).join('');

                return `<div class="bg-white rounded-[28px] border ${isCur?'border-amber-200 shadow-md':'border-slate-100 shadow-sm'} overflow-hidden anim-slide" style="animation-delay:${idx*.03}s">
                    <div class="px-5 py-4 flex justify-between items-center border-b border-slate-50">
                        <div class="flex items-center gap-2.5">
                            <span class="w-2 h-2 rounded-full ${isCur?'bg-amber-400 pulse-amber':'bg-slate-200'}"></span>
                            <p class="font-black text-[13px] uppercase tracking-widest text-slate-800">${moisLabel}</p>
                        </div>
                        <span class="text-[10px] font-black uppercase tracking-widest ${nonConf.length===0?'text-emerald-600':'text-amber-500'}">
                            ${nonConf.length===0?'✓ Complet':`${nonConf.length} à confirmer`}
                        </span>
                    </div>
                    <div class="px-5 py-1">${rows}${rowsBlocked}</div>
                    <div class="px-5 pb-4 pt-2 flex justify-between items-center">
                        <p class="text-[9px] text-slate-300 font-bold uppercase tracking-widest">${concernes.length} membre${concernes.length>1?'s':''}</p>
                        <p class="text-[11px] font-black ${totalConf>=totalMois?'text-emerald-600':'text-amber-500'}">${totalConf.toFixed(2)}€ / ${totalMois.toFixed(2)}€</p>
                    </div>
                </div>`;
            }).join('');
        }

        // aucun → confirmé directement · déclaré → confirmé · confirmé → annulé (avec confirmation)
        async function chefToggleVersement(btn) {
            const { uid, nom, vid, etat } = btn.dataset;
            const mois = parseInt(btn.dataset.mois), annee = parseInt(btn.dataset.annee), montant = parseFloat(btn.dataset.montant);
            const label = `${nom} — ${MOIS_FR[mois-1]} ${annee}`;
            const apres = async () => { await loadVersements(); refreshSoldes(); };
            if (etat === 'confirme') {
                showConfirm(`Annuler le versement confirmé de ${label} (${montant.toFixed(2)}€) ?`, async () => {
                    const { error } = await sb.from('allocations_versees').delete().eq('id', vid).eq('maison_id', userProfile.maison_id);
                    if (error) return showToast("Erreur : "+error.message,"error");
                    showToast(`${label} annulé`,"info"); apres();
                }, 'Annuler le versement', true);
                return;
            }
            btn.disabled = true;
            let error;
            if (etat === 'declare') {
                ({ error } = await sb.from('allocations_versees')
                    .update({ statut:'confirme', valide_par:userProfile.id, date_confirmation:new Date().toISOString() })
                    .eq('id', vid).eq('maison_id', userProfile.maison_id));
            } else {
                if (!(montant > 0)) { btn.disabled=false; return showToast("Allocation non définie pour ce membre","warning"); }
                ({ error } = await sb.from('allocations_versees').insert([{
                    user_id: uid, maison_id: userProfile.maison_id, mois, annee, montant,
                    statut:'confirme', valide_par: userProfile.id, date_confirmation:new Date().toISOString()
                }]));
            }
            btn.disabled = false;
            if (error) return showToast("Erreur : "+error.message,"error");
            showToast(`${label} confirmé`,"success");
            apres();
        }

        async function loadMembres() {
            const { data, error } = await sb.from('profiles').select('*').eq('maison_id', userProfile.maison_id).order('prenom');
            if (error) { showToast("Erreur chargement membres","error"); return; }
            document.getElementById('list-membres').innerHTML = (data||[]).filter(m=>m.actif!==false).map((m,i)=>`
                <div class="bg-white p-5 rounded-[26px] border border-slate-100 shadow-sm anim-slide" style="animation-delay:${i*.04}s">
                    <div class="flex items-center gap-3 mb-4">
                        <div class="w-9 h-9 rounded-full bg-red-900 text-white flex items-center justify-center font-black text-xs flex-shrink-0 italic">${escapeHtml((m.prenom||'?')[0])}</div>
                        <div class="flex-1 min-w-0">
                            <p class="font-black text-[12px] uppercase tracking-wider text-slate-800">${escapeHtml(m.prenom)} ${escapeHtml(m.nom||'')}</p>
                            <p class="text-[9px] font-bold text-slate-400 uppercase">${m.role==='chef'?'Chef de Maison':'Membre'}</p>
                        </div>
                    </div>
                    <!-- Allocation modifiable -->
                    <div class="flex items-center gap-3 bg-red-50 border border-red-100 p-3 rounded-xl mb-3">
                        <span class="text-[9px] font-black text-red-700 uppercase flex-shrink-0">Allocation</span>
                        <input type="number" value="${parseFloat(m.allocation_mensuelle)||0}" step="0.01" min="0"
                            onchange="updateMembreAlloc('${escapeHtml(m.id)}', this.value)"
                            class="flex-1 bg-transparent border-none text-[13px] font-black text-red-800 outline-none min-w-0 text-right">
                        <span class="text-[10px] font-black text-red-700 flex-shrink-0">€/mois</span>
                    </div>
                    <!-- IBAN -->
                    <div class="bg-slate-50 p-3 rounded-2xl flex items-center justify-between gap-3">
                        <p class="text-[9px] font-mono text-slate-500 truncate uppercase">${m.iban?escapeHtml(m.iban):'IBAN NON RENSEIGNÉ'}</p>
                        ${m.iban?`<button onclick="copyIban('${escapeHtml(m.iban)}')" class="text-[9px] font-black text-red-700 uppercase flex-shrink-0 hover:text-red-800 transition-colors">Copier</button>`:''}
                    </div>
                </div>`).join('');
        }

        async function updateMembreAlloc(uid, val) {
            const v = parseFloat(val);
            if (isNaN(v)||v<0) return showToast("Valeur invalide","error");
            const { error } = await sb.from('profiles').update({ allocation_mensuelle:v }).eq('id', uid);
            if (error) showToast("Erreur de mise à jour","error");
            else { showToast("Allocation mise à jour !","success"); loadVersements(); refreshSoldes(); }
        }

        async function submitTransaction() {
            const amount=parseFloat(document.getElementById('tx-amount').value);
            const date=document.getElementById('tx-date').value;
            const note=document.getElementById('tx-note').value.trim();
            const motif=document.getElementById('tx-motif').value;
            const method=document.getElementById('tx-method').value;
            if(!amount||amount<=0) return showToast("Montant invalide","error");
            if(!date) return showToast("Date requise","error");

            setLoading('submit-btn', true, 'Enregistrement...');
            const {error}=await sb.from('transactions').insert([{
                user_id:userProfile.id, maison_id:userProfile.maison_id, montant:amount,
                motif:currentType==='recette'?'RECETTE':motif, commentaire:note||null,
                created_at:dateSaisieVersISO(date), type:currentType,
                methode_paiement:currentType==='recette'?null:method,
                statut:(currentType==='depense'&&estPerso(method))?'attente':'valide',
                justificatif_url: null
            }]);
            setLoading('submit-btn', false);
            if(error){showToast("Erreur : "+error.message,"error");return;}
            document.getElementById('tx-amount').value='';
            document.getElementById('tx-note').value='';
            showSuccess('Enregistré !');
            refreshAll();
            if (document.getElementById('section-journal')?.classList.contains('active')) loadJournal();
        }

        async function loadMotifs() {
            const {data}=await sb.from('motifs').select('nom').order('nom');
            const opts=(data||[]).map(m=>`<option value="${escapeHtml(m.nom)}">${escapeHtml(m.nom.toUpperCase())}</option>`).join('');
            document.getElementById('tx-motif').innerHTML=opts;
            const scanMotif=document.getElementById('scan-motif');
            if(scanMotif) scanMotif.innerHTML=opts;
            const editMotif=document.getElementById('edit-motif');
            if(editMotif) editMotif.innerHTML=opts;
            const journalMotif=document.getElementById('journal-motif');
            if(journalMotif) {
                journalMotif.innerHTML='<option value="all">Tous les motifs</option>' +
                    '<option value="RECETTE">Recettes</option>' +
                    (data||[]).map(m=>`<option value="${escapeHtml(m.nom)}">${escapeHtml(m.nom)}</option>`).join('');
            }
        }

        function setTxType(type) {
            currentType=type; const isR=type==='recette';
            document.getElementById('container-motif').classList.toggle('hidden',isR);
            document.getElementById('container-paiement').classList.toggle('hidden',isR);
            const scanEl=document.getElementById('container-scan');
            if(scanEl) scanEl.classList.toggle('hidden',isR);
            document.getElementById('tab-depense').className=`tab-btn ${isR?'':'tab-active'} flex-1 py-3.5 rounded-[18px] font-black text-[11px] uppercase tracking-widest ${isR?'text-slate-400':''}`;
            document.getElementById('tab-recette').className=`tab-btn ${isR?'tab-recette-act':''} flex-1 py-3.5 rounded-[18px] font-black text-[11px] uppercase tracking-widest ${isR?'':'text-slate-400'}`;
        }

        async function updateAllocation() {
            const val=parseFloat(document.getElementById('settings-allocation').value);
            if(isNaN(val)||val<0) return showToast("Montant invalide","error");
            const{error}=await sb.from('profiles').update({allocation_mensuelle:val}).eq('id',userProfile.id);
            if(error){showToast("Erreur","error");return;}
            userProfile.allocation_mensuelle=val;
            showToast("Allocation mise à jour !","success");
            refreshSoldes(); loadVersements();
            // Rafraîchir l'état du bouton toggle
            initChefAllocBtn();
        }

        async function initChefAllocBtn() {
            const alloc=parseFloat(userProfile.allocation_mensuelle)||0;
            const btn=document.getElementById('btn-chef-alloc');
            if(!btn) return;
            if(alloc<=0){ btn.classList.add('hidden'); return; }
            btn.classList.remove('hidden');
            const now=new Date(),mois=now.getMonth()+1,annee=now.getFullYear();
            const{data}=await sb.from('allocations_versees').select('id,statut').eq('user_id',userProfile.id).eq('mois',mois).eq('annee',annee).maybeSingle();
            setAllocBtnState(!!data && allocConfirmee(data), mois, annee, alloc);
        }

        async function toggleAllocation() {
            const alloc=parseFloat(userProfile.allocation_mensuelle)||0;
            if(alloc<=0) return showToast("Allocation non définie","warning");
            const now=new Date(),mois=now.getMonth()+1,annee=now.getFullYear();
            const btn=document.getElementById('btn-chef-alloc');
            if(btn){btn.textContent='...';btn.disabled=true;}

            const{data:existing}=await sb.from('allocations_versees').select('id,statut')
                .eq('user_id',userProfile.id).eq('mois',mois).eq('annee',annee).maybeSingle();

            if(existing && !allocConfirmee(existing)){
                const{error}=await sb.from('allocations_versees').update({statut:'confirme',valide_par:userProfile.id,date_confirmation:new Date().toISOString()}).eq('id',existing.id);
                if(error){showToast("Erreur : "+error.message,"error");}
                else{showToast(`Allocation de ${MOIS_FR[mois-1]} ${annee} confirmée`,"success");setAllocBtnState(true,mois,annee,alloc);refreshSoldes();loadVersements();}
            } else if(existing){
                const{error}=await sb.from('allocations_versees').delete().eq('id',existing.id);
                if(error){showToast("Erreur","error");}
                else{showToast(`Allocation de ${MOIS_FR[mois-1]} ${annee} annulée`,"info");setAllocBtnState(false,mois,annee,alloc);refreshSoldes();loadVersements();}
            } else {
                const{error}=await sb.from('allocations_versees').insert([{
                    user_id:userProfile.id,maison_id:userProfile.maison_id,
                    mois,annee,montant:alloc,valide_par:userProfile.id,
                    statut:'confirme',date_confirmation:new Date().toISOString()
                }]);
                if(error){showToast("Erreur","error");}
                else{showToast(`Allocation de ${MOIS_FR[mois-1]} ${annee} déclarée !`,"success");setAllocBtnState(true,mois,annee,alloc);refreshSoldes();loadVersements();}
            }
            if(btn){btn.disabled=false;}
        }

        function setAllocBtnState(versee, mois, annee, alloc) {
            const btn=document.getElementById('btn-chef-alloc');
            if(!btn) return;
            if(versee){
                btn.className='w-full bg-emerald-500 text-white font-black py-3.5 rounded-xl uppercase text-[10px] tracking-widest active:scale-95 transition-all shadow-md shadow-emerald-500/20';
                btn.textContent=`✓ Allocation ${MOIS_FR[mois-1]} versée — Annuler`;
            } else {
                btn.className='w-full bg-amber-500 text-white font-black py-3.5 rounded-xl uppercase text-[10px] tracking-widest active:scale-95 transition-all shadow-md shadow-amber-500/20';
                btn.textContent=`🏠 Déclarer mon versement du mois`;
            }
        }
        async function updateIban() {
            const raw=document.getElementById('settings-iban').value.trim();
            const errEl=document.getElementById('iban-error');
            if(raw&&!validateIban(raw)){errEl.classList.remove('hidden');return;}
            errEl.classList.add('hidden');
            const normalized=raw?normalizeIban(raw):null;
            const{error}=await sb.from('profiles').update({iban:normalized}).eq('id',userProfile.id);
            if(error){showToast("Erreur","error");return;}
            userProfile.iban=normalized; showToast("IBAN mis à jour !","success"); loadMembres();
        }
        async function updatePassword() {
            const p=document.getElementById('settings-pass').value;
            if(p.length<6) return showToast("6 caractères minimum","error");
            const{error}=await sb.auth.updateUser({password:p});
            if(error) showToast(error.message,"error");
            else{showToast("Mot de passe modifié !","success");document.getElementById('settings-pass').value='';}
        }



        function copyIban(iban) {
            navigator.clipboard.writeText(iban).then(()=>showToast("IBAN copié !","success")).catch(()=>showToast("Impossible de copier","error"));
        }

        function closeAllocReminder() {
            document.getElementById('alloc-reminder-modal').classList.add('hidden');
            _goTab('versements');
        }

        async function checkNotifications() {
            const { data } = await sb.from('notifications').select('*')
                .eq('user_id', userProfile.id).eq('lu', false)
                .order('created_at', { ascending: false });
            if (data && data.length) data.forEach(n => afficherNotif(n));

            sb.channel('notifs-chef-' + userProfile.id)
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${userProfile.id}`
                }, payload => afficherNotif(payload.new))
                .subscribe();
        }

        function afficherNotif(n) {
            const container = document.getElementById('notif-container');
            if (document.querySelector(`[data-notif="${n.id}"]`)) return;
            const el = document.createElement('div');
            el.className = 'pointer-events-auto bg-emerald-600 text-white rounded-2xl px-4 py-3 flex justify-between items-center gap-3 shadow-lg anim-slide';
            el.dataset.notif = n.id;
            el.innerHTML = `
                <p class="text-[11px] font-bold leading-snug flex-1">🔔 ${escapeHtml(n.message)}</p>
                <button onclick="markNotifRead('${escapeHtml(n.id)}')" class="text-white/70 hover:text-white font-black text-lg leading-none flex-shrink-0" aria-label="Marquer comme lu">✓</button>`;
            container.prepend(el);
        }

        async function markNotifRead(id) {
            await sb.from('notifications').update({ lu: true }).eq('id', id).eq('user_id', userProfile.id);
            const el = document.querySelector(`[data-notif="${id}"]`);
            if (el) { el.style.cssText='opacity:0;transform:translateY(-8px);transition:all .2s'; setTimeout(()=>el.remove(),200); }
        }

        // ── EXPORT EXCEL ──

        function goToProfil() { _goTab('profil'); }


        function goSaisie() { _goTab('saisie'); }
        function menuGo(name, cb) { _goTab(name, cb); }

        let _navOpen = false;
        let _activeTab = 'saisie';

        function _goTab(name, cb) {
            _navOpen && _closeNav();
            const prevIdx = TAB_ORDER.indexOf(_activeTab);
            const nextIdx = TAB_ORDER.indexOf(name);
            const dir = nextIdx > prevIdx ? 'slide-left' : 'slide-right';
            _activeTab = name;
            document.querySelectorAll('.section-panel').forEach(s => {
                s.classList.remove('active','slide-left','slide-right');
            });
            const el = document.getElementById('section-'+name);
            if (el) {
                el.classList.add('active');
                if (prevIdx !== nextIdx && prevIdx !== -1 && nextIdx !== -1) {
                    el.classList.add(dir);
                    setTimeout(() => el.classList.remove(dir), 350);
                }
            }
            window.scrollTo({top:0,behavior:'smooth'});
            if (cb) setTimeout(cb, 50);
            _updateFabIcon();
        }

        function _updateFabIcon() {
            const btn = document.getElementById('fab-menu');
            if (_activeTab === 'saisie') {
                btn.style.background = '#f8fafc';
            } else {
                btn.style.background = 'white';
            }
        }

        function _toggleNav() { _navOpen ? _closeNav() : _openNav(); }

        function _openNav() {
            _navOpen = true;
            document.getElementById('nav-menu').classList.add('open');
            document.getElementById('nav-backdrop').classList.add('open');
            // Update active states
            document.querySelectorAll('.nav-item').forEach(btn => {
                btn.classList.toggle('active-tab', btn.dataset.tab === _activeTab);
            });
            // Rotate icon
            document.getElementById('fab-menu-icon').style.transform = 'rotate(90deg)';
        }

        function _closeNav() {
            _navOpen = false;
            document.getElementById('nav-menu').classList.remove('open');
            document.getElementById('nav-backdrop').classList.remove('open');
            document.getElementById('fab-menu-icon').style.transform = '';
        }


        // ── JUSTIFICATIF UPLOAD (chef) ──
        let justifPhotos = [];

        function ajouterPhotosJustif(input) {
            const files = Array.from(input.files);
            if (!files.length) return;
            justifPhotos = [...justifPhotos, ...files];
            const grid = document.getElementById('justif-preview-grid');
            const section = document.getElementById('justif-previews');
            const count = document.getElementById('justif-preview-count');
            const valBtn = document.getElementById('justif-valider-btn');
            if (!justifPhotos.length) {
                section.classList.add('hidden'); valBtn.classList.add('hidden'); return;
            }
            section.classList.remove('hidden');
            valBtn.classList.remove('hidden');
            count.textContent = `${justifPhotos.length} photo${justifPhotos.length>1?'s':''}`;
            grid.innerHTML = justifPhotos.map((f, i) => {
                const url = URL.createObjectURL(f);
                return `<div class="relative">
                    <img src="${url}" class="w-full h-20 object-cover rounded-xl border border-slate-100">
                    <button onclick="supprimerPhotoJustifChef(${i})" class="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] font-black flex items-center justify-center shadow-md" aria-label="Supprimer">✕</button>
                </div>`;
            }).join('');
        }

        function supprimerPhotoJustifChef(idx) {
            justifPhotos.splice(idx, 1);
            ajouterPhotosJustif({ files: [] });
        }

        async function validerJustificatif() {
            if (!justifPhotos.length) return showToast('Ajoutez au moins une photo', 'warning');
            const txId = document.getElementById('justif-tx-id').value;
            const prog = document.getElementById('justif-upload-progress');
            const progTxt = document.getElementById('justif-upload-text');
            const valBtn = document.getElementById('justif-valider-btn');
            valBtn.classList.add('hidden');
            prog.classList.remove('hidden');
            try {
                progTxt.textContent = `Sauvegarde ${justifPhotos.length} photo${justifPhotos.length>1?'s':''}...`;
                await sauvegarderImagesJustificatif(txId, justifPhotos);

                justifPhotos = [];
                prog.classList.add('hidden');
                fermerJustifModal();
                showToast('Justificatif ajouté !', 'success');
                await loadJournal();
                refreshAll();
            } catch(e) {
                prog.classList.add('hidden');
                valBtn.classList.remove('hidden');
                showToast('Erreur : ' + e.message, 'error');
            }
        }

        async function loadRefundHistory() {
            await loadAvancesChef();
        }


        // ── DÉCONNEXION AUTOMATIQUE (30 min) ──
        let _idleTimer;
        function resetIdleTimer() {
            clearTimeout(_idleTimer);
            _idleTimer = setTimeout(() => {
                showToast('Déconnexion automatique après inactivité', 'warning');
                setTimeout(() => logout(), 2000);
            }, 30 * 60 * 1000);
        }
        ['touchstart','click','keydown','scroll'].forEach(ev =>
            document.addEventListener(ev, resetIdleTimer, { passive: true })
        );
        resetIdleTimer();


        // ── MODAL CONFIRMATION CUSTOM (remplace confirm() natif) ──
        let _confirmCallback = null;
        function showConfirm(msg, onConfirm, btnLabel='Confirmer', danger=false) {
            _confirmCallback = onConfirm;
            document.getElementById('confirm-msg').textContent = msg;
            document.getElementById('confirm-icon').textContent = danger ? '⚠️' : '❓';
            const okBtn = document.getElementById('confirm-ok');
            okBtn.textContent = btnLabel;
            okBtn.className = `flex-1 ${danger ? 'bg-red-600' : 'bg-red-800'} text-white font-black py-4 rounded-2xl uppercase text-[10px] tracking-widest active:scale-95 shadow-lg`;
            document.getElementById('confirm-modal').classList.add('open');
        }
        function _confirmOk() {
            document.getElementById('confirm-modal').classList.remove('open');
            vibrate([8]);
            if (_confirmCallback) { _confirmCallback(); _confirmCallback = null; }
        }
        function _confirmCancel() {
            document.getElementById('confirm-modal').classList.remove('open');
            _confirmCallback = null;
        }


        // ── NOTIFICATIONS PUSH IN-APP ──
        function showPushNotif(title, msg, icon='🔔', duration=5000) {
            const container = document.getElementById('push-container');
            if (!container) return;
            const el = document.createElement('div');
            el.className = 'push-notif';
            el.innerHTML = `
                <span class="push-icon">${icon}</span>
                <div class="push-body">
                    <div class="push-title">${escapeHtml(title)}</div>
                    <div class="push-msg">${escapeHtml(msg)}</div>
                </div>
                <span class="push-close" onclick="this.parentElement.classList.add('hide');setTimeout(()=>this.parentElement.remove(),300)">✕</span>
            `;
            container.appendChild(el);
            if (duration > 0) {
                setTimeout(() => {
                    el.classList.add('hide');
                    setTimeout(() => el.remove(), 300);
                }, duration);
            }
        }


        // ── ICÔNES PAR MOTIF ──
        const MOTIF_ICONS = {
            'alimentaire':  { emoji: '🛒', bg: '#fef3c7', color: '#92400e' },
            'pastorale':    { emoji: '✝️', bg: '#fce7f3', color: '#9d174d' },
            'transport':    { emoji: '🚗', bg: '#dbeafe', color: '#1e40af' },
            'santé':        { emoji: '💊', bg: '#d1fae5', color: '#065f46' },
            'sante':        { emoji: '💊', bg: '#d1fae5', color: '#065f46' },
            'entretien':    { emoji: '🔧', bg: '#f3f4f6', color: '#374151' },
            'vêtements':    { emoji: '👕', bg: '#ede9fe', color: '#5b21b6' },
            'vetements':    { emoji: '👕', bg: '#ede9fe', color: '#5b21b6' },
            'loisirs':      { emoji: '🎭', bg: '#fce7f3', color: '#be185d' },
            'formation':    { emoji: '📚', bg: '#dbeafe', color: '#1d4ed8' },
            'bureau':       { emoji: '📎', bg: '#f3f4f6', color: '#374151' },
            'téléphone':    { emoji: '📱', bg: '#d1fae5', color: '#047857' },
            'telephone':    { emoji: '📱', bg: '#d1fae5', color: '#047857' },
            'electricité':  { emoji: '⚡', bg: '#fef9c3', color: '#854d0e' },
            'electricite':  { emoji: '⚡', bg: '#fef9c3', color: '#854d0e' },
            'eau':          { emoji: '💧', bg: '#dbeafe', color: '#1d4ed8' },
            'repas':        { emoji: '🍽️', bg: '#fef3c7', color: '#92400e' },
            'sortie':       { emoji: '🎉', bg: '#fce7f3', color: '#9d174d' },
            'recette':      { emoji: '💚', bg: '#d1fae5', color: '#065f46' },
            'autre':        { emoji: '📋', bg: '#f3f4f6', color: '#374151' },
        };

        function getMotifIcon(motif, type) {
            if (type === 'recette') return MOTIF_ICONS['recette'];
            const key = (motif || 'autre').toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            return MOTIF_ICONS[key] || { emoji: '📋', bg: '#f3f4f6', color: '#374151' };
        }

        function motifIconHTML(motif, type) {
            const icon = getMotifIcon(motif, type);
            return `<div class="motif-icon" style="background:${icon.bg}">
                <span style="font-size:18px">${icon.emoji}</span>
            </div>`;
        }

        function renderJournalSkeleton(list) {
            list.innerHTML = Array(4).fill(0).map(() => `
                <div class="bg-white rounded-[20px] border border-slate-100 p-4 shadow-premium">
                    <div class="flex items-center gap-3">
                        <div class="skeleton-dark w-9 h-9 rounded-xl flex-shrink-0"></div>
                        <div class="flex-1 space-y-2">
                            <div class="skeleton-dark h-3 w-3/4 rounded-lg"></div>
                            <div class="skeleton-dark h-2.5 w-1/2 rounded-lg"></div>
                        </div>
                        <div class="skeleton-dark h-4 w-16 rounded-lg"></div>
                    </div>
                </div>`).join('');
        }



        // ── VIEWER JUSTIFICATIFS ──
        let _viewerImages = [];
        let _viewerIdx = 0;

        async function previewJustificatif(txId, justifUrl) {
            const images = await chargerImagesJustificatif(txId);

            if (!images.length) {
                // Pas d'images en base — ouvrir l'URL Storage si disponible
                if (justifUrl) {
                    window.open(justifUrl, '_blank');
                } else {
                    showToast('Aucun justificatif disponible', 'warning');
                }
                return;
            }

            _viewerImages = images;
            _viewerIdx = 0;
            ouvrirViewer(0);
        }

        function ouvrirViewer(idx) {
            _viewerIdx = idx;
            const img = _viewerImages[idx];
            const modal = document.getElementById('viewer-modal');
            const title = document.getElementById('viewer-title');
            const nav = document.getElementById('viewer-nav');
            const counter = document.getElementById('viewer-counter');

            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';

            // Title
            title.textContent = `Justificatif ${_viewerImages.length > 1 ? `(${idx+1}/${_viewerImages.length})` : ''}`;

            // Navigation
            if (_viewerImages.length > 1) {
                nav.classList.remove('hidden');
                counter.textContent = `${idx+1} / ${_viewerImages.length}`;
            } else {
                nav.classList.add('hidden');
            }

            // Show correct viewer
            const realMime = detectMimeType(img.base64, img.mime_type);
            const isPdf = realMime.includes('pdf');
            document.getElementById('viewer-img-container').classList.toggle('hidden', isPdf);
            document.getElementById('viewer-pdf-container').classList.toggle('hidden', !isPdf);

            if (isPdf) {
                // PDF — bouton télécharger
                document.getElementById('viewer-pdf-download').onclick = () => telechargerJustificatif(img);
                document.getElementById('viewer-download').onclick = () => telechargerJustificatif(img);
            } else {
                // Image
                document.getElementById('viewer-img').src = img.base64.startsWith('data:') ? img.base64 : `data:${realMime};base64,${img.base64}`;
                document.getElementById('viewer-download').onclick = () => telechargerJustificatif(img);
            }
        }

        function viewerNav(dir) {
            const newIdx = _viewerIdx + dir;
            if (newIdx >= 0 && newIdx < _viewerImages.length) {
                ouvrirViewer(newIdx);
            }
        }

        function fermerViewer() {
            document.getElementById('viewer-modal').classList.add('hidden');
            document.getElementById('viewer-img').src = '';
            document.body.style.overflow = '';
        }

        // Fermer viewer avec swipe down ou Escape
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') fermerViewer();
            if (e.key === 'ArrowLeft') viewerNav(-1);
            if (e.key === 'ArrowRight') viewerNav(1);
        });


        // ── MESSAGERIE ──
        function ouvrirMessagerie() {
            _closeNav();
            localStorage.setItem('smmd_chat_from', window.location.pathname.split('/').pop());
            window.location.href = 'chat.html';
        }

        async function checkUnreadMessages() {
            try {
                // Compter messages non lus
                const { data: convs } = await sb.from('conversations')
                    .select('id')
                    .or(`user1_id.eq.${userProfile.id},user2_id.eq.${userProfile.id}`);
                if (!convs?.length) return;
                const convIds = convs.map(c => c.id);
                const { count } = await sb.from('messages')
                    .select('*', { count: 'exact', head: true })
                    .in('conversation_id', convIds)
                    .eq('lu', false)
                    .neq('sender_id', userProfile.id)
                    .is('deleted_at', null);
                const badge = document.getElementById('msg-badge');
                if (badge) {
                    if (count > 0) {
                        badge.textContent = count > 9 ? '9+' : count;
                        badge.classList.remove('hidden');
                        badge.style.display = 'flex';
                    } else {
                        badge.classList.add('hidden');
                    }
                }
            } catch(e) { console.warn('badge messages non lus (chef) :', e.message || e); }
        }


        // ── MISE À JOUR APPLICATION ──
        const APP_VERSION = '1.2.0';
        let _swUpdateAvailable = false;
        let _swWaiting = null;

        function initAppUpdate() {
            if (!('serviceWorker' in navigator)) return;

            navigator.serviceWorker.ready.then(reg => {
                // Vérifier si une mise à jour est en attente
                if (reg.waiting) {
                    _swWaiting = reg.waiting;
                    _swUpdateAvailable = true;
                    showUpdateBadge();
                }

                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            _swWaiting = newWorker;
                            _swUpdateAvailable = true;
                            showUpdateBadge();
                            showPushNotif('Mise à jour disponible', 'Appuyez sur Mettre à jour dans Profil', '🔄', 8000);
                        }
                    });
                });
            });

            // Recharger quand le nouveau SW prend le contrôle
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                window.location.reload();
            });

            // Vérifier la mise à jour toutes les 60 secondes
            setInterval(() => {
                navigator.serviceWorker.ready.then(reg => reg.update());
            }, 60000);
        }

        function showUpdateBadge() {
            const badge = document.getElementById('update-badge');
            if (badge) badge.classList.remove('hidden');
            const dot = document.getElementById('update-dot');
            if (dot) dot.classList.remove('hidden');
        }

        async function mettreAJourApp() {
            const btn = document.getElementById('btn-update');
            if (btn) {
                btn.innerHTML = '<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:white;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px"></span>Vérification...';
                btn.disabled = true;
            }

            try {
                const reg = await navigator.serviceWorker.ready;

                if (_swWaiting) {
                    // Mise à jour disponible — appliquer
                    _swWaiting.postMessage({ type: 'SKIP_WAITING' });
                    // controllerchange va déclencher le reload
                } else {
                    // Vérifier s'il y a une mise à jour
                    await reg.update();
                    await new Promise(r => setTimeout(r, 2000));

                    if (_swWaiting) {
                        _swWaiting.postMessage({ type: 'SKIP_WAITING' });
                    } else {
                        // Pas de mise à jour — vider le cache et recharger
                        const keys = await caches.keys();
                        await Promise.all(keys.map(k => caches.delete(k)));
                        showToast('App à jour ! Rechargement...', 'success');
                        setTimeout(() => window.location.reload(true), 1000);
                    }
                }
            } catch(e) {
                // Fallback simple
                showToast('Rechargement...', 'info');
                setTimeout(() => window.location.reload(true), 500);
            }
        }


        // ══════════════════════════════════
        //   SYSTÈME D'EXPORT UNIFIÉ
        // ══════════════════════════════════

        function ouvrirExports() {
            _closeNav();
            // Pré-remplir avec le mois/année du journal courant
            const mois = document.getElementById('journal-mois')?.value || String(new Date().getMonth()+1).padStart(2,'0');
            const annee = document.getElementById('journal-annee')?.value || String(new Date().getFullYear());
            const selMois = document.getElementById('export-mois-select');
            const selAnnee = document.getElementById('export-annee-select');
            if (selMois) selMois.value = mois;
            if (selAnnee) selAnnee.value = annee;
            document.getElementById('exports-modal').classList.remove('hidden');
            document.getElementById('export-progress').classList.add('hidden');
        }

        function fermerExports() {
            document.getElementById('exports-modal').classList.add('hidden');
        }

        function setExportProgress(text, pct) {
            const prog = document.getElementById('export-progress');
            const txt  = document.getElementById('export-progress-text');
            const bar  = document.getElementById('export-progress-bar');
            prog.classList.remove('hidden');
            if (txt) txt.textContent = text;
            if (bar) bar.style.width = pct + '%';
        }

        async function lancerExport(type) {
            const mois  = document.getElementById('export-mois-select').value;
            const annee = document.getElementById('export-annee-select').value;
            const moisNoms = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
            const moisNom = moisNoms[parseInt(mois)-1];

            // Désactiver les boutons pendant l'export
            document.querySelectorAll('.export-btn').forEach(b => b.style.opacity = '.5');
            setExportProgress('Chargement des données...', 10);

            try {
                if (type === 'excel-journal') await exportExcelJournal(mois, annee, moisNom);
                else if (type === 'excel-annuel') await exportExcelAnnuel(annee);
                else if (type === 'zip-membres') await exportZipParMembre(mois, annee, moisNom);
                else if (type === 'zip-mois') await exportZipParMois(mois, annee, moisNom);
            } catch(e) {
                showToast('Erreur export : ' + e.message, 'error');
            }

            document.querySelectorAll('.export-btn').forEach(b => b.style.opacity = '1');
            document.getElementById('export-progress').classList.add('hidden');
        }

        // ── EXPORT 1 : Excel Journal mensuel ──
        async function exportExcelJournal(mois, annee, moisNom) {
            setExportProgress('Chargement transactions...', 20);
            const { debut, fin } = bornesMois(annee, mois);
            const filtered = await fetchAll(() => sb.from('transactions')
                .select('*, profiles(prenom,nom)')
                .eq('maison_id', userProfile.maison_id)
                .gte('created_at', debut).lt('created_at', fin)
                .order('created_at', { ascending: true }));
            const justifSet = await idsAvecJustif(filtered.map(t => t.id));

            if (!filtered.length) { showToast('Aucune transaction ce mois', 'warning'); return; }
            setExportProgress('Génération Excel...', 60);

            const rows = filtered.map(t => ({
                'Date': new Date(t.created_at).toLocaleDateString('fr-FR'),
                'Membre': t.profiles ? `${t.profiles.prenom} ${t.profiles.nom||''}`.trim() : 'Membre supprimé',
                'Type': t.type === 'recette' ? 'Recette' : 'Dépense',
                'Motif': t.motif || '',
                'Commentaire': t.commentaire || '',
                'Montant (€)': parseFloat(t.montant).toFixed(2),
                'Paiement': t.methode_paiement || '',
                'Statut': t.statut === 'attente' ? 'En attente' : 'Validé',
                'Justificatif': t.type === 'recette' ? '' : (aJustif(t, justifSet) ? 'Oui' : 'Non')
            }));

            const ws = XLSX.utils.json_to_sheet(rows);
            ws['!cols'] = [{wch:12},{wch:22},{wch:10},{wch:20},{wch:30},{wch:12},{wch:18},{wch:12},{wch:12}];
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, `${moisNom} ${annee}`);
            setExportProgress('Téléchargement...', 90);
            XLSX.writeFile(wb, `Journal_${moisNom}_${annee}.xlsx`);
            showToast(`Journal ${moisNom} ${annee} téléchargé ✓`, 'success');
            fermerExports();
        }

        // ── EXPORT 2 : Excel Annuel complet ──
        async function exportExcelAnnuel(annee) {
            setExportProgress("Chargement de l\'année...", 10);

            // Charger transactions + allocations + profiles en parallèle
            const { debut, fin } = bornesAnnee(annee);
            const [allTx, allocAll, profs] = await Promise.all([
                fetchAll(() => sb.from('transactions')
                    .select('*, profiles(prenom,nom)')
                    .eq('maison_id', userProfile.maison_id)
                    .gte('created_at', debut).lt('created_at', fin)
                    .order('created_at', { ascending: true })),
                fetchAll(() => sb.from('allocations_versees')
                    .select('*')
                    .eq('maison_id', userProfile.maison_id)
                    .eq('annee', parseInt(annee))),
                fetchAll(() => sb.from('profiles')
                    .select('id,prenom,nom')
                    .eq('maison_id', userProfile.maison_id))
            ]);
            const allAlloc = allocAll.filter(allocConfirmee);
            const profilesMap = {};
            profs.forEach(p => { profilesMap[p.id] = p; });

            // Enrichir les allocations avec le profil
            allAlloc.forEach(a => {
                a._profile = profilesMap[a.user_id] || null;
            });

            if (!allTx.length && !allAlloc.length) {
                showToast('Aucune donnée cette année', 'warning');
                return;
            }

            setExportProgress('Construction du rapport...', 30);
            const wb = XLSX.utils.book_new();
            const moisNoms = ['Janvier','Février','Mars','Avril','Mai','Juin',
                              'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

            // ── Onglet Récapitulatif ──
            const recap = {};

            allTx.forEach(t => {
                const m = t.profiles
                    ? `${t.profiles.prenom} ${t.profiles.nom||''}`.trim()
                    : 'Membre supprimé';
                if (!recap[m]) recap[m] = { depenses:0, recettes:0, allocations:0, attente:0, nbTx:0, nbAlloc:0 };
                if (t.type === 'recette') recap[m].recettes += parseFloat(t.montant||0);
                else recap[m].depenses += parseFloat(t.montant||0);
                if (t.type === 'depense' && t.statut === 'attente') recap[m].attente += parseFloat(t.montant||0);
                recap[m].nbTx++;
            });

            allAlloc.forEach(a => {
                const p = a._profile;
                const m = p ? `${p.prenom} ${p.nom||''}`.trim() : 'Membre supprimé';
                if (!recap[m]) recap[m] = { depenses:0, recettes:0, allocations:0, attente:0, nbTx:0, nbAlloc:0 };
                recap[m].allocations += parseFloat(a.montant||0);
                recap[m].nbAlloc++;
            });

            const recapRows = Object.entries(recap).map(([membre, d]) => ({
                'Membre': membre,
                'Dépenses (€)': d.depenses.toFixed(2),
                'Recettes (€)': d.recettes.toFixed(2),
                'Allocations versées (€)': d.allocations.toFixed(2),
                'Avances à rembourser (€)': d.attente.toFixed(2),
                'Nb transactions': d.nbTx,
                'Nb versements': d.nbAlloc
            }));
            const wsRecap = XLSX.utils.json_to_sheet(recapRows);
            wsRecap['!cols'] = [{wch:22},{wch:14},{wch:14},{wch:22},{wch:18},{wch:16},{wch:16}];
            XLSX.utils.book_append_sheet(wb, wsRecap, 'Récapitulatif');

            // ── Onglet Allocations ──
            if (allAlloc.length) {
                const allocRows = allAlloc
                    .sort((a,b) => a.mois - b.mois)
                    .map(a => {
                        const p = a._profile;
                        return {
                            'Mois': moisNoms[(a.mois||1)-1],
                            'Membre': p ? `${p.prenom} ${p.nom||''}`.trim() : 'Membre supprimé',
                            'Montant (€)': parseFloat(a.montant||0).toFixed(2),
                            'Validé par': profilesMap[a.valide_par] ? `${profilesMap[a.valide_par].prenom} ${profilesMap[a.valide_par].nom||''}`.trim() : (a.valide_par ? 'Chef' : ''),
                            'Date': a.created_at ? new Date(a.created_at).toLocaleDateString('fr-FR') : ''
                        };
                    });
                const wsAlloc = XLSX.utils.json_to_sheet(allocRows);
                wsAlloc['!cols'] = [{wch:14},{wch:22},{wch:14},{wch:14},{wch:14}];
                XLSX.utils.book_append_sheet(wb, wsAlloc, 'Allocations');
            }

            // ── Un onglet par mois ──
            for (let m = 1; m <= 12; m++) {
                const txsMois = allTx.filter(t => new Date(t.created_at).getMonth()+1 === m);
                const allocMois = allAlloc.filter(a => parseInt(a.mois) === m);
                if (!txsMois.length && !allocMois.length) continue;

                setExportProgress(`Mois de ${moisNoms[m-1]}...`, 30 + m*4);
                const rows = [];

                txsMois.forEach(t => rows.push({
                    'Date': new Date(t.created_at).toLocaleDateString('fr-FR'),
                    'Membre': t.profiles ? `${t.profiles.prenom} ${t.profiles.nom||''}`.trim() : 'Membre supprimé',
                    'Nature': t.type === 'recette' ? 'Recette' : 'Dépense',
                    'Motif': t.motif || '',
                    'Commentaire': t.commentaire || '',
                    'Montant (€)': parseFloat(t.montant||0).toFixed(2),
                    'Paiement': t.methode_paiement || '',
                    'Statut': t.statut === 'attente' ? 'En attente' : 'Validé'
                }));

                allocMois.forEach(a => {
                    const p = a._profile;
                    rows.push({
                        'Date': a.created_at ? new Date(a.created_at).toLocaleDateString('fr-FR') : `${moisNoms[m-1]} ${annee}`,
                        'Membre': p ? `${p.prenom} ${p.nom||''}`.trim() : 'Membre supprimé',
                        'Nature': 'Allocation versée',
                        'Motif': 'Allocation mensuelle',
                        'Commentaire': '',
                        'Montant (€)': parseFloat(a.montant||0).toFixed(2),
                        'Paiement': 'Virement',
                        'Statut': 'Validé'
                    });
                });

                const ws = XLSX.utils.json_to_sheet(rows);
                ws['!cols'] = [{wch:12},{wch:22},{wch:16},{wch:20},{wch:25},{wch:12},{wch:14},{wch:12}];
                XLSX.utils.book_append_sheet(wb, ws, moisNoms[m-1]);
            }

            setExportProgress('Téléchargement...', 97);
            XLSX.writeFile(wb, `Rapport_Annuel_${annee}.xlsx`);
            showToast(`Rapport ${annee} téléchargé ✓`, 'success');
            fermerExports();
        }


        // ── EXPORT 3 : ZIP justificatifs classés par membre ──
        // ── Exports ZIP des justificatifs (logique partagée dans config.js) ──
        async function _zipJustifsChef(mois, annee, moisNom, parMembre) {
            setExportProgress('Chargement des dépenses...', 5);
            const all = await SMMD_EXPORT.fetchAll(() => sb.from('transactions')
                .select('id, user_id, created_at, motif, montant, commentaire, justificatif_url, profiles(prenom,nom)')
                .eq('maison_id', userProfile.maison_id)
                .eq('type', 'depense')
                .order('created_at', { ascending: true }));
            const txs = all.filter(t => {
                const d = new Date(t.created_at);
                return d.getMonth() + 1 === parseInt(mois) && d.getFullYear() === parseInt(annee);
            });
            if (!txs.length) { showToast('Aucune dépense ce mois', 'warning'); return; }
            const r = await SMMD_EXPORT.exporterJustificatifs({
                sb, txs, JSZip,
                dossier: parMembre
                    ? t => t.profiles ? SMMD_EXPORT.slug(t.profiles.prenom, 'Membre') + '_' + SMMD_EXPORT.slug((t.profiles.nom || '').toUpperCase(), '') : 'Membres_supprimes'
                    : () => '',
                nomZip: `Justificatifs_${moisNom}_${annee}${parMembre ? '_par_membre' : ''}.zip`,
                onProgress: setExportProgress
            });
            const msg = `${r.nbFichiers} fichier(s) exporté(s)` + (r.nbSans ? ` · ${r.nbSans} dépense(s) sans justificatif` : '') + (r.problemes ? ` · ${r.problemes} problème(s) (voir LISEZMOI.txt)` : '');
            showToast(msg, r.problemes ? 'warning' : 'success');
            fermerExports();
        }
        async function exportZipParMembre(mois, annee, moisNom) { return _zipJustifsChef(mois, annee, moisNom, true); }
        async function exportZipParMois(mois, annee, moisNom)   { return _zipJustifsChef(mois, annee, moisNom, false); }


        function ouvrirAjoutJustificatif(txId) {
            justifPhotos = [];
            document.getElementById('justif-tx-id').value = txId;
            document.getElementById('justif-upload-progress').classList.add('hidden');
            document.getElementById('justif-preview-grid').innerHTML = '';
            document.getElementById('justif-previews').classList.add('hidden');
            document.getElementById('justif-valider-btn').classList.add('hidden');
            document.getElementById('justif-upload-modal').classList.remove('hidden');
        }
        function fermerJustifModal() {
            document.getElementById('justif-upload-modal').classList.add('hidden');
        }

        // Photos en attente pour le justificatif
        // let justifPhotos = []; // dédupliqué

        function logout(){sb.auth.signOut().then(()=>location.href='index.html');}

        // ── SPLASH SCREEN ──
        function hideSplash() {
            const splash = document.getElementById('splash');
            if (splash) {
                splash.classList.add('hide');
                setTimeout(() => splash.remove(), 500);
            }
        }
        // Sécurité : forcer la disparition du splash après 5s max
        setTimeout(hideSplash, 5000);

        // ── ANIMATION ✓ APRÈS SAISIE ──
        function vibrate(pattern=[10]) {
            if (navigator.vibrate) navigator.vibrate(pattern);
        }

        function showSuccess(label = 'Enregistré !') {
            vibrate([15, 50, 15]);
            const overlay = document.getElementById('success-overlay');
            const lbl = document.getElementById('success-label');
            if (!overlay) return;
            if (lbl) lbl.textContent = label;
            overlay.classList.add('show');
            setTimeout(() => overlay.classList.remove('show'), 1800);
        }

        // ── PULL TO REFRESH ──
        let _ptrStartY = 0, _ptrActive = false, _ptrThreshold = 80;

        function initPullToRefresh(refreshFn) {
            const indicator = document.getElementById('ptr-indicator');
            const spinner = document.getElementById('ptr-spinner');

            document.addEventListener('touchstart', e => {
                if (window.scrollY === 0) _ptrStartY = e.touches[0].clientY;
            }, { passive: true });

            document.addEventListener('touchmove', e => {
                if (!_ptrStartY) return;
                const diff = e.touches[0].clientY - _ptrStartY;
                if (diff > 30 && window.scrollY === 0) {
                    indicator.classList.add('visible');
                    _ptrActive = diff > _ptrThreshold;
                    spinner.style.transform = `rotate(${diff * 3}deg)`;
                }
            }, { passive: true });

            document.addEventListener('touchend', async () => {
                if (_ptrActive) {
                    spinner.classList.add('spin');
                    indicator.querySelector('span') && (indicator.querySelector('span').textContent = 'Actualisation...');
                    await refreshFn();
                    spinner.classList.remove('spin');
                }
                indicator.classList.remove('visible');
                _ptrStartY = 0; _ptrActive = false;
            });
        }

        // ── SWIPE TO DELETE ──
        function initSwipeDelete(el, onDelete) {
            let startX = 0, currentX = 0, swiping = false;
            const inner = el.querySelector('.swipe-item-inner');
            if (!inner) return;

            el.addEventListener('touchstart', e => {
                startX = e.touches[0].clientX;
                swiping = true;
            }, { passive: true });

            el.addEventListener('touchmove', e => {
                if (!swiping) return;
                currentX = e.touches[0].clientX - startX;
                if (currentX < 0) {
                    inner.style.transform = `translateX(${Math.max(currentX, -80)}px)`;
                }
            }, { passive: true });

            el.addEventListener('touchend', () => {
                if (currentX < -50) {
                    inner.style.transform = 'translateX(-80px)';
                    // Confirmer suppression après 1s ou au tap
                    setTimeout(() => { onDelete(); inner.style.transform = ''; }, 100);
                } else {
                    inner.style.transform = '';
                }
                swiping = false; currentX = 0;
            });
        }

        // ── TRANSITIONS ONGLETS ── (ordre pour direction)
        const TAB_ORDER = ['saisie','journal','remboursements','versements','resume','profil'];

        async function safeInit() {
            try { await checkAuth(); } catch(e) { console.error('Init error:', e); }
            finally { hideSplash(); }
        }
        safeInit();
    
