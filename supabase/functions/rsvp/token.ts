// Signed answer tokens: "<event id>.<player id>.<signature>". The same file is used by
// send-reminders (to make links) and rsvp (to check them); keep the two copies identical.
const enc = new TextEncoder();

async function signature(message: string): Promise<string> {
  // RSVP_SECRET if set; otherwise the project's service role key, which every function has.
  const secret = Deno.env.get("RSVP_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("No signing secret");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function makeToken(eventId: string, playerId: string): Promise<string> {
  return `${eventId}.${playerId}.${await signature(`${eventId}.${playerId}`)}`;
}

export async function verifyToken(token: string): Promise<{ eventId: string; playerId: string } | null> {
  const [eventId, playerId, sig] = token.split(".");
  if (!eventId || !playerId || !sig) return null;
  const expected = await signature(`${eventId}.${playerId}`);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? { eventId, playerId } : null;
}
