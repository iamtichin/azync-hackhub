const baseUrl = (
  process.env.OMNIROUTE_OPENAI_BASE_URL ??
  'https://tichin-lap.tail615d69.ts.net/v1'
).replace(/\/$/, '');

const apiKey = process.env.OMNIROUTE_API_KEY ?? process.env.OPENAI_API_KEY;
const requestedModel = process.env.AI_FALLBACK_MODEL ?? 'azync-analysis-v1';

async function main() {
  if (!apiKey) {
    throw new Error(
      'Set OMNIROUTE_API_KEY (or OPENAI_API_KEY) before running this test.',
    );
  }

  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: requestedModel,
      max_tokens: 32,
      messages: [
        { role: 'user', content: 'Reply exactly: API test successful' },
      ],
    }),
  });

  const rawBody = await response.text();
  const events = rawBody.startsWith('data:')
    ? rawBody
        .split(/\r?\n/)
        .filter(
          (line) =>
            line.startsWith('data:') && line.slice(5).trim() !== '[DONE]',
        )
        .map((line) => JSON.parse(line.slice(5).trim()))
    : [JSON.parse(rawBody)];
  const body = events.at(-1) as {
    model?: string;
    choices?: Array<{
      message?: { content?: string };
      delta?: { content?: string };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${body.error?.message ?? 'Unknown error'}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        success: true,
        protocol: 'openai-chat-completions',
        requestedModel,
        resolvedModel:
          events.find((event) => typeof event.model === 'string')?.model ??
          null,
        latencyMs: Date.now() - startedAt,
        usage: body.usage ?? null,
        text:
          events
            .map(
              (event) =>
                event.choices?.[0]?.message?.content ??
                event.choices?.[0]?.delta?.content ??
                '',
            )
            .join('') || null,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
