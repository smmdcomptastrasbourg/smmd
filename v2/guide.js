// ═══════════════════════════════════════════════════════════
// SMMD v2 — Guide intégré : visite de bienvenue + aide « ? » par écran
// ═══════════════════════════════════════════════════════════
const GUIDE_ESPACE = location.pathname.includes('admin.html') ? 'admin' : location.pathname.includes('chef.html') ? 'chef' : 'membre';

const GUIDE_VISITE = {
  membre: [
    ['Bienvenue dans SMMD', 'SMMD tient les comptes de votre maison. Vous y notez vos dépenses, vous suivez vos remboursements et vous déclarez votre allocation.'],
    ['Noter une dépense', 'Touchez <b>+</b>. Choisissez <b>Scanner un ticket</b> (l\'IA lit le montant, la date et le motif) ou <b>Saisir à la main</b>. La photo du ticket sert de justificatif.'],
    ['Carte perso ou espèces ?', 'Si vous avez payé avec votre argent, la dépense est une <b>avance</b> : votre chef de maison vous la rembourse, puis elle passe en « Remboursé ».'],
    ['Votre allocation', 'Chaque mois, déclarez dans <b>Profil</b> l\'allocation que vous avez versée. Elle compte dans les soldes une fois que votre chef l\'a confirmée.'],
    ['Besoin d\'aide ?', 'Touchez <b>?</b> à côté du titre de chaque écran pour une explication. L\'app fonctionne aussi sans réseau : vos saisies partent dès que la connexion revient.']
  ],
  chef: [
    ['Bienvenue, chef de maison', 'Votre <b>tableau de bord</b> montre le solde de la maison et ce qui vous attend : avances à rembourser, allocations à confirmer, justificatifs manquants.'],
    ['Rembourser', 'Dans <b>Remboursements</b>, cochez les avances puis générez le <b>fichier de virement SEPA</b> à déposer sur le site de votre banque. Après le virement, touchez <b>Virement effectué</b> : les membres sont prévenus.'],
    ['Allocations', 'Les membres déclarent leurs allocations ; vous les <b>confirmez</b> dans l\'écran Allocations. Seules les allocations confirmées comptent.'],
    ['Relevés et exports', 'Le <b>Relevé</b> liste toutes les opérations de la maison. Dans <b>Maison et profil</b> : relevé mensuel PDF, rapport annuel Excel et justificatifs en ZIP.'],
    ['Besoin d\'aide ?', 'Touchez <b>?</b> à côté du titre de chaque écran.']
  ],
  admin: [
    ['Espace administrateur', 'Vous voyez toutes les maisons. Vous gérez les comptes, les maisons, les motifs, les exports et la comptabilité.'],
    ['Comptes', 'Créez les comptes, changez une maison ou un rôle, désactivez un membre parti (ses opérations sont conservées) ou donnez-lui un mot de passe provisoire.'],
    ['Comptabilité', 'Renseignez le SIREN, ajustez le plan de comptes avec le comptable, puis téléchargez le <b>FEC</b> de l\'exercice.'],
    ['Erreurs', 'Les erreurs rencontrées par les utilisateurs s\'y affichent automatiquement, sans montants ni IBAN.'],
    ['Besoin d\'aide ?', 'Touchez <b>?</b> à côté du titre de chaque écran.']
  ]
};

