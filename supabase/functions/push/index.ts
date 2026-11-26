// SMMD — Edge Function « push » : notifications sur téléphone (Web Push)
//
// Deux usages :
//  • { action: "envoyer", user_ids, titre, message, url }  — appelée par l'app (chef ou admin)
//      → vérifie la session de l'appelant et n'autorise que les membres de SA maison (admin : tous)
//  • { action: "rappels" }                                  — appelée chaque matin par pg_cron
//      → protégée par l'en-tête x-cron-secret
//
// Secrets à définir (Edge Functions → Secrets) :
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ex. mailto:contact@exemple.fr), CRON_SECRET
// Déploiement : « Verify JWT » DÉSACTIVÉ (la fonction vérifie elle-même la session ; pg_cron n'en a pas)
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:admin@smmd.fr", Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const eur = (v: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(v);

// Envoie une notification à tous les téléphones des utilisateurs donnés ; nettoie les abonnements expirés
async function pousser(userIds: string[], titre: string, message: string, url = "./v2/index.html", tag?: string) {
  if (!userIds.length) return 0;
  const { data: subs } = await admin.from("push_abonnements").select("*").in("user_id", userIds);
  let n = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ titre, message, url, tag }), { TTL: 60 * 60 * 24 });
      n++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin.from("push_abonnements").delete().eq("id", s.id);
    }
  }
  return n;
}

// Date du jour à Paris (AAAA-MM-JJ) et décalage de jours
function jourParis(decalage = 0) {
  const d = new Date(Date.now() + decalage * 86400000);
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(d); // AAAA-MM-JJ
}

async function rappels() {
  const auj = jourParis(), [a, m, j] = auj.split("-").map(Number);
  const jourSemaine = new Date(auj + "T12:00:00Z").getUTCDay(); // 1 = lundi
  const bilan: Record<string, number> = {};
  const { data: profils } = await admin.from("profiles").select("id, role, maison_id, allocation_mensuelle, actif");
  const actifs = (profils || []).filter(p => p.actif !== false);

  // 1. Le 5 du mois : allocation non déclarée
  if (j === 5) {
    const { data: al } = await admin.from("allocations_versees").select("user_id").eq("mois", m).eq("annee", a);
    const ok = new Set((al || []).map(x => x.user_id));
    const cibles = actifs.filter(p => Number(p.allocation_mensuelle) > 0 && !ok.has(p.id)).map(p => p.id);
    bilan.allocation = await pousser(cibles, "Allocation à déclarer", `Pensez à verser et déclarer votre allocation de ${MOIS[m - 1]}.`, "./v2/membre.html", "alloc");
  }

  // 2. Justificatif manquant : dépenses datées d'il y a 3 jours, sans photo
  const j3 = jourParis(-3);
  const { data: deps } = await admin.from("transactions").select("id, user_id, montant, motif, justificatif_url")
    .eq("type", "depense").gte("created_at", j3 + "T00:00:00+01:00").lt("created_at", jourParis(-2) + "T00:00:00+01:00");
  const sans = (deps || []).filter(t => !t.justificatif_url && t.user_id);
  if (sans.length) {
    const { data: imgs } = await admin.from("justificatifs_images").select("transaction_id").in("transaction_id", sans.map(t => t.id));
    const avec = new Set((imgs || []).map(i => i.transaction_id));
    const parUser: Record<string, number> = {};
    sans.filter(t => !avec.has(t.id)).forEach(t => { parUser[t.user_id] = (parUser[t.user_id] || 0) + 1; });
    let n = 0;
    for (const [uid, k] of Object.entries(parUser)) {
      if (!actifs.some(p => p.id === uid)) continue;
      n += await pousser([uid], "Justificatif manquant", k > 1 ? `${k} dépenses n'ont pas encore de justificatif.` : "Une dépense n'a pas encore de justificatif : ajoutez la photo.", "./v2/membre.html", "justif");
    }
    bilan.justificatifs = n;
  }

  // 3. Lundi : résumé « à traiter » pour chaque chef
  if (jourSemaine === 1) {
    const chefs = actifs.filter(p => p.role === "chef");
    let n = 0;
    for (const c of chefs) {
      const [{ data: av }, { data: dec }, { data: vir }] = await Promise.all([
        admin.from("transactions").select("montant").eq("maison_id", c.maison_id).eq("type", "depense").eq("statut", "attente"),
        admin.from("allocations_versees").select("id").eq("maison_id", c.maison_id).eq("statut", "declare"),
        admin.from("virements_sepa").select("id").eq("maison_id", c.maison_id).eq("statut", "genere"),
      ]);
      const parts: string[] = [];
      if (av?.length) parts.push(`${av.length} avance${av.length > 1 ? "s" : ""} à rembourser (${eur(av.reduce((s, x) => s + Number(x.montant), 0))})`);
      if (dec?.length) parts.push(`${dec.length} allocation${dec.length > 1 ? "s" : ""} à confirmer`);
      if (vir?.length) parts.push(`${vir.length} virement${vir.length > 1 ? "s" : ""} SEPA à confirmer`);
      if (parts.length) n += await pousser([c.id], "À traiter cette semaine", parts.join(" · "), "./v2/chef.html", "chef");
    }
    bilan.chefs = n;
  }

  // 4. Le 1er du mois : relevé de la maison disponible (chefs)
  if (j === 1) {
    const mp = m === 1 ? 12 : m - 1;
    bilan.releve = await pousser(actifs.filter(p => p.role === "chef").map(p => p.id), "Relevé mensuel prêt",
      `Le relevé de ${MOIS[mp - 1]} de votre maison est disponible (Maison et profil → Relevé PDF).`, "./v2/chef.html", "releve");
  }
  return bilan;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Requête invalide" }, 400); }

  if (body.action === "rappels") {
    if (!Deno.env.get("CRON_SECRET") || req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ error: "Interdit" }, 403);
    return json({ ok: true, envoyes: await rappels() });
  }

  if (body.action === "envoyer") {
    const asCaller = createClient(URL_SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await asCaller.auth.getUser();
    if (!user) return json({ error: "Session invalide" }, 401);
    const { data: me } = await admin.from("profiles").select("role, maison_id, actif").eq("id", user.id).maybeSingle();
    if (!me || me.actif === false || !["chef", "admin"].includes(me.role)) return json({ error: "Réservé au chef ou à l'admin" }, 403);
    let ids = (Array.isArray(body.user_ids) ? body.user_ids : []).filter((x): x is string => typeof x === "string").slice(0, 200);
    if (me.role === "chef") {
      const { data: ok } = await admin.from("profiles").select("id").in("id", ids).eq("maison_id", me.maison_id);
      ids = (ok || []).map(x => x.id);
    }
    const titre = String(body.titre || "SMMD").slice(0, 80), message = String(body.message || "").slice(0, 240);
    const url = typeof body.url === "string" && body.url.startsWith("./v2/") ? body.url : "./v2/index.html";
    return json({ ok: true, envoyes: await pousser(ids, titre, message, url) });
  }
  return json({ error: "Action inconnue" }, 400);
});
