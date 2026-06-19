import { NextRequest } from 'next/server';

/**
 * Backend proxy for OpenAILLMAdapter (@khaveeai/providers-generic-stt-tts).
 * Keeps OPENAI_API_KEY server-side (no NEXT_PUBLIC_* exposure) and adapts
 * OpenAI's real chat.completions response shape into the flat
 * { text, tool_calls } shape OpenAILLMAdapter expects.
 */
export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response('Missing OPENAI_API_KEY', { status: 500 });
  }

  const { messages, model, temperature, tools } = await request.json();

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      ...(temperature !== undefined && { temperature }),
      ...(tools && tools.length > 0 && { tools }),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('OpenAI API error:', error);
    return new Response(error, { status: response.status });
  }

  const completion = await response.json();
  const message = completion.choices[0].message;

  return Response.json({
    text: message.content ?? undefined,
    tool_calls: message.tool_calls,
  });
}
