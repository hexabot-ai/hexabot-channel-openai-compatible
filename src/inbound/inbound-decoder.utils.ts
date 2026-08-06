/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Request } from 'express';
import z from 'zod';

import { OpenAiChannelSettings } from '../settings.schema';
import {
  assertModelMatches,
  OpenAiAnyRequest,
  OpenAiRequestError,
} from '../types';

export interface DecodedRequest<T extends OpenAiAnyRequest> {
  payload: T;
  finalText: string;
}

/**
 * Shared decode pipeline used by both API styles (Chat Completions and
 * Responses). Each step mirrors what the real OpenAI API validates:
 *
 * 1. Parse `req.body` with `schema` — bad body → 400.
 * 2. Check the requested model against source settings — wrong model → 404.
 * 3. Extract the latest user text via `extractText` — no user message → 400.
 * 4. If `system_prompt_mode === 'prepend'`, prepend the system text (from
 *    `extractSystem`) to the user text, separated by a blank line.
 *
 * @param req             - Express request whose `.body` is the raw JSON payload.
 * @param settings        - Parsed source settings for this channel instance.
 * @param schema          - Zod schema to validate and parse the request body.
 * @param bodyErrorMsg    - Human-readable error sent on body parse failure.
 * @param extractText     - Pulls the latest user message text from the payload.
 * @param emptyTextMsg    - Human-readable error sent when no user text is found.
 * @param extractSystem   - Pulls concatenated system-prompt text (or `undefined`).
 */
export const decodeInboundRequest = <T extends OpenAiAnyRequest>(
  req: Request,
  settings: OpenAiChannelSettings,
  schema: z.ZodType<T>,
  bodyErrorMsg: string,
  extractText: (payload: T) => string,
  emptyTextMsg: string,
  extractSystem: (payload: T) => string | undefined,
): DecodedRequest<T> => {
  let payload: T;
  try {
    payload = schema.parse(req.body);
  } catch {
    throw new OpenAiRequestError(400, {
      error: {
        message: bodyErrorMsg,
        type: 'invalid_request_error',
        code: null,
      },
    });
  }

  assertModelMatches(payload.model, settings);

  const text = extractText(payload);
  if (!text) {
    throw new OpenAiRequestError(400, {
      error: {
        message: emptyTextMsg,
        type: 'invalid_request_error',
        code: null,
      },
    });
  }

  const finalText =
    settings.system_prompt_mode === 'prepend'
      ? [extractSystem(payload), text].filter(Boolean).join('\n\n')
      : text;

  return { payload, finalText };
};
