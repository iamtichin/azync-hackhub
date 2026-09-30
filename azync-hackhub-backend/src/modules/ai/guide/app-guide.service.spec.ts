import type {
  AIProvider,
  AIProviderResult,
} from '../providers/ai-provider.interface';
import { AzyncBotService } from './app-guide.service';
import type { AzyncBotDataService } from './azync-bot-tools';

function providerResult(text: string): AIProviderResult {
  return {
    text,
    provider: 'omniroute',
    protocol: 'anthropic',
    requestedModel: 'azync-analysis-v1',
    resolvedModel: 'guide-model',
    inputTokens: 10,
    outputTokens: 20,
    latencyMs: 30,
    costUsd: null,
    gatewayCorrelationId: null,
    gatewaySessionId: null,
    selectedConnectionId: null,
  };
}

describe('AzyncBotService', () => {
  it('selects and executes one read-only data tool before answering', async () => {
    const provider = {
      analyze: jest
        .fn()
        .mockResolvedValueOnce(
          providerResult(
            JSON.stringify({
              tool: 'GET_HACKATHON_SUMMARY',
              hackathonQuery: 'UniHackFest',
            }),
          ),
        )
        .mockResolvedValueOnce(
          providerResult(
            JSON.stringify({
              answer: 'UniHackFest currently has 3 teams and 2 submissions.',
              relatedRoutes: ['/'],
              suggestedQuestions: ['What rules does this hackathon include?'],
            }),
          ),
        ),
    } as unknown as AIProvider;
    const dataService = {
      execute: jest.fn().mockResolvedValue({
        tool: 'GET_HACKATHON_SUMMARY',
        found: true,
        hackathon: {
          name: 'UniHackFest',
          registeredTeams: 3,
          submissions: 2,
        },
      }),
    } as unknown as AzyncBotDataService;
    const service = new AzyncBotService(provider, dataService);

    await expect(
      service.ask('participant-1', 'How many teams does UniHackFest have?'),
    ).resolves.toMatchObject({
      status: 'completed',
      answer: 'UniHackFest currently has 3 teams and 2 submissions.',
    });
    expect(dataService.execute).toHaveBeenCalledWith('participant-1', {
      tool: 'GET_HACKATHON_SUMMARY',
      hackathonQuery: 'UniHackFest',
    });
    expect(provider.analyze).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        jobId: 'azync-bot-tool-participant-1',
        temperature: 0,
      }),
    );
    expect(provider.analyze).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        jobId: 'azync-bot-participant-1',
        temperature: 0.2,
        userPrompt: expect.stringContaining('live_application_data'),
      }),
    );
    const answerRequest = (provider.analyze as jest.Mock).mock.calls[1][0];
    expect(answerRequest.userPrompt).toContain('registeredTeams');
    expect(answerRequest.userPrompt).toContain(
      'Unchanged GitHub evidence may be reused',
    );
    expect(answerRequest.userPrompt).toContain(
      'does not sign the Azync credential mint',
    );
    expect(answerRequest.systemPrompt).toContain('Never include raw URL paths');
    expect(answerRequest.systemPrompt).toContain(
      "same language as the user's question",
    );
  });

  it('falls back to static UI knowledge when tool selection is invalid', async () => {
    const provider = {
      analyze: jest
        .fn()
        .mockResolvedValueOnce(providerResult('not-json'))
        .mockResolvedValueOnce(
          providerResult(
            JSON.stringify({
              answer:
                'Open Organizer, press New hackathon, complete the form, then press Create hackathon.',
              relatedRoutes: ['/organizer'],
              suggestedQuestions: ['How do I add Rules?'],
            }),
          ),
        ),
    } as unknown as AIProvider;
    const dataService = {
      execute: jest.fn(),
    } as unknown as AzyncBotDataService;
    const service = new AzyncBotService(provider, dataService);

    await expect(
      service.ask('participant-1', 'How do I create a hackathon?', [
        {
          role: 'ASSISTANT',
          content: 'I could not find relevant information for that request.',
        },
      ]),
    ).resolves.toMatchObject({
      status: 'completed',
      relatedRoutes: ['/organizer'],
    });
    expect(dataService.execute).not.toHaveBeenCalled();
    const request = (provider.analyze as jest.Mock).mock.calls[1][0];
    expect(request.userPrompt).toContain('New hackathon');
    expect(request.userPrompt).toContain(
      'I could not find relevant information for that request.',
    );
    expect(request.systemPrompt).toContain(
      'do not reuse their opening sentence',
    );
  });

  it('offers product-scoped starter questions', () => {
    const service = new AzyncBotService(
      {} as AIProvider,
      {} as AzyncBotDataService,
    );
    expect(service.suggestions().suggestions).toEqual(
      expect.arrayContaining([
        'How do I create a hackathon?',
        'How do I connect a team GitHub repository?',
      ]),
    );
  });
});
