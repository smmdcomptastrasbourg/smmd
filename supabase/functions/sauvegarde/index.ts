// SMMD — Edge Function « sauvegarde » : copie des données et des justificatifs dans Google Drive
//
// Actions (POST JSON, sauf le retour Google en GET) :
//  • { action: "connecter" }   (admin) → renvoie l'adresse Google où autoriser l'accès au Drive
//  • GET ?code=…&state=…        retour de Google → enregistre l'accès, puis revient dans l'app
//  • { action: "etat" }        (admin) → compte connecté, dernières sauvegardes
//  • { action: "lancer" }      (admin) → sauvegarde immédiate (données + un lot de justificatifs)
//  • { action: "deconnecter" } (admin) → oublie l'accès au Drive
//  • { action: "auto" }        (pg_cron, en-tête x-cron-secret) → données si > 6 jours, justificatifs nouveaux
//
// Secrets : GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CRON_SECRET, APP_URL (ex. https://smmdcomptastrasbourg.github.io/smmd/)
// Déploiement : « Verify JWT » DÉSACTIVÉ (Google revient sans session ; la fonction vérifie elle-même l'admin)
// Accès Google demandé : drive.file → la fonction ne voit QUE les fichiers qu'elle a créés.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const URL_SB = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") || "", CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const APP_URL = (Deno.env.get("APP_URL") || "https://smmdcomptastrasbourg.github.io/smmd/").replace(/\/?$/, "/");
const REDIRECT = `${URL_SB}/functions/v1/sauvegarde`;
const SCOPE = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email";
const TABLES = ["maisons", "profiles", "motifs", "transactions", "allocations_versees", "comptes_maisons", "virements_sepa",
  "annulations_remboursement", "parametres", "notifications"];
const GARDER = 12;          // nombre de sauvegardes de données conservées
const LOT_JUSTIFS = 60;     // justificatifs envoyés par passage (limite de durée des fonctions)

async function journal(type: string, ok: boolean, detail: string) { await db.from("sauvegarde_journal").insert({ type, ok, detail: detail.slice(0, 500) }); }
async function config() { const { data } = await db.from("sauvegarde_config").select("*").eq("id", 1).maybeSingle(); return data; }

async function estAdmin(req: Request) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!jwt) return false;
  const { data: { user } } = await db.auth.getUser(jwt);
  if (!user) return false;
  const { data: p } = await db.from("profiles").select("role, actif").eq("id", user.id).maybeSingle();
  return p?.role === "admin" && p?.actif !== false;
}

// ── Google
async function jetonAcces(refresh: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }) });
  const j = await r.json();
  if (!j.access_token) throw new Error("Accès Google refusé (" + (j.error || r.status) + ") : reconnectez le Drive dans Admin");
  return j.access_token as string;
}
async function gapi(tok: string, url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${tok}`, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`Drive ${r.status} : ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
}
async function creerDossier(tok: string, nom: string, parent?: string) {
  const f = await gapi(tok, "https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: nom, mimeType: "application/vnd.google-apps.folder", ...(parent ? { parents: [parent] } : {}) }) });
  return f.id as string;
}
async function dossierRacine(tok: string, cfg: Record<string, string>) {
  if (cfg.dossier_id) {
    try { const f = await gapi(tok, `https://www.googleapis.com/drive/v3/files/${cfg.dossier_id}?fields=id,trashed`); if (!f.trashed) return cfg.dossier_id; } catch (_) { /* recréé */ }
    await db.from("sauvegarde_dossiers").delete().neq("chemin", "");
  }
  const id = await creerDossier(tok, "SMMD sauvegardes");
  await db.from("sauvegarde_config").update({ dossier_id: id, updated_at: new Date().toISOString() }).eq("id", 1);
  return id;
}
async function dossier(tok: string, racine: string, chemin: string[]) {
  let parent = racine, cle = "";
  for (const part of chemin) {
    cle += "/" + part;
    const { data } = await db.from("sauvegarde_dossiers").select("drive_id").eq("chemin", cle).maybeSingle();
    if (data) { parent = data.drive_id; continue; }
    parent = await creerDossier(tok, part, parent);
    await db.from("sauvegarde_dossiers").upsert({ chemin: cle, drive_id: parent });
  }
  return parent;
}
async function envoyerFichier(tok: string, parent: string, nom: string, mime: string, contenu: Uint8Array) {
  const limite = "smmd" + crypto.randomUUID();
  const meta = new TextEncoder().encode(`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: nom, parents: [parent] })}\r\n--${limite}\r\nContent-Type: ${mime}\r\n\r\n`);
  const fin = new TextEncoder().encode(`\r\n--${limite}--`);
  const corps = new Uint8Array(meta.length + contenu.length + fin.length); corps.set(meta); corps.set(contenu, meta.length); corps.set(fin, meta.length + contenu.length);
  const f = await gapi(tok, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${limite}` }, body: corps });
  return f.id as string;
}

// ── Lecture complète d'une table (par pages de 1000)
async function toutLire(table: string) {
  const out: Record<string, unknown>[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db.from(table).select("*").range(de, de + 999);
    if (error) throw new Error(`${table} : ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  // les photos partent à part : on ne garde pas les colonnes base64 dans le fichier de données
  return out.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !/base64/i.test(k))));
}

