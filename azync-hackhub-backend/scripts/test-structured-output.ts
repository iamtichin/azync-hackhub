type Analysis = {
  summary: string;
  technologies: string[];
  innovationScore: number;
  concerns: string[];
};

const anthropicBaseUrl = (
  process.env.OMNIROUTE_ANTHROPIC_BASE_URL ??
  'https://tichin-lap.tail615d69.ts.net'
).replace(/\/v1\/?$/, '');
const openAiBaseUrl = (
  process.env.OMNIROUTE_OPENAI_BASE_URL ??
  'https://tichin-lap.tail615d69.ts.net/v1'
).replace(/\/$/, '');
const apiKey =
  process.env.OMNIROUTE_API_KEY ??
  process.env.ANTHROPIC_AUTH_TOKEN ??
  process.env.ANTHROPIC_API_KEY ??
  process.env.OPENAI_API_KEY;

const prompt = `Analyze this project and return ONLY one JSON object, without markdown.
Project: {"name":"DeFi Swap","description":"A decentralized exchange on Solana","technologies":["Next.js","Anchor","Solana"]}
Required shape: {"summary":"string","technologies":["string"],"innovationScore":1,"concerns":["string"]}`;

function validate(raw: string): Analysis {
  const value = JSON.parse(raw) as Partial<Analysis>;
  if (
    typeof value.summary !== 'string' ||
    !Array.isArray(value.technologies) ||
    !value.technologies.every((item) => typeof item === 'string') ||
    typeof value.innovationScore !== 'number' ||
    value.innovationScore < 1 ||
    value.innovationScore > 10 ||
    !Array.isArray(value.concerns) ||
    !value.concerns.every((item) => typeof item === 'string')
  ) {
    throw new Error(
      'Response JSON does not match the expected business shape.',
    );
  }
  return value as Analysis;
}

async function testAnthropic() {
  const response = await fetch(`${anthropicBaseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      authorization: `Bearer ${apiKey}`,
      'x-api-key': apiKey!,
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL ?? 'azync-analysis-v1',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const body = (await response.json()) as {
    model?: string;
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(body.error?.message ?? `HTTP ${response.status}`);
  const raw = body.content?.find((item) => item.type === 'text')?.text;
  if (!raw) throw new Error('Anthropic-compatible response has no text block.');
  return { resolvedModel: body.model ?? null, output: validate(raw) };
}

async function testOpenAi() {
  const response = await fetch(`${openAiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.AI_FALLBACK_MODEL ?? 'azync-analysis-v1',
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return valid JSON only.' },
        { role: 'user', content: prompt },
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
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(body.error?.message ?? `HTTP ${response.status}`);
  const raw = events
    .map(
      (event) =>
        event.choices?.[0]?.message?.content ??
        event.choices?.[0]?.delta?.content ??
        '',
    )
    .join('');
  if (!raw)
    throw new Error('OpenAI-compatible response has no message content.');
  return {
    resolvedModel:
      events.find((event) => typeof event.model === 'string')?.model ?? null,
    output: validate(raw),
  };
}

async function main() {
  if (!apiKey)
    throw new Error('Set OMNIROUTE_API_KEY before running this test.');
  const [anthropic, openai] = await Promise.allSettled([
    testAnthropic(),
    testOpenAi(),
  ]);
  console.log(JSON.stringify({ anthropic, openai }, null, 2));
  if (anthropic.status === 'rejected' || openai.status === 'rejected')
    process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
