// SMMD — Edge Function « lire-releve » : lit un relevé bancaire (PDF scanné ou photo) avec Gemini
//
// POST { base64, mime }  (chef ou admin connecté)
// → { releves: [ { date_releve, solde_debut, solde_fin, lignes: [ { date, libelle, debit, credit } ] } ] }
//
// Secrets : la clé Gemini déjà utilisée par « scan-ticket » (GEMINI_API_KEY, ou GOOGLE_API_KEY) ;
//           GEMINI_MODEL facultatif : un ou plusieurs modèles séparés par des virgules (des modèles de secours suivent)
// Déploiement : « Verify JWT » ACTIVÉ (seuls les utilisateurs connectés peuvent l'appeler)
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CLE = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("GEMINI_KEY") || "";
// Plusieurs modèles possibles, essayés dans l'ordre si le premier est saturé ou indisponible
const MODELES = (Deno.env.get("GEMINI_MODEL") || "gemini-3.8-flash").split(",").map(x => x.trim()).filter(Boolean)
  .concat(["gemini-3.8-flash", "gemini-3.8-flash-lite", "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash", "gemini-2.0-flash"])
  .filter((x, i, a) => a.indexOf(x) === i);
const attendre = (ms: number) => new Promise(ok => setTimeout(ok, ms));

const CONSIGNE = `Tu lis des relevés de compte bancaire français (souvent Crédit Mutuel), éventuellement scannés, éventuellement plusieurs mois dans le même document.
Pour CHAQUE relevé (chaque mois), renvoie :
- date_releve : date d'édition du relevé (AAAA-MM-JJ)
- solde_debut : le solde au début du relevé (null si la page n'en imprime pas, ex. page de suite / verso) (« SOLDE CREDITEUR AU … » en tête, ou « SOLDE NUL » = 0). Négatif si débiteur.
- solde_fin : le solde en fin de relevé. Négatif si débiteur.
- lignes : toutes les opérations, dans l'ordre, avec
  date (date d'opération AAAA-MM-JJ),
  libelle (toutes les lignes de texte de l'opération réunies en une seule, séparées par un espace, ex. « VIR MONSIEUR LE GALL GUILLAU MONSIEUR LE GALL GUILLAUME PARTICIPATION COMMUNAUTE »),
  debit (nombre positif ou 0), credit (nombre positif ou 0).
N'invente rien. Les montants français « 1.238,73 » valent 1238.73. Ignore les lignes de solde, les totaux et les mentions légales.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    releves: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          date_releve: { type: "STRING" }, solde_debut: { type: "NUMBER" }, solde_fin: { type: "NUMBER" },
          lignes: { type: "ARRAY", items: { type: "OBJECT", properties: {
            date: { type: "STRING" }, libelle: { type: "STRING" }, debit: { type: "NUMBER" }, credit: { type: "NUMBER" } },
            required: ["date", "libelle", "debit", "credit"] } },
        },
        required: ["lignes"],
      },
    },
  },
  required: ["releves"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    const { data: { user } } = await db.auth.getUser(jwt);
    if (!user) return json({ error: "Session expirée — reconnectez-vous" }, 401);
    const { data: p } = await db.from("profiles").select("role, actif").eq("id", user.id).maybeSingle();
    if (!p || p.actif === false || !["chef", "admin"].includes(p.role)) return json({ error: "Réservé au chef de maison et à l'administrateur" }, 403);
    if (!CLE) return json({ error: "Clé Gemini absente des secrets Supabase (GEMINI_API_KEY)" }, 500);

    const { base64, mime } = await req.json();
    if (!base64) return json({ error: "Fichier manquant" }, 400);
    const donnees = String(base64).replace(/^data:[^,]*,/, "");
    const appel = async (modele: string, reflexion: boolean) => {
      const gen: Record<string, unknown> = { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA };
      if (reflexion) gen.thinkingConfig = { thinkingLevel: "minimal" };   // lecture de tableau : pas besoin de « réfléchir », beaucoup plus rapide
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent?key=${CLE}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mime || "application/pdf", data: donnees } }, { text: CONSIGNE }] }], generationConfig: gen }),
      });
      return { r, j: await r.json().catch(() => ({})) };
    };
    let txt = "", derniere = "";
    essais: for (const modele of MODELES) {
      for (let tentative = 0; tentative < 2; tentative++) {
        let { r, j } = await appel(modele, true);
        if (r.status === 400 && /thinking/i.test(j.error?.message || "")) ({ r, j } = await appel(modele, false));
        if (r.ok && !(j.candidates?.[0]?.content?.parts || []).length) { derniere = "réponse vide"; continue essais; }
        if (r.ok) { txt = j.candidates?.[0]?.content?.parts?.map((x: { text?: string }) => x.text || "").join("") || ""; if (txt) break essais; derniere = "réponse vide"; continue; }
        derniere = j.error?.message || `erreur ${r.status}`;
        if (r.status === 404 || r.status === 400 || /no longer available|not found|not supported/i.test(derniere)) continue essais;  // modèle inconnu : suivant
        if (r.status === 429 || r.status >= 500) { await attendre(1500); continue; }                                             // saturé : on réessaie puis modèle suivant
        return json({ error: "Lecture impossible : " + derniere }, 502);
      }
    }
    if (!txt) return json({ error: "Service d'IA indisponible pour le moment (" + derniere + ")" }, 503);
    let out;
    try { out = JSON.parse(txt); } catch (_) { return json({ error: "Réponse illisible de l'IA, réessayez" }, 502); }
    return json(out);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
