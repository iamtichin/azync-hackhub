import type { OmniRouteProtocol } from '../constants/ai.constants';
import { AnalysisError } from '../orchestrator/analysis-error';

export interface ParsedOmniRouteResponse {
  text: string;
  resolvedModel: string;
  inputTokens: number;
  outputTokens: number;
}

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function nestedObject(object: JsonObject, key: string): JsonObject | null {
  return objectValue(object[key]);
}

function stringValue(object: JsonObject | null, key: string): string {
  const value = object?.[key];
  return typeof value === 'string' ? value : '';
}

function numberValue(object: JsonObject | null, key: string): number {
  const value = object?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseJson(value: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(value);
    const object = objectValue(parsed);
    if (!object) {
      throw new Error('Response is not a JSON object');
    }
    return object;
  } catch (error) {
    throw new AnalysisError(
      'INVALID_AI_OUTPUT',
      'OmniRoute returned malformed JSON',
      true,
      true,
      { cause: error },
    );
  }
}

function parseSse(body: string): JsonObject[] {
  const frames: JsonObject[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    frames.push(parseJson(data));
  }
  if (frames.length === 0) {
    throw new AnalysisError(
      'INVALID_AI_OUTPUT',
      'OmniRoute returned an empty SSE response',
      true,
      true,
    );
  }
  return frames;
}

function anthropicResponse(frames: JsonObject[]): ParsedOmniRouteResponse {
  const texts: string[] = [];
  let model = '';
  let inputTokens = 0;
  let outputTokens = 0;

  for (const frame of frames) {
    const message = nestedObject(frame, 'message');
    const usage = nestedObject(frame, 'usage');
    const messageUsage = message ? nestedObject(message, 'usage') : null;
    model ||= stringValue(frame, 'model') || stringValue(message, 'model');
    inputTokens ||=
      numberValue(usage, 'input_tokens') ||
      numberValue(messageUsage, 'input_tokens');
    outputTokens = numberValue(usage, 'output_tokens') || outputTokens;

    if (Array.isArray(frame.content)) {
      for (const block of frame.content) {
        const content = objectValue(block);
        if (stringValue(content, 'type') === 'text') {
          const text = stringValue(content, 'text');
          if (text) texts.push(text);
        }
      }
    }
    const delta = nestedObject(frame, 'delta');
    if (
      stringValue(frame, 'type') === 'content_block_delta' &&
      stringValue(delta, 'text')
    ) {
      texts.push(stringValue(delta, 'text'));
    }
  }

  return {
    text: texts.join(''),
    resolvedModel: model,
    inputTokens,
    outputTokens,
  };
}

function openAiResponse(frames: JsonObject[]): ParsedOmniRouteResponse {
  const texts: string[] = [];
  let model = '';
  let inputTokens = 0;
  let outputTokens = 0;

  for (const frame of frames) {
    model ||= stringValue(frame, 'model');
    const usage = nestedObject(frame, 'usage');
    inputTokens = numberValue(usage, 'prompt_tokens') || inputTokens;
    outputTokens = numberValue(usage, 'completion_tokens') || outputTokens;
    const choices = frame.choices;
    const choice = Array.isArray(choices) ? objectValue(choices[0]) : null;
    const message = choice ? nestedObject(choice, 'message') : null;
    const delta = choice ? nestedObject(choice, 'delta') : null;
    const text =
      stringValue(message, 'content') || stringValue(delta, 'content');
    if (text) texts.push(text);
  }

  return {
    text: texts.join(''),
    resolvedModel: model,
    inputTokens,
    outputTokens,
  };
}

export function parseOmniRouteResponse(
  body: string,
  protocol: OmniRouteProtocol,
): ParsedOmniRouteResponse {
  const trimmed = body.trim();
  const frames = trimmed.startsWith('data:')
    ? parseSse(trimmed)
    : [parseJson(trimmed)];
  const parsed =
    protocol === 'anthropic'
      ? anthropicResponse(frames)
      : openAiResponse(frames);

  if (!parsed.text.trim()) {
    throw new AnalysisError(
      'INVALID_AI_OUTPUT',
      'OmniRoute response did not contain assistant text',
      true,
      true,
    );
  }
  return parsed;
}
