        const sb = supabase.createClient(SMMD_CONFIG.url, SMMD_CONFIG.key);
        window.addEventListener('offline', ()=>document.getElementById('offline-banner').classList.remove('hidden'));
        window.addEventListener('online',  ()=>document.getElementById('offline-banner').classList.add('hidden'));
        let userProfile = null;
        let currentType = 'depense';
        const MOIS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];


        // ── Compact nav au scroll ──
        new IntersectionObserver(([e]) => {
            const compact = !e.isIntersecting;
            const navExp = document.getElementById('nav-expanded');
            const navCmp = document.getElementById('nav-compact');
            const nav    = document.getElementById('main-nav');
            navExp.style.maxHeight = compact ? '0'    : '500px';
            navExp.style.opacity   = compact ? '0'    : '1';
            navCmp.classList.toggle('hidden', !compact);
            nav.style.paddingTop    = compact ? '14px' : '24px';
            nav.style.paddingBottom = compact ? '14px' : '20px';
            nav.style.borderRadius  = compact ? '0 0 20px 20px' : '0 0 40px 40px';
        }, { threshold: 0 }).observe(document.getElementById('scroll-sentinel'));

        // ── Compteur animé ──
        function animCounter(el, target, suffix='€', duration=550) {
            const neg = target < 0, abs = Math.abs(target), start = performance.now();
            const tick = now => {
                const p = Math.min((now-start)/duration, 1);
                const ease = 1-Math.pow(1-p, 3);
                el.textContent = (neg?'-':'') + (abs*ease).toFixed(2) + suffix;
                if (p < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        }

        // ── Navigation onglets ──

        // ── SCAN JUSTIFICATIF ──
        function openScanModal() {
            resetScanModal();
            document.getElementById('scan-modal').classList.remove('hidden');
        }
        function closeScanModal() {
            document.getElementById('scan-modal').classList.add('hidden');
            // Réinitialiser tous les champs du scan pour le prochain usage
            const ids = ['scan-montant','scan-date','scan-commentaire'];
            ids.forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
            const preview = document.getElementById('scan-preview');
            if (preview) preview.src = '';
            const confiance = document.getElementById('scan-confiance');
            if (confiance) { confiance.textContent=''; confiance.className=''; }
            scannedFile = null;
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
                document.getElementById('scan-error-msg').textContent = err.message || "Impossible de contacter le service d'analyse. Réessayez.";
            }
        }

        async function validerDepenseScan() {
            const amount  = parseFloat(document.getElementById('scan-montant').value);
            const date    = document.getElementById('scan-date').value;
            const comment = document.getElementById('scan-commentaire').value.trim();
            const motif   = document.getElementById('scan-motif').value;
            const method  = document.getElementById('scan-method').value;
            if (!amount||amount<=0) return showToast('Saisissez un montant valide','error');
            if (!date) return showToast('Saisissez une date','error');

            const btn = document.querySelector('#scan-step-result .btn-enregistrer');
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

            if (error) { setBtn('Enregistrer', false); showToast('Erreur : '+error.message,'error'); return; }
            memoriserDerniereSaisie(insertData?.[0]?.id);

            // Les photos sont stockées dans justificatifs_images (base64)
            let justifOk = false;
            const allPhotos = [scannedFile, ...extraPhotos].filter(Boolean);
            if (insertData?.[0]?.id && allPhotos.length) {
                setBtn('<span class="btn-spinner"></span>Justificatif...', true);
                try {
                    await sauvegarderImagesJustificatif(insertData[0].id, allPhotos);
                    justifOk = true;
                } catch(e) {
                    showToast(e.message + ' — ajoutez-le depuis le journal', 'error');
                }
            }
            setBtn('Enregistrer', false);

            scannedFile = null;
            extraPhotos = [];
            closeScanModal();
            if (justifOk) showToast('Dépense enregistrée avec justificatif !','success');
            else if (!allPhotos.length) showToast('Dépense enregistrée (sans justificatif)','warning');
            await loadJournal();
            await refreshDashboard();
            await loadRefundHistory();
        }


        // ── JOURNAL ──
        function initJournalFiltres() {
            const now = new Date();
            document.getElementById('journal-mois').value = String(now.getMonth()+1).padStart(2,'0');
            const ySel = document.getElementById('journal-annee');
            ySel.innerHTML = '';
            for (let y = now.getFullYear(); y >= 2026; y--) {
                ySel.innerHTML += `<option value="${y}">${y}</option>`;
            }
        }

        let _txCache = {};

        async function loadJournal() {
            const mois  = document.getElementById('journal-mois').value;
            const annee = document.getElementById('journal-annee').value;
            const list  = document.getElementById('journal-list');
            renderJournalSkeleton(list);

            const { debut, fin } = bornesMois(annee, mois);
            let data, justifSet;
            try {
                data = await fetchAll(() => sb.from('transactions')
                    .select('id,user_id,maison_id,type,montant,statut,motif,commentaire,created_at,methode_paiement,justificatif_url')
                    .eq('user_id', userProfile.id)
                    .gte('created_at', debut).lt('created_at', fin)
                    .order('created_at', { ascending: false }));
                justifSet = await idsAvecJustif(data.map(t => t.id));
            } catch (e) {
                list.innerHTML=`<p class="text-center text-red-400 text-[11px] font-bold py-8">Erreur de chargement</p>`; return;
            }

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
                        ${totalDep>0?`<p class="text-[9px] font-black text-slate-600">-${totalDep.toFixed(2)}€ dép</p>`:''}
                        ${totalRec>0?`<p class="text-[9px] font-black text-emerald-600">+${totalRec.toFixed(2)}€ rec</p>`:''}
                    </div>
                </div>
                ${filtered.map((t,i) => `
                <div class="swipe-item rounded-[20px] anim-slide" style="animation-delay:${i*.03}s" data-swipe-id="${escapeHtml(t.id)}">
                    <div class="swipe-delete-btn rounded-[20px]">🗑️</div>
                    <div class="swipe-item-inner bg-white rounded-[20px] border border-slate-100 p-4">
                    <div class="flex justify-between items-start">
                        <div class="flex items-start gap-3 flex-1 min-w-0">
                            ${motifIconHTML(t.motif, t.type)}
                            <div class="min-w-0 flex-1">
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
                                       <button onclick="ouvrirAjoutJustificatif('${escapeHtml(t.id)}')" class="text-[8px] font-black text-slate-500 uppercase bg-slate-50 px-2 py-1 rounded-full border border-slate-200 hover:bg-slate-100 transition-colors">🔄 Remplacer</button>`
                                    : `<button onclick="ouvrirAjoutJustificatif('${escapeHtml(t.id)}')" class="text-[8px] font-black text-amber-600 uppercase bg-amber-50 px-2 py-1 rounded-full border border-amber-200 hover:bg-amber-100 transition-colors">📎 Ajouter justif</button>`)
                                : ''}
                                <button onclick="ouvrirEditById('${escapeHtml(t.id)}')" class="text-[8px] font-black text-slate-600 uppercase bg-slate-50 px-2 py-1 rounded-full border border-slate-200 hover:bg-slate-100 transition-colors">✏️ Modifier</button>
                                <button onclick="supprimerOperation('${escapeHtml(t.id)}')" class="text-[8px] font-black text-red-500 uppercase bg-red-50 px-2 py-1 rounded-full border border-red-100 hover:bg-red-100 transition-colors">🗑️ Supprimer</button>
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
                const { error } = await sb.from('transactions').delete().eq('id', id).eq('user_id', userProfile.id);
                if (error) { showToast('Erreur : '+error.message, 'error'); return; }
                delete _txCache[id];
                showToast('Opération supprimée', 'info');
                await loadJournal();
                await refreshDashboard();
                await loadRefundHistory();
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
            document.getElementById('edit-montant').value = parseFloat(tx.montant);
            document.getElementById('edit-date').value    = isoVersDateSaisie(tx.created_at);
            document.getElementById('edit-commentaire').value = tx.commentaire||'';
            document.getElementById('edit-methode').value = tx.methode_paiement||'cb_maison';
            const isR = tx.type === 'recette';
            document.getElementById('edit-container-motif').classList.toggle('hidden', isR);
            document.getElementById('edit-container-paiement').classList.toggle('hidden', isR);
            // Pré-sélectionner le motif
            const sel = document.getElementById('edit-motif');
            if (sel && tx.motif) {
                Array.from(sel.options).forEach(o => { o.selected = o.value === tx.motif; });
            }
            document.getElementById('edit-modal').classList.remove('hidden');
        }

        function fermerEditModal() {
            document.getElementById('edit-modal').classList.add('hidden');
        }

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

            const saveBtn = document.getElementById('edit-save-btn');
            if(saveBtn){saveBtn.innerHTML='<span class="btn-spinner"></span>Enregistrement...';saveBtn.disabled=true;}

            const update = {
                montant,
                created_at: dateSaisieVersISO(date),
                commentaire: comment||null,
                methode_paiement: type==='recette' ? null : methode,
                statut: statutApresEdition(_txCache[id], type, methode)
            };
            if (type !== 'recette') update.motif = motif;

            const { error } = await sb.from('transactions').update(update).eq('id', id).eq('user_id', userProfile.id);
            if(saveBtn){saveBtn.textContent='Enregistrer';saveBtn.disabled=false;}
            if (error) { showToast('Erreur : '+error.message,'error'); return; }
            fermerEditModal();
            showToast('Opération modifiée !','success');
            await loadJournal();
            await refreshDashboard();
            await loadRefundHistory();
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
            let txs, avsAll;
            try {
                [txs, avsAll] = await Promise.all([
                    fetchAll(() => sb.from('transactions').select('*').eq('user_id', userProfile.id).gte('created_at', debut).lt('created_at', fin)),
                    fetchAll(() => sb.from('allocations_versees').select('*').eq('user_id', userProfile.id).eq('annee', annee))
                ]);
            } catch (e) { container.innerHTML = `<p class="text-center text-red-400 text-[11px] font-bold py-8">Erreur de chargement</p>`; return; }
            const avs = avsAll.filter(allocConfirmee);

            const totalAlloc  = avs.reduce((s,a) => s+parseFloat(a.montant), 0);
            const totalDep    = txs.filter(t=>t.type==='depense').reduce((s,t) => s+parseFloat(t.montant), 0);
            const totalRec    = txs.filter(t=>t.type==='recette').reduce((s,t) => s+parseFloat(t.montant), 0);
            const totalRemb   = txs.filter(t=>t.type==='depense'&&t.statut==='valide'&&t.methode_paiement?.startsWith('perso_')).reduce((s,t) => s+parseFloat(t.montant), 0);
            const totalAttente= txs.filter(t=>t.type==='depense'&&t.statut==='attente').reduce((s,t) => s+parseFloat(t.montant), 0);
            const solde       = totalAlloc + totalRec - totalDep;

            // Par mois
            const byMonth = {};
            for (let m = 1; m <= 12; m++) {
                const mTxs = txs.filter(t => new Date(t.created_at).getMonth()+1 === m);
                const mAvs = avs.filter(a => parseInt(a.mois) === m);
                byMonth[m] = {
                    alloc: mAvs.reduce((s,a)=>s+parseFloat(a.montant),0),
                    dep:   mTxs.filter(t=>t.type==='depense').reduce((s,t)=>s+parseFloat(t.montant),0),
                    rec:   mTxs.filter(t=>t.type==='recette').reduce((s,t)=>s+parseFloat(t.montant),0),
                };
            }

            // Motifs les plus fréquents
            const motifMap = {};
            txs.filter(t=>t.type==='depense').forEach(t => {
                motifMap[t.motif||'Autre'] = (motifMap[t.motif||'Autre']||0) + parseFloat(t.montant);
            });
            const topMotifs = Object.entries(motifMap).sort((a,b)=>b[1]-a[1]).slice(0,5);

            container.innerHTML = `
                <!-- KPIs -->
                <div class="grid grid-cols-2 gap-3 anim-slide">
                    <div class="bg-white rounded-[24px] border border-slate-100 shadow-premium p-5">
                        <p class="text-[8px] font-black uppercase text-slate-400 tracking-widest mb-1">Allocations versées</p>
                        <p class="text-2xl font-black text-emerald-600">${totalAlloc.toFixed(2)}€</p>
                        <p class="text-[9px] text-slate-400 font-bold mt-1">${avs.length} mois sur 12</p>
                    </div>
                    <div class="bg-white rounded-[24px] border border-slate-100 shadow-premium p-5">
                        <p class="text-[8px] font-black uppercase text-slate-400 tracking-widest mb-1">Dépenses totales</p>
                        <p class="text-2xl font-black text-slate-800">${totalDep.toFixed(2)}€</p>
                        <p class="text-[9px] text-slate-400 font-bold mt-1">${txs.filter(t=>t.type==='depense').length} opérations</p>
                    </div>
                    <div class="bg-white rounded-[24px] border border-slate-100 shadow-premium p-5">
                        <p class="text-[8px] font-black uppercase text-slate-400 tracking-widest mb-1">Remboursements reçus</p>
                        <p class="text-2xl font-black text-red-700">${totalRemb.toFixed(2)}€</p>
                        ${totalAttente>0?`<p class="text-[9px] text-amber-500 font-bold mt-1">${totalAttente.toFixed(2)}€ en attente</p>`:'<p class="text-[9px] text-emerald-500 font-bold mt-1">Tout remboursé ✓</p>'}
                    </div>
                    <div class="bg-white rounded-[24px] border border-slate-100 shadow-premium p-5 ${solde<0?'border-red-100':'border-emerald-100'}">
                        <p class="text-[8px] font-black uppercase text-slate-400 tracking-widest mb-1">Solde annuel</p>
                        <p class="text-2xl font-black ${solde<0?'text-red-500':'text-emerald-600'}">${solde<0?'':'+'}${solde.toFixed(2)}€</p>
                    </div>
                </div>

                <!-- Répartition par mois -->
                <div class="bg-white rounded-[28px] border border-slate-100 shadow-premium overflow-hidden anim-slide" style="animation-delay:.05s">
                    <div class="px-5 py-4 border-b border-slate-50">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-700">Mois par mois</p>
                    </div>
                    <div class="divide-y divide-slate-50">
                        ${Object.entries(byMonth).filter(([m,d])=>d.alloc>0||d.dep>0||d.rec>0).map(([m,d])=>`
                        <div class="px-5 py-3 flex justify-between items-center">
                            <p class="text-[10px] font-black uppercase text-slate-600 w-20">${MOIS_FR[parseInt(m)-1]}</p>
                            <div class="flex gap-4 text-right">
                                ${d.alloc>0?`<div><p class="text-[8px] text-slate-400 font-bold">Alloc</p><p class="text-[10px] font-black text-emerald-600">+${d.alloc.toFixed(0)}€</p></div>`:''}
                                ${d.dep>0?`<div><p class="text-[8px] text-slate-400 font-bold">Dép</p><p class="text-[10px] font-black text-slate-700">-${d.dep.toFixed(0)}€</p></div>`:''}
                                ${d.rec>0?`<div><p class="text-[8px] text-slate-400 font-bold">Rec</p><p class="text-[10px] font-black text-red-700">+${d.rec.toFixed(0)}€</p></div>`:''}
                            </div>
                        </div>`).join('')}
                    </div>
                </div>

                <!-- Top motifs -->
                ${topMotifs.length>0?`
                <div class="bg-white rounded-[28px] border border-slate-100 shadow-premium overflow-hidden anim-slide" style="animation-delay:.1s">
                    <div class="px-5 py-4 border-b border-slate-50">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-700">Top dépenses</p>
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

        // let extraPhotos = []; // dédupliqué

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

        function setLoading(btnId, loading, steps) {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            if (loading) {
                btn.disabled = true;
                btn.dataset.originalText = btn.textContent;
                btn.innerHTML = `<span class="btn-spinner"></span>${steps||'Chargement...'}`;
            } else {
                btn.disabled = false;
                btn.textContent = btn.dataset.originalText || 'Enregistrer';
            }
        }

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
                const isPdf = f.type?.includes('pdf');
                const url = isPdf ? '' : URL.createObjectURL(f);
                return `<div class="relative">
                    ${isPdf
                        ? `<div class="w-full h-20 rounded-xl border border-slate-100 bg-red-50 flex items-center justify-center text-2xl">📄</div>`
                        : `<img src="${url}" class="w-full h-20 object-cover rounded-xl border border-slate-100">`}
                    <button onclick="supprimerPhotoJustif(${i})" class="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] font-black flex items-center justify-center shadow-md" aria-label="Supprimer">✕</button>
                </div>`;
            }).join('');
        }


        function afficherPreviewsJustif() {
            const grid    = document.getElementById('justif-preview-grid');
            const section = document.getElementById('justif-previews');
            const count   = document.getElementById('justif-preview-count');
            const valBtn  = document.getElementById('justif-valider-btn');

            if (!justifPhotos.length) {
                section.classList.add('hidden');
                valBtn.classList.add('hidden');
                return;
            }

            section.classList.remove('hidden');
            valBtn.classList.remove('hidden');
            count.textContent = `${justifPhotos.length} photo${justifPhotos.length>1?'s':''}` ;

            grid.innerHTML = justifPhotos.map((f, i) => {
                const isPdf = f.type === 'application/pdf';
                const url = isPdf ? null : URL.createObjectURL(f);
                return `<div class="relative">
                    ${isPdf
                        ? `<div class="w-full h-20 bg-red-50 border border-red-100 rounded-xl flex flex-col items-center justify-center gap-1">
                            <span class="text-2xl">📄</span>
                            <span class="text-[8px] font-black text-red-400 uppercase">PDF</span>
                           </div>`
                        : `<img src="${url}" class="w-full h-20 object-cover rounded-xl border border-slate-100">`}
                    <button onclick="supprimerPhotoJustif(${i})"
                        class="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] font-black flex items-center justify-center shadow-md" aria-label="Supprimer">✕</button>
                </div>`;
            }).join('');
        }

        function supprimerPhotoJustif(idx) {
            justifPhotos.splice(idx, 1);
            afficherPreviewsJustif();
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
                showToast('Justificatif enregistré ✓', 'success');
                await loadJournal();
                await refreshDashboard();
                await loadRefundHistory();
            } catch(e) {
                prog.classList.add('hidden');
                valBtn.classList.remove('hidden');
                showToast('Erreur : ' + e.message, 'error');
            }
        }


        async function init() {
            const { data: { user } } = await sb.auth.getUser();
            if (!user) { window.location.href="index.html"; return; }
            const { data: profile } = await sb.from('profiles').select('*, maisons(nom)').eq('id', user.id).single();
            if (!profile) { window.location.href="index.html"; return; }
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
            await refreshDashboard();
            await loadRefundHistory();
            await loadVersementsHistory();
            await checkNotifications();
            await checkAllocVersee();
            checkUnreadMessages();
            initAppUpdate();
            initPullToRefresh(async () => { await refreshDashboard(); await loadRefundHistory(); await loadVersementsHistory(); });
        }

        async function checkNotifications() {
            // Charger les notifs non lues existantes
            const { data } = await sb.from('notifications').select('*')
                .eq('user_id', userProfile.id).eq('lu', false)
                .order('created_at', { ascending: false });
            if (data && data.length) {
                data.forEach(n => afficherNotif(n));
            }

            // Écoute Realtime : nouvelles notifs en temps réel
            sb.channel('notifs-user-' + userProfile.id)
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${userProfile.id}`
                }, payload => {
                    afficherNotif(payload.new);
                    // Push notification
                    showPushNotif('Remboursement', payload.new.message || 'Nouveau virement reçu', '💸');
                })
                .subscribe();
        }

        function afficherNotif(n) {
            const container = document.getElementById('notif-container');
            // Éviter les doublons
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
            await sb.from('notifications').update({lu:true}).eq('id',id).eq('user_id',userProfile.id);
            const el = document.querySelector(`[data-notif="${id}"]`);
            if (el) { el.style.cssText='opacity:0;transform:translateY(-8px);transition:all .2s'; setTimeout(()=>el.remove(),200); }
        }

        async function refreshDashboard() {
            // Timeout réseau : si pas de réponse en 8s, afficher erreur
            const timeout = setTimeout(() => {
                if (document.getElementById('house-balance').textContent.includes('nbsp') ||
                    document.getElementById('house-balance').querySelector('.skeleton')) {
                    document.getElementById('house-balance').textContent = '--€';
                    document.getElementById('balance').textContent = '--€';
                    document.getElementById('pending-refund').textContent = '--€';
                    showToast("Impossible de charger les données — vérifiez votre connexion", "error");
                }
            }, 15000);
            let txs, avsAll;
            try {
                [txs, avsAll] = await Promise.all([
                    fetchAll(() => sb.from('transactions').select('id,user_id,maison_id,type,montant,statut,motif,commentaire,created_at,methode_paiement,justificatif_url').eq('maison_id',userProfile.maison_id)),
                    fetchAll(() => sb.from('allocations_versees').select('user_id,montant,statut').eq('maison_id',userProfile.maison_id))
                ]);
            } catch (e) { clearTimeout(timeout); showToast("Erreur de chargement des données","error"); return; }
            clearTimeout(timeout);
            const avs = avsAll.filter(allocConfirmee);

            const houseAlloc = (avs||[]).reduce((s,a)=>s+parseFloat(a.montant),0);
            const houseDep   = (txs||[]).filter(t=>t.type==='depense').reduce((s,t)=>s+parseFloat(t.montant),0);
            const houseRec   = (txs||[]).filter(t=>t.type==='recette').reduce((s,t)=>s+parseFloat(t.montant),0);
            const myAvs      = (avs||[]).filter(a=>a.user_id===userProfile.id).reduce((s,a)=>s+parseFloat(a.montant),0);
            const myTx       = (txs||[]).filter(t=>t.user_id===userProfile.id);
            const myDep      = myTx.filter(t=>t.type==='depense').reduce((s,t)=>s+parseFloat(t.montant),0);
            const myRec      = myTx.filter(t=>t.type==='recette').reduce((s,t)=>s+parseFloat(t.montant),0);
            const pending    = myTx.filter(t=>t.type==='depense'&&t.statut==='attente').reduce((s,t)=>s+parseFloat(t.montant),0);
            const myAlloc    = parseFloat(userProfile.allocation_mensuelle)||0;

            animCounter(document.getElementById('house-balance'), houseAlloc+houseRec-houseDep);
            animCounter(document.getElementById('balance'), myAvs+myRec-myDep);
            animCounter(document.getElementById('pending-refund'), pending);
            const myBal = myAvs+myRec-myDep;
            const compEl = document.getElementById('compact-balance');
            compEl.textContent = myBal.toFixed(2)+'€';
            compEl.style.color = myBal < 0 ? '#ef4444' : '';
            document.getElementById('alloc-badge').textContent = myAlloc>0 ? `${myAlloc.toFixed(2)}€/mois` : 'Allocation non définie';

            const hist = [...myTx].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,8);
            if (hist.length > 0) {
                const justifSet = await idsAvecJustif(hist.map(t => t.id)).catch(() => new Set());
                hist.forEach(t => { t._hasJustif = justifSet.has(t.id); _txCache[t.id] = t; });
            }
            document.getElementById('tx-history').innerHTML = hist.length===0
                ? `<div class="text-center py-10"><svg class="w-10 h-10 mx-auto mb-2 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg><p class="text-slate-300 text-[11px] font-black uppercase tracking-widest">Aucune opération</p></div>`
                : hist.map((t,i)=>`
                <div class="bg-white rounded-[20px] border border-slate-100 anim-slide shadow-premium" style="animation-delay:${i*.04}s">
                    <div class="flex justify-between items-center p-4">
                        <div class="flex items-center gap-3 flex-1 min-w-0">
                            ${motifIconHTML(t.motif, t.type)}
                            <div class="min-w-0">
                                <p class="text-[11px] font-black uppercase tracking-wide text-slate-800 truncate">${escapeHtml(t.motif||'RECETTE')}</p>
                                <p class="text-[9px] text-slate-400 font-bold">${new Date(t.created_at).toLocaleDateString('fr-FR')}${t.commentaire?' · '+escapeHtml(t.commentaire):''}</p>
                            </div>
                        </div>
                        <div class="text-right flex-shrink-0 ml-2">
                            <p class="font-black text-sm ${t.type==='recette'?'text-emerald-500':'text-slate-900'}">${t.type==='recette'?'+':'-'}${parseFloat(t.montant).toFixed(2)}€</p>
                            <span class="text-[8px] uppercase font-black px-2 py-0.5 rounded-full ${t.statut==='attente'?'bg-amber-50 text-amber-500':'bg-emerald-50 text-emerald-600'}">${t.statut==='attente'?'En attente':'Validé'}</span>
                        </div>
                    </div>
                    <div class="flex gap-2 px-4 pb-3 border-t border-slate-50 pt-2">
                        <button onclick="ouvrirEditById('${escapeHtml(t.id)}')"
                            style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:8px;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#475569;cursor:pointer">
                            ✏️ Modifier
                        </button>
                        ${t.justificatif_url || t._hasJustif
                            ? `<button onclick="previewJustificatif('${escapeHtml(t.id)}','${escapeHtml(t.justificatif_url||'')}')"
                                style="flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:8px;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#16a34a;cursor:pointer">
                                📎 Voir justif
                               </button>`
                            : `<button onclick="ouvrirAjoutJustificatif('${escapeHtml(t.id)}')"
                                style="flex:1;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:8px;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#d97706;cursor:pointer">
                                📎 Ajouter justif
                               </button>`
                        }
                        <button onclick="supprimerOperation('${escapeHtml(t.id)}')"
                            style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:8px 10px;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#ef4444;cursor:pointer;flex-shrink:0" aria-label="Supprimer">
                            🗑️
                        </button>
                    </div>
                </div>`).join('');
        }

        async function loadRefundHistory() {
            let notifs, txs, justifSet;
            try {
                [notifs, txs] = await Promise.all([
                    fetchAll(() => sb.from('notifications').select('id,created_at,type').eq('user_id',userProfile.id).order('created_at',{ascending:false})),
                    fetchAll(() => sb.from('transactions').select('*').eq('user_id',userProfile.id).eq('type','depense').like('methode_paiement','perso_%').order('created_at',{ascending:false}))
                ]);
                justifSet = await idsAvecJustif(txs.filter(t => t.statut === 'attente').map(t => t.id));
            } catch (e) {
                document.getElementById('refund-history').innerHTML=`<p class="text-center text-red-300 text-[11px] font-bold uppercase py-8">Erreur de chargement</p>`;
                return;
            }
            if (!txs.length) {
                document.getElementById('refund-history').innerHTML=`
                    <div class="bg-white rounded-[28px] border border-slate-100 shadow-premium p-8 text-center">
                        <svg class="w-10 h-10 mx-auto mb-3 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>
                        <p class="text-slate-700 text-[12px] font-black uppercase tracking-widest mb-2">Aucune avance</p>
                        <p class="text-slate-400 text-[11px] font-bold leading-relaxed">Les remboursements apparaissent ici quand vous payez une dépense commune avec votre carte personnelle ou en espèces (moyen "À rembourser").</p>
                    </div>`;
                return;
            }
            const virements = notifs.filter(n => !n.type || n.type === 'remboursement');
            const byMonth={};
            txs.forEach(t=>{
                _txCache[t.id] = t;
                const d=new Date(t.created_at), key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
                if(!byMonth[key]) byMonth[key]={label:`${MOIS_FR[d.getMonth()]} ${d.getFullYear()}`,attente:[],valide:[]};
                if(t.statut==='attente') byMonth[key].attente.push(t); else byMonth[key].valide.push(t);
            });
            document.getElementById('refund-history').innerHTML = Object.entries(byMonth).sort((a,b)=>b[0].localeCompare(a[0])).map(([key,month],i)=>{
                const tA=month.attente.reduce((s,t)=>s+parseFloat(t.montant),0);
                const tV=month.valide.reduce((s,t)=>s+parseFloat(t.montant),0);
                // Date du virement : date de validation des avances du mois (sinon notification du mois)
                const dv = month.valide.map(t=>t.date_validation).filter(Boolean).sort().pop();
                const nM = dv ? null : virements.find(n=>{const nd=new Date(n.created_at);return`${nd.getFullYear()}-${String(nd.getMonth()+1).padStart(2,'0')}`===key;});
                const dateVir = dv || nM?.created_at;
                return`<div class="bg-white rounded-[24px] border border-slate-100 shadow-premium overflow-hidden anim-slide" style="animation-delay:${i*.05}s">
                    <div class="px-5 py-4 flex justify-between items-center border-b border-slate-50">
                        <div>
                            <p class="font-black text-[12px] uppercase tracking-widest text-slate-800">${escapeHtml(month.label)}</p>
                            ${tV>0&&dateVir?`<p class="text-[9px] text-emerald-600 font-bold mt-0.5">✓ Virement reçu · ${new Date(dateVir).toLocaleDateString('fr-FR')}</p>`:''}
                        </div>
                        <div class="text-right">
                            ${tA>0?`<p class="text-[10px] font-black text-amber-500">${tA.toFixed(2)}€ en attente</p>`:''}
                            ${tV>0?`<p class="text-[10px] font-black text-emerald-500">${tV.toFixed(2)}€ remboursé</p>`:''}
                        </div>
                    </div>
                    <div class="divide-y divide-slate-50">
                        ${[...month.attente,...month.valide].map(t=>{
                            const justif = aJustif(t, justifSet);
                            const needsJustif = t.statut==='attente' && !justif;
                            return `
                        <div class="px-5 py-3 flex justify-between items-start">
                            <div class="flex items-start gap-3 flex-1 min-w-0">
                                <span class="w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${t.statut==='attente'?'bg-amber-400':'bg-emerald-400'}"></span>
                                <div class="min-w-0 flex-1">
                                    <p class="text-[10px] font-bold text-slate-700">${escapeHtml(t.motif||'-')}</p>
                                    <p class="text-[8px] text-slate-400">${new Date(t.created_at).toLocaleDateString('fr-FR')}${t.commentaire?' · '+escapeHtml(t.commentaire):''}</p>
                                    ${needsJustif
                                        ? `<button onclick="ouvrirAjoutJustificatif('${escapeHtml(t.id)}')"
                                            class="mt-1 text-[8px] font-black text-amber-500 uppercase bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 hover:bg-amber-100 transition-colors">
                                            ⚠️ Justificatif requis
                                          </button>`
                                        : (t.statut==='attente'
                                            ? `<button onclick="previewJustificatif('${escapeHtml(t.id)}','${escapeHtml(t.justificatif_url||'')}')"
                                                class="mt-1 inline-block text-[8px] font-black text-emerald-500 uppercase bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                                                ✓ Justificatif joint
                                              </button>`
                                            : '')}
                                </div>
                            </div>
                            <p class="font-black text-[12px] text-slate-800 flex-shrink-0 ml-2">${parseFloat(t.montant).toFixed(2)}€</p>
                        </div>`;
                        }).join('')}
                    </div>
                </div>`;
            }).join('');
        }

        async function submitTx() {
            const amount=parseFloat(document.getElementById('tx-amount').value);
            const date=document.getElementById('tx-date').value;
            const comment=document.getElementById('tx-comment').value.trim();
            const motif=document.getElementById('tx-motif').value;
            const method=document.getElementById('tx-method').value;
            if(!amount||amount<=0) return showToast("Saisissez un montant valide","error");
            if(!date) return showToast("Saisissez une date","error");
            const btn=document.getElementById('submit-btn');
            btn.textContent='...'; btn.disabled=true;
            const {data:ins,error}=await sb.from('transactions').insert([{
                user_id:userProfile.id, maison_id:userProfile.maison_id, montant:amount,
                motif:currentType==='recette'?'RECETTE':motif, commentaire:comment||null,
                created_at:dateSaisieVersISO(date), type:currentType,
                methode_paiement:currentType==='recette'?null:method,
                statut:(currentType==='depense'&&estPerso(method))?'attente':'valide'
            }]).select('id');
            btn.textContent='Enregistrer'; btn.disabled=false;
            if(error){showToast("Erreur : "+error.message,"error");return;}
            memoriserDerniereSaisie(ins?.[0]?.id);
            document.getElementById('tx-amount').value='';
            document.getElementById('tx-comment').value='';
            const needsJustif = currentType==='depense' && method && method.startsWith('perso_');
            if (needsJustif) {
                showToast("Dépense enregistrée — ajoutez le justificatif dans Remboursements", "warning");
                // Basculer sur l'onglet Remboursements après 1.5s
                setTimeout(() => _goTab('remboursements'), 1500);
            } else {
                showToast("Opération enregistrée !", "success");
            }
            await refreshDashboard(); await loadRefundHistory(); await loadJournal();
        }

        // « Annuler » = la dernière opération SAISIE sur cet appareil (moins de 24 h),
        // et non l'opération dont la date est la plus récente.
        function memoriserDerniereSaisie(id) {
            if (!id) return;
            try { localStorage.setItem('smmd_derniere_saisie', JSON.stringify({ id, uid: userProfile.id, t: Date.now() })); } catch (e) {}
        }
        async function undoLast() {
            let last = null;
            try { last = JSON.parse(localStorage.getItem('smmd_derniere_saisie') || 'null'); } catch (e) {}
            if (!last || last.uid !== userProfile.id) return showToast("Aucune saisie récente à annuler","warning");
            if (Date.now() - last.t > 86400000) return showToast("Annulation impossible après 24h","error");
            const { data } = await sb.from('transactions').select('id,motif,montant,statut,methode_paiement').eq('id', last.id).eq('user_id', userProfile.id).maybeSingle();
            if (!data) { localStorage.removeItem('smmd_derniere_saisie'); return showToast("Opération déjà supprimée","warning"); }
            if (estPerso(data.methode_paiement) && data.statut === 'valide') return showToast("Déjà remboursée : impossible d'annuler","error");
            showConfirm(`Annuler la dernière saisie (${data.motif||''} ${parseFloat(data.montant).toFixed(2)}€) ?`,async()=>{
                const{error}=await sb.from('transactions').delete().eq('id',data.id).eq('user_id',userProfile.id);
                if(error) showToast("Erreur : "+error.message,"error");
                else{localStorage.removeItem('smmd_derniere_saisie');showToast("Annulée","info");await refreshDashboard();await loadRefundHistory();await loadJournal();}
            },'Annuler',true);
        }

        async function loadMotifs() {
            const {data}=await sb.from('motifs').select('*').order('nom');
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
                    (data||[]).map(m=>`<option value="${escapeHtml(m.nom)}">${escapeHtml(m.nom.toUpperCase())}</option>`).join('');
            }
        }

        function setTxType(type) {
            currentType=type; const isR=type==='recette';
            document.getElementById('container-motif').classList.toggle('hidden',isR);
            document.getElementById('container-paiement').classList.toggle('hidden',isR);
            const scanEl=document.getElementById('container-scan');
            if(scanEl) scanEl.classList.toggle('hidden',isR);
            document.getElementById('tab-depense').className=`tab-btn ${isR?'':'tab-active'} flex-1 py-3.5 rounded-[18px] font-black text-[11px] uppercase tracking-widest ${isR?'text-slate-400':''}`;
            document.getElementById('tab-recette').className=`tab-btn ${isR?'tab-recette':''} flex-1 py-3.5 rounded-[18px] font-black text-[11px] uppercase tracking-widest ${isR?'':'text-slate-400'}`;
        }

        async function updateAllocation() {
            const val=parseFloat(document.getElementById('settings-allocation').value);
            if(isNaN(val)||val<0) return showToast("Montant invalide","error");
            const{error}=await sb.from('profiles').update({allocation_mensuelle:val}).eq('id',userProfile.id);
            if(error){showToast("Erreur","error");return;}
            userProfile.allocation_mensuelle=val; showToast("Allocation mise à jour !","success"); await refreshDashboard();
        }

        async function updateIban() {
            const raw=document.getElementById('settings-iban').value.trim();
            const errEl=document.getElementById('iban-error');
            if(raw&&!validateIban(raw)){errEl.classList.remove('hidden');return;}
            errEl.classList.add('hidden');
            const normalized=raw?normalizeIban(raw):null;
            const{error}=await sb.from('profiles').update({iban:normalized}).eq('id',userProfile.id);
            if(error){showToast("Erreur","error");return;}
            userProfile.iban=normalized; showToast("IBAN mis à jour !","success");
        }

        async function updatePassword() {
            const p=document.getElementById('settings-pass').value;
            if(p.length<6) return showToast("6 caractères minimum","error");
            const{error}=await sb.auth.updateUser({password:p});
            if(error) showToast(error.message,"error");
            else{showToast("Mot de passe modifié !","success");document.getElementById('settings-pass').value='';}
        }

        // ── ALLOCATIONS : le membre DÉCLARE, le chef CONFIRME ──
        // statut 'declare' = signalé par le membre (non compté dans les soldes)
        // statut 'confirme' (ou absent) = confirmé par le chef
        async function loadVersementsHistory() {
            const allMois = getMoisDepuis2026();
            const { data: vers, error } = await sb.from('allocations_versees')
                .select('*').eq('user_id', userProfile.id);
            const alloc = parseFloat(userProfile.allocation_mensuelle)||0;
            const container = document.getElementById('versements-history');
            if (error) { container.innerHTML=`<p class="text-center text-red-300 text-[11px] font-bold uppercase py-8">Erreur de chargement</p>`; return; }

            if (alloc <= 0 && !(vers||[]).length) {
                container.innerHTML=`
                    <div class="bg-white rounded-[28px] border border-slate-100 shadow-premium p-8 text-center">
                        <div class="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3"><img src="./icon-512.png" style="width:40px;height:40px;object-fit:contain;" alt=""></div>
                        <p class="text-slate-700 text-[12px] font-black uppercase tracking-widest mb-2">Allocation non définie</p>
                        <p class="text-slate-400 text-[11px] font-bold leading-relaxed">Votre allocation mensuelle n'est pas encore configurée. Contactez votre chef de maison.</p>
                    </div>`;
                return;
            }

            const confirmes = (vers||[]).filter(allocConfirmee);
            const totalVerse = confirmes.reduce((s,v)=>s+parseFloat(v.montant),0);
            const totalDecl  = (vers||[]).filter(v=>!allocConfirmee(v)).reduce((s,v)=>s+parseFloat(v.montant),0);

            container.innerHTML = `
                <div class="bg-white rounded-[28px] border border-slate-100 shadow-premium shadow-sm overflow-hidden mb-3">
                    <div class="px-5 py-4 bg-slate-50 flex justify-between items-center">
                        <p class="text-[9px] font-black uppercase text-slate-400 tracking-widest">Total confirmé</p>
                        <p class="font-black text-base text-slate-800">${totalVerse.toFixed(2)}€</p>
                    </div>
                    ${totalDecl>0?`<div class="px-5 py-2 flex justify-between items-center"><p class="text-[9px] font-black uppercase text-amber-500 tracking-widest">En attente de confirmation</p><p class="font-black text-[12px] text-amber-500">${totalDecl.toFixed(2)}€</p></div>`:''}
                </div>
                <div class="bg-white rounded-[28px] border border-slate-100 shadow-premium shadow-sm overflow-hidden">
                    <div class="px-5 py-4 border-b border-slate-50">
                        <p class="text-[11px] font-black uppercase tracking-widest text-slate-700">Tous les mois</p>
                        <p class="text-[9px] text-slate-400 font-bold mt-0.5">Appuyez sur un mois pour déclarer votre versement — votre chef le confirmera</p>
                    </div>
                    <div class="divide-y divide-slate-50">
                        ${allMois.map((m, i) => {
                            const v = (vers||[]).find(v=>parseInt(v.mois)===m.mois&&parseInt(v.annee)===m.annee);
                            const etat = !v ? 'aucun' : (allocConfirmee(v) ? 'confirme' : 'declare');
                            const montant = v ? parseFloat(v.montant) : alloc;
                            const libelle = etat==='confirme' ? '✓ Confirmé par le chef'
                                          : etat==='declare'  ? '⏳ Déclaré le '+new Date(v.created_at).toLocaleDateString('fr-FR')+' — à confirmer'
                                          : 'Non versé';
                            return `<button type="button"
                                onclick="userToggleVersement(${m.mois},${m.annee},this)"
                                class="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 active:scale-[.98] transition-all anim-slide" style="animation-delay:${i*.02}s">
                                <div class="flex items-center gap-3">
                                    <span class="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center transition-all ${etat==='confirme'?'bg-emerald-500':etat==='declare'?'bg-amber-400':'bg-slate-100 border-2 border-slate-200'}">
                                        ${etat!=='aucun'?`<svg class="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`:''}
                                    </span>
                                    <div class="text-left">
                                        <p class="text-[11px] font-black uppercase text-slate-800">${MOIS_FR[m.mois-1]} ${m.annee}</p>
                                        <p class="text-[9px] font-bold ${etat==='confirme'?'text-emerald-600':'text-amber-500'}">${libelle}</p>
                                    </div>
                                </div>
                                <p class="font-black text-[13px] ${etat==='confirme'?'text-emerald-600':etat==='declare'?'text-amber-500':'text-slate-300'}">${etat==='aucun'?'':'+'}${montant.toFixed(2)}€</p>
                            </button>`;
                        }).join('')}
                    </div>
                </div>`;
        }

        function getMoisDepuis2026() {
            const liste=[], debut=new Date(2026,0,1), now=new Date();
            let cur=new Date(debut);
            while(cur<=now){ liste.push({mois:cur.getMonth()+1, annee:cur.getFullYear()}); cur.setMonth(cur.getMonth()+1); }
            return liste.reverse();
        }

        async function lireAllocMois(mois, annee) {
            const { data } = await sb.from('allocations_versees').select('id,statut,montant')
                .eq('user_id', userProfile.id).eq('mois', mois).eq('annee', annee).maybeSingle();
            return data || null;
        }

        // Déclare (ou retire la déclaration) du versement d'un mois
        async function basculerDeclaration(mois, annee) {
            const alloc = parseFloat(userProfile.allocation_mensuelle)||0;
            const existing = await lireAllocMois(mois, annee);
            if (existing && allocConfirmee(existing)) {
                showToast(`${MOIS_FR[mois-1]} ${annee} est confirmé par le chef — demandez-lui pour toute correction`, 'info');
                return null;
            }
            if (existing) {
                const { error } = await sb.from('allocations_versees').delete()
                    .eq('id', existing.id).eq('user_id', userProfile.id).eq('statut', 'declare');
                if (error) { showToast("Erreur : "+error.message,"error"); return null; }
                showToast(`${MOIS_FR[mois-1]} ${annee} — déclaration retirée`,"info");
                return 'aucun';
            }
            if (alloc <= 0) { showToast("Allocation non définie","warning"); return null; }
            const { error } = await sb.from('allocations_versees').insert([{
                user_id: userProfile.id, maison_id: userProfile.maison_id,
                mois, annee, montant: alloc, statut: 'declare', valide_par: null
            }]);
            if (error) { showToast("Erreur : "+error.message,"error"); return null; }
            showToast(`${MOIS_FR[mois-1]} ${annee} — versement déclaré, en attente du chef`,"success");
            return 'declare';
        }

        async function userToggleVersement(mois, annee, btn) {
            btn.disabled = true;
            const etat = await basculerDeclaration(mois, annee);
            btn.disabled = false;
            if (etat === null) return;
            await loadVersementsHistory();
            await refreshDashboard();
            const now=new Date();
            if (mois===now.getMonth()+1 && annee===now.getFullYear()) setAllocBtnState(etat, mois, annee);
        }

        async function checkAllocVersee() {
            const alloc=parseFloat(userProfile.allocation_mensuelle)||0;
            if(alloc<=0) return;
            const now=new Date(),mois=now.getMonth()+1,annee=now.getFullYear();
            const v = await lireAllocMois(mois, annee);
            const etat = !v ? 'aucun' : (allocConfirmee(v) ? 'confirme' : 'declare');
            setAllocBtnState(etat, mois, annee);
            if(etat === 'aucun'){
                // Rappel une seule fois par jour
                const cle = 'smmd_rappel_alloc_' + new Date().toDateString();
                if (localStorage.getItem(cle)) return;
                try { localStorage.setItem(cle, '1'); } catch (e) {}
                document.getElementById('alloc-reminder-text').textContent=`Vous n'avez pas encore déclaré le versement de votre allocation de ${MOIS_FR[mois-1]} ${annee} à votre maison. Déclarez-le dès que vous l'avez effectué : votre chef le confirmera.`;
                document.getElementById('alloc-reminder-montant').textContent=alloc.toFixed(2)+'€';
                document.getElementById('alloc-reminder-modal').classList.remove('hidden');
            }
        }

        async function toggleAllocation() {
            const now=new Date(), mois=now.getMonth()+1, annee=now.getFullYear();
            const btn  = document.getElementById('btn-confirmer-alloc');
            const btn2 = document.getElementById('btn-declarer-alloc');
            if (btn)  btn.disabled=true;
            if (btn2) btn2.disabled=true;
            const etat = await basculerDeclaration(mois, annee);
            if (btn)  btn.disabled=false;
            if (btn2) btn2.disabled=false;
            if (etat === null) return;
            closeAllocReminder();
            setAllocBtnState(etat, mois, annee);
            await refreshDashboard();
            await loadVersementsHistory();
        }

        function setAllocBtnState(etat, mois, annee) {
            const btn2 = document.getElementById('btn-declarer-alloc');
            if (!btn2) return;
            btn2.classList.remove('hidden','bg-amber-500','shadow-amber-500/20','bg-emerald-500','shadow-emerald-500/20','bg-slate-400');
            if (etat === 'confirme') {
                btn2.classList.add('bg-emerald-500','shadow-emerald-500/20');
                btn2.textContent = `✓ Allocation ${MOIS_FR[mois-1]} confirmée par le chef`;
            } else if (etat === 'declare') {
                btn2.classList.add('bg-emerald-500','shadow-emerald-500/20');
                btn2.textContent = `⏳ ${MOIS_FR[mois-1]} déclarée — Retirer`;
            } else {
                btn2.classList.add('bg-amber-500','shadow-amber-500/20');
                btn2.textContent = `🏠 Déclarer mon versement du mois`;
            }
        }

        function closeAllocReminder(){document.getElementById('alloc-reminder-modal').classList.add('hidden');}

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
            } catch(e) { console.warn('badge messages non lus :', e.message || e); }
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

        function logout(){sb.auth.signOut().then(()=>window.location.href="index.html");}
        


        // ── FAB NAVIGATION ──
        let _navOpen = false;
        let _activeTab = 'saisie';
        let scannedFile = null;
        let _lastBase64 = null;
        let extraPhotos = [];
        let justifPhotos = [];

        function menuGo(name, cb) { _goTab(name, cb); }
        function goSaisie() { _goTab('saisie'); }

        async function exportJournalExcel() {
            const mois  = document.getElementById('journal-mois').value;
            const annee = document.getElementById('journal-annee').value;
            showToast('Génération Excel...', 'info');
            const { debut, fin } = bornesMois(annee, mois);
            let filtered, justifSet;
            try {
                filtered = await fetchAll(() => sb.from('transactions')
                    .select('*').eq('user_id', userProfile.id)
                    .gte('created_at', debut).lt('created_at', fin)
                    .order('created_at', { ascending: true }));
                justifSet = await idsAvecJustif(filtered.map(t => t.id));
            } catch (e) { showToast('Erreur : ' + e.message, 'error'); return; }
            if (!filtered.length) { showToast('Aucune opération ce mois', 'warning'); return; }
            const rows = filtered.map(t => ({
                'Date': new Date(t.created_at).toLocaleDateString('fr-FR'),
                'Type': t.type === 'recette' ? 'Recette' : 'Dépense',
                'Motif': t.motif || '',
                'Commentaire': t.commentaire || '',
                'Montant (€)': parseFloat(t.montant).toFixed(2),
                'Moyen de paiement': t.methode_paiement || '',
                'Statut': t.statut === 'attente' ? 'En attente' : 'Validé',
                'Justificatif': aJustif(t, justifSet) ? 'Oui' : 'Non'
            }));
            const ws = XLSX.utils.json_to_sheet(rows);
            ws['!cols'] = [{wch:12},{wch:10},{wch:20},{wch:30},{wch:12},{wch:20},{wch:12},{wch:12}];
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Journal');
            const moisNom = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
            XLSX.writeFile(wb, `Journal_${moisNom[parseInt(mois)-1]}_${annee}.xlsx`);
            showToast('Excel téléchargé !', 'success');
        }

        function goToProfil() { _goTab('profil'); }

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
            try { await init(); } catch(e) { console.error('Init error:', e); }
            finally { hideSplash(); }
        }
        safeInit();
    
