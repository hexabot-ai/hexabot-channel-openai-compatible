/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import z from 'zod';

import type { OpenAiChannelSettings } from './settings.schema';

export const openAiRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);

export type OpenAiRole = z.infer<typeof openAiRoleSchema>;

const openAiContentPartSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
  })
  .catchall(z.unknown());

export const openAiMessageSchema = z.object({
  role: openAiRoleSchema,
  content: z
    .union([z.string(), z.array(openAiContentPartSchema), z.null()])
    .optional(),
  name: z.string().optional(),
});

export type OpenAiMessage = z.infer<typeof openAiMessageSchema>;

/**
 * Not strict on purpose: real OpenAI clients send extra fields (like
 * `response_format`) we must accept, not reject. `tools` is one such
 * extra field, but it's not ignored: `isOpenWebUiTaskPrompt` reads it.
 */
export const openAiChatCompletionRequestSchema = z
  .object({
    model: z.string().optional(),
    messages: z.array(openAiMessageSchema).min(1),
    stream: z.boolean().optional().default(false),
    user: z.string().optional(),
  })
  .loose();

export type OpenAiChatCompletionRequest = z.infer<
  typeof openAiChatCompletionRequestSchema
>;

/**
 * `input` can be a plain string (one user message) or a list of
 * `{role, content}` items — the same shape as Chat Completions messages,
 * so we reuse it here.
 */
export const openAiResponsesRequestSchema = z
  .object({
    model: z.string().optional(),
    input: z.union([z.string(), z.array(openAiMessageSchema)]),
    stream: z.boolean().optional().default(false),
    user: z.string().optional(),
  })
  .loose();

export type OpenAiResponsesRequest = z.infer<
  typeof openAiResponsesRequestSchema
>;

/** Either request shape this channel takes. Both have `model`, `stream`, and `user`. */
export type OpenAiAnyRequest =
  OpenAiChatCompletionRequest | OpenAiResponsesRequest;

/** Turns a message's `content` (string or parts array) into plain text. */
const flattenContent = (content: OpenAiMessage['content']): string => {
  if (!content) return '';
  if (typeof content === 'string') return content;

  return content
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n');
};

/** Returns the text of the last `user` message, or an empty string if there is none. */
export const extractLatestUserText = (messages: OpenAiMessage[]): string => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return flattenContent(messages[i].content).trim();
    }
  }

  return '';
};

/** Returns the concatenated text of every `system` message, if any. */
export const extractSystemText = (
  messages: OpenAiMessage[],
): string | undefined => {
  const text = messages
    .filter((message) => message.role === 'system')
    .map((message) => flattenContent(message.content))
    .filter(Boolean)
    .join('\n');

  return text || undefined;
};

/** Gets the last user message from a Responses `input` (or the whole string, if `input` is plain text). */
export const extractLatestUserTextFromInput = (
  input: OpenAiResponsesRequest['input'],
): string => {
  if (typeof input === 'string') return input.trim();

  return extractLatestUserText(input);
};

/** Gets all `system` text from a Responses `input`. A plain-string `input` has none. */
export const extractSystemTextFromInput = (
  input: OpenAiResponsesRequest['input'],
): string | undefined => {
  if (typeof input === 'string') return undefined;

  return extractSystemText(input);
};

export interface OpenAiErrorBody {
  error: {
    message: string;
    type: string;
    code: string | null;
  };
}

/** Thrown to stop the request early and send an OpenAI-style error. */
export class OpenAiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: OpenAiErrorBody,
  ) {
    super(body.error.message);
  }
}

/**
 * Used by both styles. Rejects a request for the wrong model, like the
 * real OpenAI API does (404). `model_name: "*"` (or no `model` field)
 * accepts any model.
 */
export const assertModelMatches = (
  model: string | undefined,
  settings: OpenAiChannelSettings,
): void => {
  if (
    settings.model_name &&
    settings.model_name !== '*' &&
    model &&
    model !== settings.model_name
  ) {
    throw new OpenAiRequestError(404, {
      error: {
        message: `The model '${model}' does not exist.`,
        type: 'invalid_request_error',
        code: 'model_not_found',
      },
    });
  }
};

export interface OpenAiModelsResponse {
  object: 'list';
  data: { id: string; object: 'model'; created: number; owned_by: string }[];
}

export interface OpenAiChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: [
    {
      index: 0;
      message: { role: 'assistant'; content: string };
      finish_reason: 'stop';
    },
  ];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAiChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: [
    {
      index: 0;
      delta: Partial<{ role: 'assistant'; content: string }>;
      finish_reason: 'stop' | null;
    },
  ];
}

export interface OpenAiResponseOutputTextContent {
  type: 'output_text';
  text: string;
  annotations: [];
}

export interface OpenAiResponseOutputMessage {
  type: 'message';
  id: string;
  status: 'in_progress' | 'completed';
  role: 'assistant';
  content: OpenAiResponseOutputTextContent[];
}

export interface OpenAiResponseObject {
  id: string;
  object: 'response';
  created_at: number;
  status: 'in_progress' | 'completed';
  model: string;
  output: OpenAiResponseOutputMessage[];
  output_text: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  } | null;
}

/**
 * One Responses API stream event. Each `type` has different extra fields,
 * so this stays loose on purpose instead of listing every shape.
 */
export interface OpenAiResponseStreamEvent extends Record<string, unknown> {
  type: string;
  sequence_number: number;
}
