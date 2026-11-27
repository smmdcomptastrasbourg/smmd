// SMMD — Edge Function « scan-ticket » : lit un ticket de caisse / une facture avec Gemini
//
// POST { base64, mime, motifs?: string[] }  (utilisateur connecté)
// → { montant: number|null, date: "AAAA-MM-JJ"|null, commentaire: string, confiance: "haute"|"moyenne"|"basse", motif?: string }
//
// Rapide d'abord : modèle léger, réflexion minimale ; modèle plus précis seulement si la lecture est incertaine.
// Si un modèle est saturé ou indisponible, on passe au suivant.
// Secrets : GEMINI_API_KEY (ou GOOGLE_API_KEY) ; facultatif : GEMINI_MODEL_RAPIDE, GEMINI_MODEL (listes séparées par des virgules)
// Déploiement : remplacer le code de la fonction « scan-ticket » existante (même nom, même adresse)
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CLE = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("GEMINI_KEY") || "";
const liste = (v: string | undefined, defaut: string[]) => (v ? v.split(",").map(x => x.trim()).filter(Boolean) : defaut);
const RAPIDES = liste(Deno.env.get("GEMINI_MODEL_RAPIDE"), ["gemini-3.8-flash-lite", "gemini-flash-lite-latest"]);
const PRECIS = liste(Deno.env.get("GEMINI_MODEL"), ["gemini-3.8-flash"]).concat(["gemini-flash-latest"]);
const attendre = (ms: number) => new Promise(ok => setTimeout(ok, ms));

const SCHEMA = {
  type: "OBJECT",
  properties: {
    montant: { type: "NUMBER", nullable: true },
    date: { type: "STRING", nullable: true },
    commentaire: { type: "STRING" },
    confiance: { type: "STRING", enum: ["haute", "moyenne", "basse"] },
    motif: { type: "STRING", nullable: true },
  },
  required: ["montant", "date", "commentaire", "confiance"],
};
const consigne = (motifs: string[]) => `Tu lis un ticket de caisse, une facture ou un reçu français (photo ou PDF).
Renvoie :
- montant : le TOTAL payé TTC en euros (nombre, ex. 23.5), pas un sous-total ni la TVA ; null si illisible
- date : la date d'achat au format AAAA-MM-JJ ; null si absente
- commentaire : le nom du commerçant et, en quelques mots, ce qui a été acheté (ex. « Carrefour — courses alimentaires »), 60 caractères maximum
- confiance : « haute » si montant et date sont nets, « moyenne » si un doute, « basse » si la lecture est incertaine
${motifs.length ? `- motif : le motif le plus adapté parmi exactement : ${motifs.join(", ")} ; null si aucun ne convient` : ""}
N'invente rien.`;

type Res = { ok: true; data: Record<string, unknown> } | { ok: false; status: number; message: string };
async function lire(modele: string, donnees: string, mime: string, motifs: string[]): Promise<Res> {
  const corps = (reflexion: boolean) => JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: mime, data: donnees } }, { text: consigne(motifs) }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA, ...(reflexion ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}) },
  });
  const envoyer = async (reflexion: boolean) => {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent?key=${CLE}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: corps(reflexion), signal: ctl.signal });
      return { r, j: await r.json().catch(() => ({})) };
    } finally { clearTimeout(t); }
  };
  try {
    let { r, j } = await envoyer(true);
    if (r.status === 400 && /thinking/i.test(j.error?.message || "")) ({ r, j } = await envoyer(false));
    if (!r.ok) return { ok: false, status: r.status, message: j.error?.message || `erreur ${r.status}` };
    const txt = j.candidates?.[0]?.content?.parts?.map((x: { text?: string }) => x.text || "").join("") || "";
    return { ok: true, data: JSON.parse(txt) };
  } catch (e) {
    return { ok: false, status: 504, message: (e as Error).name === "AbortError" ? "délai dépassé" : (e as Error).message };
  }
}
// Essaie une liste de modèles ; un modèle saturé est réessayé une fois, un modèle inconnu est sauté
async function premierQuiRepond(modeles: string[], donnees: string, mime: string, motifs: string[]) {
  let derniere = "";
  for (const m of modeles) {
    for (let essai = 0; essai < 2; essai++) {
      const r = await lire(m, donnees, mime, motifs);
      if (r.ok) return { data: r.data, modele: m };
      derniere = r.message;
      const passager = r.status === 429 || r.status >= 500;
      if (!passager) break;                       // modèle inconnu / requête refusée : modèle suivant
      if (essai === 0) await attendre(800);
    }
  }
  return { data: null, erreur: derniere };
}

function nettoyer(d: Record<string, unknown>, motifs: string[]) {
  let montant = d.montant === null || d.montant === undefined ? null : Number(String(d.montant).replace(",", "."));
  if (montant !== null && (!isFinite(montant) || montant <= 0)) montant = null;
  let date = typeof d.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : null;
  if (date && (new Date(date) > new Date(Date.now() + 2 * 86400000) || new Date(date) < new Date("2015-01-01"))) date = null;
  const confiance = ["haute", "moyenne", "basse"].includes(String(d.confiance)) ? String(d.confiance) : "basse";
  const out: Record<string, unknown> = { montant: montant !== null ? Math.round(montant * 100) / 100 : null, date, commentaire: String(d.commentaire || "").slice(0, 80), confiance: montant === null ? "basse" : confiance };
  if (typeof d.motif === "string" && motifs.includes(d.motif)) out.motif = d.motif;
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    const { data: { user } } = await db.auth.getUser(jwt);
    if (!user) return json({ error: "Session expirée — reconnectez-vous" }, 401);
    if (!CLE) return json({ error: "Clé Gemini absente des secrets Supabase (GEMINI_API_KEY)" }, 500);
    const { base64, mime, motifs } = await req.json();
    if (!base64) return json({ error: "Photo manquante" }, 400);
    const donnees = String(base64).replace(/^data:[^,]*,/, "");
    const typeMime = mime || "image/jpeg";
    const listeMotifs: string[] = Array.isArray(motifs) ? motifs.map(String).slice(0, 60) : [];

    // 1. Modèle rapide
    const rapide = await premierQuiRepond(RAPIDES, donnees, typeMime, listeMotifs);
    let res = rapide.data ? nettoyer(rapide.data, listeMotifs) : null;
    // 2. Modèle précis seulement si besoin (rapide en panne ou lecture incertaine)
    if (!res || res.montant === null || res.confiance === "basse") {
      const precis = await premierQuiRepond(PRECIS, donnees, typeMime, listeMotifs);
      if (precis.data) res = nettoyer(precis.data, listeMotifs);
      else if (!res) return json({ error: "Service d'IA indisponible pour le moment (" + (precis.erreur || rapide.erreur) + ")" }, 503);
    }
    return json(res);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
