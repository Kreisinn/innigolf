// Records "Ég mæti" / "Kemst ekki" from the links in a reminder email, without sign-in.
// Each link carries a signed token (see token.ts) that names one event and one player,
// so a link can only answer for the person it was sent to, for that one night.
// Deploy with JWT verification off (players are not signed in when they click).
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyToken } from "./token.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Notaðu POST." });

  let body: { token?: string; status?: string };
  try { body = await req.json(); } catch { return reply(400, { error: "Ógild beiðni." }); }
  const status = body.status;
  if (status !== "yes" && status !== "no") return reply(400, { error: "Ógilt svar." });

  const ids = await verifyToken(String(body.token ?? ""));
  if (!ids) return reply(403, { error: "Hlekkurinn er ógildur. Skráðu þig inn og svaraðu á síðunni." });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const [{ data: event }, { data: player }] = await Promise.all([
    db.from("events").select("event_date").eq("id", ids.eventId).maybeSingle(),
    db.from("players").select("name").eq("id", ids.playerId).maybeSingle(),
  ]);
  if (!event || !player) return reply(404, { error: "Þetta golfkvöld eða leikmaður finnst ekki lengur." });
  const today = new Date().toISOString().slice(0, 10); // Iceland keeps UTC all year
  if (event.event_date < today) return reply(410, { error: "Þetta golfkvöld er liðið." });

  const { error } = await db.from("attendance").upsert(
    { event_id: ids.eventId, player_id: ids.playerId, status, updated_at: new Date().toISOString(), updated_by: "tölvupóstur" },
    { onConflict: "event_id,player_id" },
  );
  if (error) {
    console.error(error);
    return reply(500, { error: "Ekki tókst að skrá svarið. Reyndu aftur síðar." });
  }
  return reply(200, { ok: true, name: player.name, event_date: event.event_date, status });
});
