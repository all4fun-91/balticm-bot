const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

export function getOpenAIConfig() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  return {
    apiKey,
    model: process.env.OPENAI_MODEL || 'gpt-5.6-sol',
  };
}

export async function createResponse(body, signal) {
  const { apiKey } = getOpenAIConfig();
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${text.slice(0, 1200)}`);
  }

  return response;
}

export function getResponseText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text) {
    return payload.output_text;
  }

  const chunks = [];
  for (const item of payload?.output || []) {
    if (item?.type !== 'message') continue;
    for (const part of item?.content || []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join('');
}
