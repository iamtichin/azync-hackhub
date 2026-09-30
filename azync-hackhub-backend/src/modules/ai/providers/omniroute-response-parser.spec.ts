import { AnalysisError } from '../orchestrator/analysis-error';
import { parseOmniRouteResponse } from './omniroute-response-parser';

describe('parseOmniRouteResponse', () => {
  it('parses Anthropic JSON', () => {
    expect(
      parseOmniRouteResponse(
        JSON.stringify({
          model: 'claude-sonnet-4.5',
          content: [{ type: 'text', text: '{"ok":true}' }],
          usage: { input_tokens: 12, output_tokens: 4 },
        }),
        'anthropic',
      ),
    ).toEqual({
      text: '{"ok":true}',
      resolvedModel: 'claude-sonnet-4.5',
      inputTokens: 12,
      outputTokens: 4,
    });
  });

  it('assembles unexpected OpenAI SSE frames', () => {
    const result = parseOmniRouteResponse(
      [
        'data: {"model":"resolved","choices":[{"delta":{"content":"{\\"ok\\":"}}]}',
        'data: {"choices":[{"delta":{"content":"true}"}}],"usage":{"prompt_tokens":3,"completion_tokens":2}}',
        'data: [DONE]',
      ].join('\n'),
      'openai',
    );
    expect(result).toMatchObject({
      text: '{"ok":true}',
      resolvedModel: 'resolved',
      inputTokens: 3,
      outputTokens: 2,
    });
  });

  it('rejects prose-wrapped JSON', () => {
    expect(() =>
      parseOmniRouteResponse('Here is {"ok":true}', 'anthropic'),
    ).toThrow(AnalysisError);
  });
});
