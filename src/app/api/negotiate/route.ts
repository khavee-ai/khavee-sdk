import { NextRequest } from 'next/server';

/**
 * Mints an OpenAI Realtime ephemeral session token server-to-server, so the
 * real OPENAI_API_KEY never reaches the browser. Matches the contract
 * OpenAIRealtimeProvider.connect() expects in useProxy mode: POST
 * { sessionConfig } in, { data: { ephemeralToken, sessionId } } out. The
 * client then negotiates the SDP offer itself, directly against OpenAI's
 * /v1/realtime/calls endpoint, using this ephemeral token as the bearer.
 *
 * OpenAI's client_secrets endpoint requires the session config nested under
 * a top-level "session" key — posting it unwrapped is rejected with
 * `400 Unknown parameter` for every field.
 */
export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response('Missing OPENAI_API_KEY', { status: 500 });
  }

  const { sessionConfig } = await request.json();

  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ session: sessionConfig }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('OpenAI token mint failed:', response.status, errorText);
    const status = response.status >= 400 && response.status < 600 ? response.status : 502;
    return new Response('Failed to mint session token', { status });
  }

  const body = await response.json();
  const ephemeralToken = body?.value;

  if (!ephemeralToken) {
    console.error('OpenAI token mint failed: 2xx response missing `value` field', body);
    return new Response('Failed to mint session token', { status: 502 });
  }

  return Response.json({
    data: {
      ephemeralToken,
      sessionId: body?.session?.id,
    },
  });
}
