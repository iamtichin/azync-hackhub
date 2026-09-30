const baseUrl = (
  process.env.OMNIROUTE_ANTHROPIC_BASE_URL ??
  'https://tichin-lap.tail615d69.ts.net'
).replace(/\/v1\/?$/, '');

const apiKey =
  process.env.OMNIROUTE_API_KEY ??
  process.env.ANTHROPIC_AUTH_TOKEN ??
  process.env.ANTHROPIC_API_KEY;
const requestedModel = process.env.AI_MODEL ?? 'azync-analysis-v1';

async function main() {
  if (!apiKey) {
    throw new Error(
      'Set OMNIROUTE_API_KEY (or ANTHROPIC_AUTH_TOKEN/ANTHROPIC_API_KEY) before running this test.',
    );
  }

  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      authorization: `Bearer ${apiKey}`,
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model: requestedModel,
      max_tokens: 32,
      messages: [
        { role: 'user', content: 'Reply exactly: API test successful' },
      ],
    }),
  });

  const body = (await response.json()) as {
    model?: string;
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
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
        protocol: 'anthropic-messages',
        requestedModel,
        resolvedModel: body.model ?? null,
        latencyMs: Date.now() - startedAt,
        usage: body.usage ?? null,
        text: body.content?.find((item) => item.type === 'text')?.text ?? null,
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
