// ============================================================
// Edge Function: posalji-trebovanje
// Prima {to, subject, body} i šalje mejl preko Resend-a.
// Dok ova funkcija nije deploy-ovana (ili RESEND_API_KEY nije podešen),
// klijent (index.html, posaljiMejlNabavci) tiho pada nazad na mailto:.
//
// Deploy (kad Jovan kaže da povežemo Supabase):
//   1) supabase functions deploy posalji-trebovanje
//   2) supabase secrets set RESEND_API_KEY=re_xxx
//   3) (opciono) supabase secrets set TREBOVANJE_FROM="GradnjaOS <trebovanje@tvoj-domen.rs>"
//      — bez ovoga koristi se Resend-ov test pošiljalac (radi odmah, ali samo
//      za slanje na verifikovanu adresu dok se domen ne potvrdi u Resend-u).
// ============================================================

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('TREBOVANJE_FROM') || 'GradnjaOS <onboarding@resend.dev>';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Samo POST.' }, 405);

  let payload: { to?: string; subject?: string; body?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Telo zahteva mora biti JSON.' }, 400);
  }

  const { to, subject, body } = payload;
  if (!to || !subject || !body) {
    return json({ error: 'Nedostaje to/subject/body.' }, 400);
  }
  if (!RESEND_API_KEY) {
    // Namerno 500, ne 404: razlikuje "nije deploy-ovano" od "deploy-ovano, nedostaje kljuc"
    // u logovima funkcije — klijent i dalje pada nazad na mailto u oba slucaja.
    return json({ error: 'RESEND_API_KEY nije podešen (Supabase → Edge Functions → Secrets).' }, 500);
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, text: body }),
    });
    const data = await res.json();
    if (!res.ok) return json({ error: data }, res.status);
    return json({ ok: true, id: data.id });
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
});
