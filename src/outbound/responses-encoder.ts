/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID } from 'crypto';

import { Response } from 'express';

import { OpenAiChannelSettings } from '../settings.schema';
import {
  OpenAiResponseObject,
  OpenAiResponseOutputMessage,
  OpenAiResponseStreamEvent,
} from '../types';

import { startSseResponse } from './sse-utils';

export const buildResponsesObject = (
  text: string,
  settings: OpenAiChannelSettings,
): OpenAiResponseObject => ({
  id: `resp_${randomUUID()}`,
  object: 'response',
  created_at: Math.floor(Date.now() / 1000),
  status: 'completed',
  model: settings.model_name,
  output: [
    {
      type: 'message',
      id: `msg_${randomUUID()}`,
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text, annotations: [] }],
    },
  ],
  output_text: text,
  usage: {
    input_tokens: 0,
    output_tokens: Math.ceil(text.length / 4),
    total_tokens: Math.ceil(text.length / 4),
  },
});

/**
 * Fakes token-by-token streaming by splitting the reply into the Responses
 * API's event sequence (`response.created` → … → `response.completed`),
 * not flat delta chunks like Chat Completions.
 */
export const streamResponsesEvents = (
  res: Response,
  text: string,
  settings: OpenAiChannelSettings,
): void => {
  startSseResponse(res);

  const responseId = `resp_${randomUUID()}`;
  const itemId = `msg_${randomUUID()}`;
  const model = settings.model_name;
  const createdAt = Math.floor(Date.now() / 1000);
  const chunkSize = settings.stream_chunk_size;
  let sequenceNumber = 0;

  const send = (type: string, data: Record<string, unknown>) => {
    const event: OpenAiResponseStreamEvent = {
      type,
      sequence_number: sequenceNumber++,
      ...data,
    };
    res.write(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  const snapshot = (
    status: 'in_progress' | 'completed',
    outputText: string,
    output: OpenAiResponseObject['output'],
  ): OpenAiResponseObject => ({
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status,
    model,
    output,
    output_text: outputText,
    usage:
      status === 'completed'
        ? {
            input_tokens: 0,
            output_tokens: Math.ceil(outputText.length / 4),
            total_tokens: Math.ceil(outputText.length / 4),
          }
        : null,
  });

  send('response.created', { response: snapshot('in_progress', '', []) });
  send('response.in_progress', { response: snapshot('in_progress', '', []) });
  send('response.output_item.added', {
    output_index: 0,
    item: {
      id: itemId,
      type: 'message',
      status: 'in_progress',
      role: 'assistant',
      content: [],
    },
  });
  send('response.content_part.added', {
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text: '', annotations: [] },
  });

  for (let i = 0; i < text.length; i += chunkSize) {
    send('response.output_text.delta', {
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      delta: text.slice(i, i + chunkSize),
    });
  }

  send('response.output_text.done', {
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    text,
  });
  send('response.content_part.done', {
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text, annotations: [] },
  });

  const finalMessage: OpenAiResponseOutputMessage = {
    id: itemId,
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [{ type: 'output_text', text, annotations: [] }],
  };
  send('response.output_item.done', { output_index: 0, item: finalMessage });
  send('response.completed', {
    response: snapshot('completed', text, [finalMessage]),
  });

  res.end();
};
