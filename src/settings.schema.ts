/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import z from 'zod';

export const OPENAI_CHANNEL_NAME = 'openai-compatible' as const;

export const DEFAULT_MODEL_NAME = 'hexabot' as const;

const credentialSetting = (title: string, description: string) =>
  z
    .string()
    .default('')
    .meta({
      title,
      description,
      'ui:widget': 'AutoCompleteWidget',
      'ui:options': {
        entity: 'Credential',
        valueKey: 'id',
        labelKey: 'name',
        enableEntityAddButton: true,
      },
    });

export const OPENAI_CHANNEL_SOURCE_SETTINGS_SCHEMA = z
  .strictObject({
    api_key: credentialSetting(
      'API key credential',
      'Credential containing the bearer token clients must send as ' +
        '"Authorization: Bearer <token>". Leave empty to disable ' +
        'authentication (not recommended outside local development).',
    ),
    model_name: z
      .string()
      .default(DEFAULT_MODEL_NAME)
      .meta({
        title: 'Model name',
        description:
          'Model identifier reported back in responses. Set to "*" to accept ' +
          'any "model" value from incoming requests; otherwise requests for a ' +
          'different model are rejected with a 404, mirroring the OpenAI API.',
      }),
    api_type: z
      .enum(['responses', 'chat/completions'])
      .default('chat/completions')
      .meta({
        title: 'API type',
        description:
          'Which OpenAI API surface this source exposes: "Responses" ' +
          '(".../responses", request/response built around "input"/"output") ' +
          'or "Chat Completions" (".../chat/completions", request/response ' +
          'built around "messages"/"choices"). Requests sent to the other ' +
          'endpoint are rejected with a 404.',
      }),
    identity_source: z
      .enum(['user_field', 'header', 'ip'])
      .default('user_field')
      .meta({
        title: 'Conversation identity source',
        description:
          'How to derive a stable subscriber identity across requests, ' +
          'since the OpenAI Chat Completions API is otherwise stateless: ' +
          'the request\'s "user" field, a custom header, or the caller IP.',
      }),
    identity_header: z.string().default('x-session-id').meta({
      title: 'Identity header name',
      description:
        'Header read when "Conversation identity source" is set to "header".',
    }),
    system_prompt_mode: z
      .enum(['ignore', 'prepend'])
      .default('ignore')
      .meta({
        title: 'System message handling',
        description:
          'How to treat an OpenAI "system" role message: ignore it (Hexabot ' +
          'flows own the chatbot behavior) or prepend its text as context to ' +
          'the latest user message.',
      }),
    stream_chunk_size: z
      .int()
      .positive()
      .default(40)
      .meta({
        title: 'Stream chunk size (characters)',
        description:
          'When a client requests streaming, the reply is split into chunks ' +
          'of this size to emulate token-by-token streaming over SSE.',
      }),
    response_timeout_ms: z
      .int()
      .positive()
      .default(30000)
      .meta({
        title: 'Response timeout (ms)',
        description:
          'Maximum time to wait for the chatbot reply before returning a ' +
          'timeout error to the caller.',
      }),
    thread_inactivity_hours: z
      .int()
      .nonnegative()
      .default(24)
      .meta({
        title: 'Thread inactivity (hours)',
        description:
          'Automatically start a new thread when the last message is older ' +
          'than this threshold.',
      }),
  })
  .meta({
    title: 'OpenAI-Compatible Channel',
  });

export type OpenAiChannelSettings = z.infer<
  typeof OPENAI_CHANNEL_SOURCE_SETTINGS_SCHEMA
>;

export const OPENAI_CREDENTIAL_SETTING_KEYS = ['api_key'] as const;

export type OpenAiCredentialSettingKey =
  (typeof OPENAI_CREDENTIAL_SETTING_KEYS)[number];
