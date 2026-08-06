/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Request } from 'express';

import { OpenAiChannelSettings } from '../settings.schema';
import {
  extractLatestUserText,
  extractSystemText,
  OpenAiChatCompletionRequest,
  openAiChatCompletionRequestSchema,
} from '../types';

import { DecodedRequest, decodeInboundRequest } from './inbound-decoder.utils';

/**
 * Reads a Chat Completions request and pulls out the latest user message
 * (adds the system prompt first, if the source is set up for that). Throws
 * `OpenAiRequestError` for anything OpenAI itself would reject: a bad
 * body, an unknown model, or no user message.
 */
export const decodeChatCompletionsRequest = (
  req: Request,
  settings: OpenAiChannelSettings,
): DecodedRequest<OpenAiChatCompletionRequest> =>
  decodeInboundRequest(
    req,
    settings,
    openAiChatCompletionRequestSchema,
    'Invalid request body: expected an OpenAI-compatible chat ' +
      'completion payload with a non-empty "messages" array.',
    (payload) => extractLatestUserText(payload.messages),
    'No user message found in "messages".',
    (payload) => extractSystemText(payload.messages),
  );
