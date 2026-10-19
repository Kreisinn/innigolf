// Reads a photographed Trackman scorecard with Claude and returns the scores as JSON.
// Runs on Supabase Edge Functions so the Anthropic API key never reaches the browser.
// Only signed-in league members may call it.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-opus-5-5";
const MAX_IMAGES = 4;
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from the function's secrets

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });

  // Who is calling? Use their own sign-in token so the membership check sees them.
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return reply(401, { error: "Sign in first." });
  const { data: isMember, error: memberErr } = await supabase.rpc("is_member");
  if (memberErr || !isMember) return reply(403, { error: "Only league members can read scorecards." });

  let body: { images?: { media_type: string; data: string }[]; players?: string[] };
  try { body = await req.json(); } catch { return reply(400, { error: "Send JSON." }); }
  const images = (body.images ?? []).filter((i) => MEDIA_TYPES.includes(i?.media_type) && typeof i?.data === "string");
  if (!images.length) return reply(400, { error: "No photo received." });
  if (images.length > MAX_IMAGES) return reply(400, { error: `At most ${MAX_IMAGES} photos at a time.` });
  const players = (body.players ?? []).filter((p) => typeof p === "string").slice(0, 200);

  const prompt = `The photo(s) show the scorecard from one round of indoor golf on a Trackman simulator. It may be a photo of a screen or a printout, possibly at an angle or with glare.

Read the result for every player on the card:
- "player": the name as written.${players.length ? ` If it clearly refers to one of these league members, use their spelling exactly: ${players.join(", ")}.` : ""}
- "hcp": the playing or course handicap if shown, else null.
- "gross": total gross strokes for the round (the total, not net), else null.
- "points": total Stableford points if shown. If only per-hole Stableford points are shown, add them up. If no Stableford figures are visible, use null; do not work points out from strokes.
Also give "course" (course name if visible, else "") and "date" (YYYY-MM-DD if visible, else "").
Put anything you could not read confidently in "uncertain" as short notes, e.g. "Anna's gross could be 88 or 89".

Reply with only a JSON object in this shape:
{"course": "", "date": "", "players": [{"player": "", "hcp": null, "gross": null, "points": null}], "uncertain": []}`;

  try {
    // Server-side fallback re-runs the request on another model if a safety
    // classifier ever declines it (not expected for scorecards, but cheap insurance).
    const params = {
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{
        role: "user",
        content: [
          ...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.media_type, data: i.data } })),
          { type: "text", text: prompt },
        ],
      }],
    };
    // deno-lint-ignore no-explicit-any
    const msg = await anthropic.beta.messages.create(params as any);
    if (msg.stop_reason === "refusal") return reply(422, { error: "The photo could not be read. Enter the scores by hand." });

    const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const json = extractJson(text);
    if (!json || !Array.isArray(json.players)) return reply(422, { error: "No scores found in that photo." });
    return reply(200, json);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return reply(429, { error: "Too many requests. Try again in a minute." });
    if (e instanceof Anthropic.APIError) {
      console.error("Anthropic error", e.status, e.message);
      return reply(502, { error: "The photo reader is unavailable right now." });
    }
    console.error(e);
    return reply(500, { error: "Something went wrong reading the photo." });
  }
});

// Accepts a bare JSON object, one inside a ``` fence, or the span from the first { to the last }.
function extractJson(text: string) {
  const tries = [text, text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1], text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const t of tries) {
    if (!t) continue;
    try { return JSON.parse(t); } catch { /* next */ }
  }
  return null;
}
