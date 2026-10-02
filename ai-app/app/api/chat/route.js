import { createResponse, getOpenAIConfig } from '@/lib/openai';
import { buildInstructions } from '@/lib/prompts';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request) {
  try {
    const body = await request.json();
    const messages = normalizeMessages(body.messages);
    const { model: defaultModel } = getOpenAIConfig();

    const upstream = await createResponse(
      {
        model: body.model || defaultModel,
        instructions: buildInstructions({ projectMemory: body.projectMemory }),
        input: messages,
        stream: true,
      },
      request.signal,
    );

    if (!upstream.body) throw new Error('OpenAI returned no response stream.');

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const reader = upstream.body.getReader();

    const stream = new ReadableStream({
      async start(controller) {
        let buffer = '';
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const events = buffer.split('\n\n');
            buffer = events.pop() || '';

            for (const event of events) {
              const data = event
                .split('\n')
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trim())
                .join('\n');

              if (!data || data === '[DONE]') continue;
              let payload;
              try {
                payload = JSON.parse(data);
              } catch {
                continue;
              }

              if (payload.type === 'response.output_text.delta' && typeof payload.delta === 'string') {
                controller.enqueue(encoder.encode(payload.delta));
              }

              if (payload.type === 'error') {
                throw new Error(payload.error?.message || payload.message || 'OpenAI stream error');
              }
            }
          }
        } catch (error) {
          controller.enqueue(encoder.encode(`\n\n[Error: ${error.message}]`));
        } finally {
          controller.close();
        }
      },
      cancel() {
        reader.cancel().catch(() => {});
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => ['user', 'assistant'].includes(message?.role) && typeof message?.content === 'string')
    .slice(-60)
    .map(({ role, content }) => ({ role, content }));
}
