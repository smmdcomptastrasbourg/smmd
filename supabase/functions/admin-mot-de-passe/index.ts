// SMMD — Edge Function « admin-mot-de-passe »
// Permet à un ADMIN connecté de définir un mot de passe provisoire pour un compte.
// Déploiement : supabase functions deploy admin-mot-de-passe
// (laisser « Verify JWT » activé ; SUPABASE_URL, SUPABASE_ANON_KEY et
//  SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par Supabase)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // 1. Qui appelle ? (jeton de session de l'utilisateur connecté)
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: uErr } = await asCaller.auth.getUser();
  if (uErr || !user) return json({ error: "Session invalide — reconnectez-vous" }, 401);

  // 2. Est-ce un admin actif ?
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: me } = await admin.from("profiles").select("role, actif").eq("id", user.id).maybeSingle();
  if (!me || me.role !== "admin" || me.actif === false) return json({ error: "Réservé à l'administrateur" }, 403);

  // 3. Paramètres
  let body: { user_id?: string; password?: string };
  try { body = await req.json(); } catch { return json({ error: "Requête invalide" }, 400); }
  const { user_id, password } = body;
  if (!user_id || typeof password !== "string" || password.length < 8) {
    return json({ error: "Mot de passe de 8 caractères minimum requis" }, 400);
  }

  // 4. Changement du mot de passe
  const { error } = await admin.auth.admin.updateUserById(user_id, { password });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
});
