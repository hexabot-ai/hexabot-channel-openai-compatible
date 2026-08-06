/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { Response } from 'express';

import { OpenAiChannelSettings } from '../settings.schema';
import {
  OpenAiChatCompletionChunk,
  OpenAiChatCompletionResponse,
} from '../types';

import { startSseResponse } from './sse-utils';

export const buildChatCompletion = (
  text: string,
  settings: OpenAiChannelSettings,
): OpenAiChatCompletionResponse => ({
  id: `chatcmpl-${randomUUID()}`,
  object: 'chat.completion',
  created: Math.floor(Date.now() / 1000),
  model: settings.model_name,
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: text },
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: 0,
    completion_tokens: Math.ceil(text.length / 4),
    total_tokens: Math.ceil(text.length / 4),
  },
});

/** Fakes token-by-token streaming by splitting the final reply into SSE chunks. */
export const streamChatCompletion = (
  res: Response,
  text: string,
  settings: OpenAiChannelSettings,
): void => {
  startSseResponse(res);

  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const model = settings.model_name;
  const chunkSize = settings.stream_chunk_size;
  const send = (
    delta: OpenAiChatCompletionChunk['choices'][0]['delta'],
    finishReason: OpenAiChatCompletionChunk['choices'][0]['finish_reason'],
  ) => {
    const chunk: OpenAiChatCompletionChunk = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  };

  send({ role: 'assistant' }, null);
  for (let i = 0; i < text.length; i += chunkSize) {
    send({ content: text.slice(i, i + chunkSize) }, null);
  }
  send({}, 'stop');
  res.write('data: [DONE]\n\n');
  res.end();
};
