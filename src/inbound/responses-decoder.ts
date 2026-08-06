/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Request } from 'express';

import { OpenAiChannelSettings } from '../settings.schema';
import {
  extractLatestUserTextFromInput,
  extractSystemTextFromInput,
  OpenAiResponsesRequest,
  openAiResponsesRequestSchema,
} from '../types';

import { DecodedRequest, decodeInboundRequest } from './inbound-decoder.utils';

/**
 * Reads a Responses request and pulls out the latest user message (adds
 * the system prompt first, if the source is set up for that). Throws
 * `OpenAiRequestError` for anything OpenAI itself would reject: a bad
 * body, an unknown model, or no user message.
 */
export const decodeResponsesRequest = (
  req: Request,
  settings: OpenAiChannelSettings,
): DecodedRequest<OpenAiResponsesRequest> =>
  decodeInboundRequest(
    req,
    settings,
    openAiResponsesRequestSchema,
    'Invalid request body: expected an OpenAI-compatible Responses ' +
      'payload with a non-empty "input".',
    (payload) => extractLatestUserTextFromInput(payload.input),
    'No user message found in "input".',
    (payload) => extractSystemTextFromInput(payload.input),
  );