async function sauverDonnees(tok: string, racine: string) {
  const contenu: Record<string, unknown> = { application: "SMMD", date: new Date().toISOString(), tables: {} };
  const tailles: string[] = [];
  for (const t of TABLES) {
    try { const rows = await toutLire(t); (contenu.tables as Record<string, unknown>)[t] = rows; tailles.push(`${t} ${rows.length}`); }
    catch (e) { tailles.push(`${t} ignorée (${(e as Error).message.slice(0, 60)})`); }
  }
  const brut = new TextEncoder().encode(JSON.stringify(contenu));
  const gz = new Uint8Array(await new Response(new Blob([brut]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  const parent = await dossier(tok, racine, ["Données"]);
  const nom = `smmd-donnees-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-")}.json.gz`;
  await envoyerFichier(tok, parent, nom, "application/gzip", gz);
  // Rotation : on garde les GARDER plus récentes
  const liste = await gapi(tok, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${parent}' in parents and trashed=false and name contains 'smmd-donnees-'`)}&orderBy=name desc&fields=files(id,name)&pageSize=100`);
  for (const f of (liste.files || []).slice(GARDER)) await gapi(tok, `https://www.googleapis.com/drive/v3/files/${f.id}`, { method: "DELETE" });
  const detail = `${nom} (${Math.round(gz.length / 1024)} Ko) : ${tailles.join(", ")}`;
  await journal("donnees", true, detail);
  return detail;
}

const propre = (s: string) => (s || "").normalize("NFC").replace(/[\/\\:*?"<>|]+/g, "-").trim().slice(0, 60) || "inconnu";
async function sauverJustificatifs(tok: string, racine: string) {
  const { data: faits } = await db.from("sauvegarde_justifs").select("image_id");
  const deja = new Set((faits || []).map(f => f.image_id));
  // ids seulement, puis contenu image par image (les photos sont lourdes)
  const ids: { id: string; transaction_id: string; ordre: number; mime_type: string }[] = [];
  for (let de = 0; ; de += 1000) {
    const { data } = await db.from("justificatifs_images").select("id, transaction_id, ordre, mime_type").order("id").range(de, de + 999);
    ids.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const afaire = ids.filter(i => !deja.has(i.id)), lot = afaire.slice(0, LOT_JUSTIFS);
  if (!lot.length) return "aucun nouveau justificatif";
  const { data: txs } = await db.from("transactions").select("id, user_id, maison_id, montant, motif, created_at").in("id", [...new Set(lot.map(l => l.transaction_id))]);
  const { data: profs } = await db.from("profiles").select("id, prenom, nom");
  const { data: mais } = await db.from("maisons").select("id, nom");
  let n = 0; const debut = Date.now();
  for (const im of lot) {
    if (Date.now() - debut > 100000) break; // marge avant la limite de durée
    const t = (txs || []).find(x => x.id === im.transaction_id);
    const { data: img } = await db.from("justificatifs_images").select("base64").eq("id", im.id).maybeSingle();
    if (!img?.base64) { await db.from("sauvegarde_justifs").upsert({ image_id: im.id, drive_id: "vide" }); continue; }
    const b64 = String(img.base64).replace(/^data:[^,]*,/, "");
    const octets = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const p = (profs || []).find(x => x.id === t?.user_id), m = (mais || []).find(x => x.id === t?.maison_id);
    const d = t ? new Date(t.created_at) : new Date();
    const mois = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const ext = (im.mime_type || "image/jpeg").includes("pdf") ? "pdf" : (im.mime_type || "").includes("png") ? "png" : "jpg";
    const parent = await dossier(tok, racine, ["Justificatifs", propre(m?.nom || "Sans maison"), propre(p ? `${p.prenom || ""} ${p.nom || ""}` : "Membre supprimé"), mois]);
    const nom = `${d.toISOString().slice(0, 10)}_${propre(t?.motif || "depense")}_${t ? Number(t.montant).toFixed(2).replace(".", ",") : "0"}EUR_${String(im.transaction_id).slice(0, 8)}${im.ordre ? "_" + (im.ordre + 1) : ""}.${ext}`;
    const id = await envoyerFichier(tok, parent, nom, im.mime_type || "image/jpeg", octets);
    await db.from("sauvegarde_justifs").upsert({ image_id: im.id, drive_id: id });
    n++;
  }
  const reste = afaire.length - n;
  const detail = `${n} justificatif(s) envoyé(s)` + (reste > 0 ? `, ${reste} restant(s) pour les prochains passages` : ", tout est à jour");
  await journal("justificatifs", true, detail);
  return detail;
}

async function sauvegarder(forcerDonnees: boolean) {
  const cfg = await config();
  if (!cfg?.refresh_token) throw new Error("Google Drive n'est pas connecté");
  const tok = await jetonAcces(cfg.refresh_token);
  const racine = await dossierRacine(tok, cfg);
  const res: string[] = [];
  const { data: der } = await db.from("sauvegarde_journal").select("created_at").eq("type", "donnees").eq("ok", true).order("created_at", { ascending: false }).limit(1);
  const age = der?.[0] ? Date.now() - new Date(der[0].created_at).getTime() : Infinity;
  if (forcerDonnees || age > 6 * 86400000) res.push(await sauverDonnees(tok, racine));
  res.push(await sauverJustificatifs(tok, racine));
  return res;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);

  // Retour de Google après autorisation
  if (req.method === "GET") {
    const code = url.searchParams.get("code"), state = url.searchParams.get("state");
    const retour = (r: string) => Response.redirect(`${APP_URL}v2/admin.html?drive=${r}`, 302);
    if (!code || !state) return retour("annule");
    const cfg = await config();
    if (!cfg?.etat_oauth || cfg.etat_oauth !== state) return retour("refuse");
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: "authorization_code" }) });
    const j = await r.json();
    if (!j.refresh_token) { await journal("connexion", false, "Google n'a pas fourni d'accès durable : " + (j.error_description || j.error || "")); return retour("erreur"); }
    let compte = "";
    try { compte = (await (await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${j.access_token}` } })).json()).email || ""; } catch (_) { /* facultatif */ }
    await db.from("sauvegarde_config").update({ refresh_token: j.refresh_token, compte, etat_oauth: null, dossier_id: null, updated_at: new Date().toISOString() }).eq("id", 1);
    await db.from("sauvegarde_dossiers").delete().neq("chemin", "");
    await db.from("sauvegarde_justifs").delete().neq("drive_id", "");
    await journal("connexion", true, `Drive connecté : ${compte}`);
    return retour("ok");
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { /* vide */ }
  const action = String(body.action || "");

  if (action === "auto") {
    if (!Deno.env.get("CRON_SECRET") || req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ error: "refusé" }, 401);
    try { return json({ ok: true, resultat: await sauvegarder(false) }); }
    catch (e) { await journal("auto", false, (e as Error).message); return json({ error: (e as Error).message }, 500); }
  }

  if (!(await estAdmin(req))) return json({ error: "Réservé à l'administrateur" }, 403);
  try {
    if (action === "connecter") {
      if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: "Secrets GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET absents" }, 400);
      const etat = crypto.randomUUID();
      await db.from("sauvegarde_config").upsert({ id: 1, etat_oauth: etat, updated_at: new Date().toISOString() });
      const p = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", state: etat });
      return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${p}` });
    }
    if (action === "etat") {
      const cfg = await config();
      const { data: j } = await db.from("sauvegarde_journal").select("*").order("created_at", { ascending: false }).limit(15);
      const { count } = await db.from("sauvegarde_justifs").select("image_id", { count: "exact", head: true });
      const { count: total } = await db.from("justificatifs_images").select("id", { count: "exact", head: true });
      return json({ destination: cfg?.destination || "google_drive", connecte: !!cfg?.refresh_token, compte: cfg?.compte || "", configure: !!(CLIENT_ID && CLIENT_SECRET),
        dossier: cfg?.dossier_id ? `https://drive.google.com/drive/folders/${cfg.dossier_id}` : null, journal: j || [], justifs_envoyes: count || 0, justifs_total: total || 0 });
    }
    if (action === "lancer") return json({ ok: true, resultat: await sauvegarder(true) });
    if (action === "deconnecter") {
      const cfg = await config();
      if (cfg?.refresh_token) await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(cfg.refresh_token), { method: "POST" }).catch(() => {});
      await db.from("sauvegarde_config").update({ refresh_token: null, compte: null, dossier_id: null, updated_at: new Date().toISOString() }).eq("id", 1);
      await journal("connexion", true, "Drive déconnecté");
      return json({ ok: true });
    }
    return json({ error: "action inconnue" }, 400);
  } catch (e) {
    await journal(action || "?", false, (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
