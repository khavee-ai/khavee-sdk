import { NextRequest } from 'next/server';

/**
 * Mints an OpenAI Realtime ephemeral session token server-to-server.
 *
 * `OpenAIRealtimeProvider` (packages/providers/openai-realtime) POSTs
 * `{ sessionConfig }` here and negotiates the WebRTC SDP offer directly
 * with OpenAI itself using the returned ephemeral token — this route no
 * longer proxies the SDP exchange. That's the current (non-deprecated)
 * OpenAI Realtime flow; the old `/v1/realtime?model=...` direct-SDP-relay
 * endpoint this route used to call is deprecated and rejects offers sent
 * to it in the new client's format.
 *
 * Endpoint/contract mirrored from the WordPress plugin's reference
 * implementation (wordpress-plugin/includes/TokenProvider/OpenAiDirectTokenProvider.php):
 * OpenAI's client_secrets endpoint requires the session config nested
 * under a top-level "session" key, and returns the ephemeral token under
 * a top-level "value" key with session metadata under "session".
 */
const OPENAI_CLIENT_SECRETS_ENDPOINT = 'https://api.openai.com/v1/realtime/client_secrets';

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return Response.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 });
  }

  let sessionConfig: unknown;
  try {
    const body = await request.json();
    sessionConfig = body?.sessionConfig;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!sessionConfig || typeof sessionConfig !== 'object') {
    return Response.json({ error: 'Missing sessionConfig' }, { status: 400 });
  }

  const response = await fetch(OPENAI_CLIENT_SECRETS_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ session: sessionConfig }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('OpenAI client_secrets error:', response.status, errorText);
    return Response.json({ error: 'Failed to mint ephemeral token' }, { status: response.status });
  }

  const data = await response.json();
  const ephemeralToken = data?.value;

  if (!ephemeralToken) {
    console.error('OpenAI client_secrets response missing `value` field:', data);
    return Response.json({ error: 'Failed to mint ephemeral token' }, { status: 502 });
  }

  const sessionId = data?.session?.id ?? null;

  return Response.json({
    data: {
      ephemeralToken,
      sessionId,
    },
  });
}
