// Emails a reminder about one league night, with personal "Ég mæti" / "Kemst ekki" links.
// Only organisers may call it. Mail goes out through Brevo (free plan: 300 emails a day).
// Secrets: BREVO_API_KEY and REMINDER_FROM_EMAIL (a sender verified in Brevo);
// optionally REMINDER_FROM_NAME, SITE_URL and RSVP_SECRET (links are signed with it if set).
import { createClient } from "npm:@supabase/supabase-js@2";
import { makeToken } from "./token.ts";

const SITE_URL = Deno.env.get("SITE_URL") ?? "https://kreisinn.github.io/innigolf/";
const FROM_NAME = Deno.env.get("REMINDER_FROM_NAME") ?? "innigolf";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const WEEKDAYS = ["sunnudaginn", "mánudaginn", "þriðjudaginn", "miðvikudaginn", "fimmtudaginn", "föstudaginn", "laugardaginn"];
const MONTHS = ["janúar", "febrúar", "mars", "apríl", "maí", "júní", "júlí", "ágúst", "september", "október", "nóvember", "desember"];
// "þriðjudaginn 27. október"
const onDay = (iso: string) => { const d = new Date(iso + "T12:00:00Z"); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]}`; };
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Notaðu POST." });

  const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await asCaller.auth.getUser();
  if (!user) return reply(401, { error: "Skráðu þig inn fyrst." });
  const { data: isAdmin } = await asCaller.rpc("is_admin");
  if (!isAdmin) return reply(403, { error: "Aðeins umsjónarmenn geta sent áminningar." });

  const apiKey = Deno.env.get("BREVO_API_KEY");
  const fromEmail = Deno.env.get("REMINDER_FROM_EMAIL");
  if (!apiKey || !fromEmail) {
    return reply(503, { error: "Tölvupóstur er ekki uppsettur enn. Setja þarf BREVO_API_KEY og REMINDER_FROM_EMAIL (sjá README)." });
  }

  let body: { event_id?: string; audience?: string };
  try { body = await req.json(); } catch { return reply(400, { error: "Ógild beiðni." }); }
  // "me" sends a single test email to the organiser who asks for it.
  const testOnly = body.audience === "me";
  const onlyUnanswered = body.audience === "unanswered";

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: event } = await db.from("events").select("*").eq("id", body.event_id ?? "").maybeSingle();
  if (!event) return reply(404, { error: "Golfkvöldið finnst ekki." });
  const [{ data: players }, { data: members }, { data: answers }] = await Promise.all([
    db.from("players").select("id,name").eq("active", true),
    db.from("members").select("email,player_id").not("player_id", "is", null),
    db.from("attendance").select("player_id").eq("event_id", event.id),
  ]);
  const answered = new Set((answers ?? []).map((a) => a.player_id));
  const emailOf = new Map((members ?? []).map((m) => [m.player_id, m.email]));
  const recipients = (players ?? [])
    .filter((p) => emailOf.has(p.id) && (!onlyUnanswered || !answered.has(p.id)))
    .map((p) => ({ ...p, email: emailOf.get(p.id)! }))
    .filter((p) => !testOnly || p.email.toLowerCase() === (user.email ?? "").toLowerCase());
  if (testOnly && !recipients.length) return reply(400, { error: "Netfangið þitt er ekki tengt virkum leikmanni." });

  const when = `${onDay(event.event_date)}${event.start_time ? ` kl. ${String(event.start_time).slice(0, 5)}` : ""}`;
  const where = event.location ? `. Staður: ${event.location}` : "";
  const subject = `${testOnly ? "[Prufa] " : ""}Golfkvöld ${when} – mætir þú?`;

  let sent = 0, failed = 0;
  for (const p of recipients) {
    const token = encodeURIComponent(await makeToken(event.id, p.id));
    const yes = `${SITE_URL}?svar=${token}&s=ja`;
    const no = `${SITE_URL}?svar=${token}&s=nei`;
    const first = p.name.split(" ")[0];
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#15211a;max-width:520px">
<p style="margin:0 0 20px"><a href="${SITE_URL}"><img src="${SITE_URL}email-logo.png" width="170" alt="innigolf" style="display:block;border:0;height:auto;width:170px"></a></p>
<p>Hæ ${esc(first)},</p>
<p>Næsta golfkvöld er <b>${esc(when)}</b>${esc(where)}.</p>
${event.notes ? `<p>${esc(event.notes)}</p>` : ""}
<p>Mætir þú?</p>
<p>
<a href="${yes}" style="display:inline-block;background:#1d6f46;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:7px;margin:0 8px 8px 0">Ég mæti</a>
<a href="${no}" style="display:inline-block;background:#ffffff;color:#c4432c;text-decoration:none;font-weight:bold;padding:11px 21px;border-radius:7px;border:1px solid #c4432c;margin:0 0 8px 0">Kemst ekki</a>
</p>
<p style="font-size:13px;color:#5b6b61">Þú getur breytt svarinu hvenær sem er á <a href="${SITE_URL}" style="color:#1d6f46">innigolf</a>.</p>
</div>`;
    const text = `Hæ ${first},\n\nNæsta golfkvöld er ${when}${where}.\n${event.notes ? event.notes + "\n" : ""}\nÉg mæti: ${yes}\nKemst ekki: ${no}\n\nÞú getur breytt svarinu hvenær sem er á ${SITE_URL}`;
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: FROM_NAME, email: fromEmail },
        to: [{ email: p.email, name: p.name }],
        subject, htmlContent: html, textContent: text,
      }),
    });
    if (res.ok) sent++;
    else { failed++; console.error("Brevo", res.status, await res.text()); }
  }

  if (sent && !testOnly) await db.from("events").update({ reminded_at: new Date().toISOString() }).eq("id", event.id);
  return reply(200, { sent, failed, total: recipients.length });
});