const GUIDE_AIDE = {
  membre: {
    accueil: ['Votre solde, vos avances en attente et ce qu\'il reste à faire (allocation à déclarer, justificatifs manquants).', 'Le bouton <b>+</b> ajoute une dépense ou une recette.', 'Touchez une opération pour la voir, la modifier ou ajouter une photo.'],
    releve: ['Toutes vos opérations, mois par mois : choisissez le mois en haut.', 'Cherchez un motif, un commentaire ou un montant ; filtrez avec les pastilles.', '<b>Sans justificatif</b> signale une dépense sans photo : touchez-la pour en ajouter une.', 'Le mois peut être exporté en Excel.'],
    remb: ['<b>À rembourser</b> : vos avances (carte perso, espèces) que la maison vous doit.', '<b>Remboursé</b> : votre chef a confirmé le virement.', 'Pour être remboursé par virement, renseignez votre IBAN dans Profil.'],
    profil: ['Déclarez ici l\'<b>allocation</b> versée chaque mois. Votre chef la confirme ensuite.', 'IBAN, montant habituel d\'allocation, mot de passe et notifications.', '« Rechercher une mise à jour » recharge la dernière version de l\'app.']
  },
  chef: {
    tdb: ['Solde de la maison et chiffres du mois.', '<b>À faire</b> : avances à rembourser, allocations à confirmer, justificatifs manquants.'],
    releve: ['Toutes les opérations de la maison, avec filtres (membre, motif, statut).', 'Sur ordinateur : tableau large. Export Excel et justificatifs en ZIP.', 'Touchez une opération remboursée pour <b>annuler le remboursement</b> (motif obligatoire, le membre est prévenu).'],
    remb: ['Cochez les avances à rembourser. Une avance sans justificatif est décochée par défaut.', '<b>Générer le virement SEPA</b> crée un fichier à déposer sur le site de la banque (compte de la maison à renseigner dans Maison et profil).', 'Après le virement, touchez <b>Virement effectué</b> : les avances passent en « Remboursé ».'],
    alloc: ['Une ligne par membre et par mois.', 'Touchez une allocation <b>déclarée</b> pour la confirmer, ou une case vide pour l\'enregistrer vous-même.', 'Seules les allocations confirmées comptent dans les soldes.'],
    membres: ['Les membres de votre maison : allocation mensuelle habituelle (modifiable) et IBAN (bouton Copier).', 'Pour ajouter ou désactiver un membre, contactez l\'administrateur.'],
    profil: ['<b>Compte bancaire de la maison</b> : nécessaire pour les virements SEPA.', 'Exports : <b>relevé mensuel PDF</b>, rapport annuel Excel, justificatifs de l\'année.', 'Vos réglages personnels (IBAN, mot de passe, notifications).']
  },
  admin: {
    tdb: ['Soldes et chiffres de chaque maison.'],
    membres: ['Filtrez par maison ou rôle. Touchez un compte pour changer sa maison, son rôle ou son allocation.', '<b>Désactiver</b> plutôt que supprimer : l\'historique est conservé.', '<b>Mot de passe provisoire</b> : à communiquer au membre, qui le changera ensuite.'],
    maisons: ['Ajoutez les maisons et les motifs de dépense.', 'Un nouveau motif prend le compte comptable par défaut : pensez à l\'ajuster dans Comptabilité.'],
    exports: ['Choisissez le mois, l\'année et la maison.', 'Relevé PDF, journaux Excel et justificatifs en ZIP (classés maison / membre / mois).'],
    compta: ['<b>SIREN</b> et raison sociale de l\'association.', 'Le <b>plan de comptes</b> est une proposition : faites-le valider par le comptable.', 'Le <b>FEC</b> reprend toutes les maisons ; la maison figure dans chaque libellé.'],
    erreurs: ['Erreurs rencontrées par les utilisateurs, avec appareil et version.', 'Montants, IBAN et emails sont masqués.'],
    outils: ['<b>Sauvegarde</b> : copie automatique dans Google Drive (données chaque semaine, nouveaux justificatifs chaque nuit), ou téléchargement manuel.', 'Outils de maintenance et votre profil.']
  }
};

function guideCle() { return `smmd_guide_${GUIDE_ESPACE}_${userProfile?.id || ''}`; }

function ouvrirVisite(i = 0) {
  const etapes = GUIDE_VISITE[GUIDE_ESPACE], [titre, texte] = etapes[i], der = i === etapes.length - 1;
  ouvrirFeuille(`<div class="stack">
    <p class="small muted" style="margin:0">Étape ${i + 1} sur ${etapes.length}</p>
    <p style="margin:0;line-height:1.55">${texte}</p>
    <div class="row" style="gap:10px;margin-top:6px">
      ${der ? '' : '<button class="btn quiet" style="flex:1" onclick="finirVisite()">Passer</button>'}
      <button class="btn primary" style="flex:1" onclick="${der ? 'finirVisite()' : `ouvrirVisite(${i + 1})`}">${der ? 'C\'est parti' : 'Suivant'}</button>
    </div></div>`, { titre });
}
function finirVisite() { try { localStorage.setItem(guideCle(), '1'); } catch (e) {} fermerFeuille(); }

function ouvrirAide() {
  const v = typeof _vue === 'string' ? _vue : '', pts = GUIDE_AIDE[GUIDE_ESPACE][v];
  const titre = document.querySelector(`#v-${v} h1`)?.childNodes[0]?.textContent?.trim() || 'Aide';
  ouvrirFeuille(`<div class="stack">
    ${pts ? `<ul style="margin:0;padding-left:20px;line-height:1.55">${pts.map(p => `<li style="margin-bottom:6px">${p}</li>`).join('')}</ul>` : '<p style="margin:0">Pas d\'aide pour cet écran.</p>'}
    <button class="btn quiet block" onclick="fermerFeuille();ouvrirVisite(0)">Revoir la visite de bienvenue</button>
  </div>`, { titre: 'Aide · ' + titre });
}

function installerBoutonsAide() {
  document.querySelectorAll('section[id^="v-"] h1').forEach(h => {
    if (h.querySelector('.guide-btn')) return;
    const b = document.createElement('button');
    b.className = 'iconbtn guide-btn'; b.type = 'button'; b.textContent = '?';
    b.setAttribute('aria-label', 'Aide sur cet écran'); b.onclick = ouvrirAide;
    h.appendChild(b);
  });
}

(function demarrerGuide() {
  let essais = 0;
  const t = setInterval(() => {
    if (++essais > 60) return clearInterval(t);
    if (typeof userProfile === 'undefined' || !userProfile?.id) return;
    clearInterval(t);
    installerBoutonsAide();
    // Les titres réécrits par l'app (ex. « Bonjour Jean ») perdent le bouton : on le remet
    let att = null; new MutationObserver(() => { clearTimeout(att); att = setTimeout(installerBoutonsAide, 50); }).observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
    let vu = true; try { vu = !!localStorage.getItem(guideCle()); } catch (e) {}
    if (!vu && !document.querySelector('.sheet')) setTimeout(() => ouvrirVisite(0), 600);
  }, 300);
})();
