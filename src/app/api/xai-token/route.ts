import { NextRequest } from "next/server";

/**
 * Mints an xAI Realtime ephemeral token server-to-server.
 * The XAI_API_KEY stays server-side; the browser receives a short-lived token.
 * Returns { ephemeralToken } matching what XAIRealtimeProvider.fetchEphemeralToken expects.
 */
export async function POST(_request: NextRequest) {
  const apiKey = process.env.XAI_API_KEY;

  if (!apiKey) {
    return new Response("Missing XAI_API_KEY", { status: 500 });
  }

  const response = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("xAI token mint failed:", response.status, errorText);
    const status =
      response.status >= 400 && response.status < 600
        ? response.status
        : 502;
    return new Response("Failed to mint xAI session token", { status });
  }

  const body = await response.json();
  const ephemeralToken = body?.value;

  if (!ephemeralToken) {
    console.error(
      "xAI token mint: 2xx response missing `value` field",
      body,
    );
    return new Response("Failed to mint xAI session token", { status: 502 });
  }

  return Response.json({ ephemeralToken });
}
