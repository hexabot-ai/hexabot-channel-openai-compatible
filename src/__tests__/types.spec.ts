/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  extractLatestUserText,
  extractLatestUserTextFromInput,
  extractSystemText,
  extractSystemTextFromInput,
  openAiChatCompletionRequestSchema,
  OpenAiRequestError,
  openAiResponsesRequestSchema,
} from '../types';

describe('openAiChatCompletionRequestSchema', () => {
  it('accepts a minimal valid request', () => {
    const parsed = openAiChatCompletionRequestSchema.parse({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(parsed.stream).toBe(false);
  });

  it('tolerates unknown OpenAI parameters (tools, temperature, …)', () => {
    const parsed = openAiChatCompletionRequestSchema.parse({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.7,
      tools: [{ type: 'function' }],
    });

    expect(parsed.model).toBe('gpt-4o');
  });

  it('rejects an empty messages array', () => {
    expect(() =>
      openAiChatCompletionRequestSchema.parse({ messages: [] }),
    ).toThrow();
  });
});

describe('extractLatestUserText', () => {
  it('returns the last user message text', () => {
    const text = extractLatestUserText([
      { role: 'system', content: 'You are a bot.' },
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Second question' },
    ]);

    expect(text).toBe('Second question');
  });

  it('flattens content-part arrays', () => {
    const text = extractLatestUserText([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Part one' },
          { type: 'text', text: 'Part two' },
        ],
      },
    ]);

    expect(text).toBe('Part one\nPart two');
  });

  it('returns an empty string when there is no user message', () => {
    expect(extractLatestUserText([{ role: 'assistant', content: 'Hi' }])).toBe(
      '',
    );
  });
});

describe('extractSystemText', () => {
  it('concatenates all system messages', () => {
    expect(
      extractSystemText([
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Hello' },
        { role: 'system', content: 'Reply in French.' },
      ]),
    ).toBe('Be concise.\nReply in French.');
  });

  it('returns undefined when there is no system message', () => {
    expect(
      extractSystemText([{ role: 'user', content: 'Hello' }]),
    ).toBeUndefined();
  });
});

describe('openAiResponsesRequestSchema', () => {
  it('accepts a plain-string input', () => {
    const parsed = openAiResponsesRequestSchema.parse({ input: 'Hello' });

    expect(parsed.input).toBe('Hello');
    expect(parsed.stream).toBe(false);
  });

  it('accepts an array-of-items input', () => {
    const parsed = openAiResponsesRequestSchema.parse({
      input: [{ role: 'user', content: 'Hello' }],
    });

    expect(parsed.input).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('tolerates unknown OpenAI parameters', () => {
    const parsed = openAiResponsesRequestSchema.parse({
      model: 'gpt-4.1',
      input: 'Hello',
      reasoning: { effort: 'low' },
    });

    expect(parsed.model).toBe('gpt-4.1');
  });

  it('rejects a request with no input', () => {
    expect(() => openAiResponsesRequestSchema.parse({})).toThrow();
  });
});

describe('extractLatestUserTextFromInput', () => {
  it('treats a plain string input as the whole user message', () => {
    expect(extractLatestUserTextFromInput('  Hello there  ')).toBe(
      'Hello there',
    );
  });

  it('returns the last user item text for array input', () => {
    const text = extractLatestUserTextFromInput([
      { role: 'system', content: 'You are a bot.' },
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Second question' },
    ]);

    expect(text).toBe('Second question');
  });

  it('returns an empty string when the array has no user item', () => {
    expect(
      extractLatestUserTextFromInput([{ role: 'assistant', content: 'Hi' }]),
    ).toBe('');
  });
});

describe('extractSystemTextFromInput', () => {
  it('returns undefined for a plain string input', () => {
    expect(extractSystemTextFromInput('Hello')).toBeUndefined();
  });

  it('concatenates system items in array input', () => {
    expect(
      extractSystemTextFromInput([
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Hello' },
        { role: 'system', content: 'Reply in French.' },
      ]),
    ).toBe('Be concise.\nReply in French.');
  });
});

describe('OpenAiRequestError', () => {
  it('carries the HTTP status and OpenAI-shaped error body', () => {
    const err = new OpenAiRequestError(404, {
      error: {
        message: 'not found',
        type: 'invalid_request_error',
        code: null,
      },
    });

    expect(err.status).toBe(404);
    expect(err.body.error.message).toBe('not found');
  });
});
