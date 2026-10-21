// ============================================================
// Edge Function: ai-asistent (2026-10-21)
// Tanki posrednik ka Anthropic Messages API-ju za AI asistenta direktora u GradnjaOS-u.
//   - API ključ živi SAMO ovde (secret ANTHROPIC_API_KEY), nikad u browseru ni u repou.
//   - Kapija: JWT pozivaoca → auth.getUser → profili.uloga mora biti 'direktor' (RLS: svako čita svoj red).
//     verify_jwt na gateway-u nije dovoljan — anon ključ je takođe validan JWT.
//   - NE čita poslovne podatke: alate (gradilišta, situacije, dnevnik…) izvršava KLIJENT nad podacima
//     koje direktor ionako vidi (iste formule zdravlja/upozorenja kao u aplikaciji).
//   - Prosleđuje samo dozvoljena polja (system, messages, tools, max_tokens) i vraća odgovor modela.
//
// Deploy:  supabase functions deploy ai-asistent   (ili kroz Supabase MCP)
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (Dashboard → Edge Functions → Secrets)
//          opciono AI_MODEL (podrazumevano claude-sonnet-5-5)
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
const MAX_BODY = 300_000;   // ~300 KB: razgovor + rezultati alata

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Samo POST.' }, 405);

  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Nedostaje prijava.' }, 401);

  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user }, error: uerr } = await supa.auth.getUser(jwt);
  if (uerr || !user) return json({ error: 'Prijava nije važeća.' }, 401);
  const { data: prof } = await supa.from('profili').select('uloga').eq('user_id', user.id).maybeSingle();
  if (!prof || prof.uloga !== 'direktor') return json({ error: 'Asistent je dostupan samo direktoru.' }, 403);

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ error: 'ANTHROPIC_API_KEY nije podešen (Supabase → Edge Functions → Secrets).' }, 503);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: 'Razgovor je predugačak — započni novi.' }, 413);
  let body: { system?: string | unknown[]; messages?: unknown[]; tools?: unknown[]; max_tokens?: number };
  try { body = JSON.parse(raw); } catch { return json({ error: 'Telo zahteva mora biti JSON.' }, 400); }
  if (!Array.isArray(body.messages) || !body.messages.length) return json({ error: 'Nema poruka.' }, 400);

  const payload = {
    model: Deno.env.get('AI_MODEL') || 'claude-sonnet-5-5',
    max_tokens: Math.min(Math.max(+(body.max_tokens || 1500), 256), 4000),
    // system: string ILI niz blokova (klijent šalje [{type:'text', text, cache_control}] radi keširanja prefiksa)
    system: typeof body.system === 'string' ? body.system.slice(0, 20_000) : (Array.isArray(body.system) ? body.system.slice(0, 4) : undefined),
    messages: body.messages,
    tools: Array.isArray(body.tools) ? body.tools : undefined,
  };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = text.slice(0, 500);
    try { const j = JSON.parse(text); msg = j?.error?.message || msg; } catch { /* tekst */ }
    return json({ error: 'Model nije odgovorio (' + r.status + '): ' + msg }, 502);
  }
  return new Response(text, { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
