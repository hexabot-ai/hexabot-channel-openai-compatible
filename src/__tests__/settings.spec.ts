/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  OPENAI_CHANNEL_NAME,
  OPENAI_CHANNEL_SOURCE_SETTINGS_SCHEMA,
} from '../settings.schema';

describe('OPENAI_CHANNEL_SOURCE_SETTINGS_SCHEMA', () => {
  it('has the expected channel name', () => {
    expect(OPENAI_CHANNEL_NAME).toBe('openai-compatible');
  });

  it('applies defaults for an empty settings object', () => {
    const settings = OPENAI_CHANNEL_SOURCE_SETTINGS_SCHEMA.parse({});

    expect(settings).toMatchObject({
      api_key: '',
      model_name: 'hexabot',
      api_type: 'chat/completions',
      identity_source: 'user_field',
      identity_header: 'x-session-id',
      system_prompt_mode: 'ignore',
      stream_chunk_size: 40,
      response_timeout_ms: 30000,
      thread_inactivity_hours: 24,
    });
  });

  it('rejects unknown settings keys (strict object)', () => {
    expect(() =>
      OPENAI_CHANNEL_SOURCE_SETTINGS_SCHEMA.parse({ unknown_field: true }),
    ).toThrow();
  });

  it('rejects an invalid identity_source value', () => {
    expect(() =>
      OPENAI_CHANNEL_SOURCE_SETTINGS_SCHEMA.parse({ identity_source: 'bogus' }),
    ).toThrow();
  });

  it('accepts the "responses" api type', () => {
    const settings = OPENAI_CHANNEL_SOURCE_SETTINGS_SCHEMA.parse({
      api_type: 'responses',
    });

    expect(settings.api_type).toBe('responses');
  });

  it('rejects an invalid api_type value', () => {
    expect(() =>
      OPENAI_CHANNEL_SOURCE_SETTINGS_SCHEMA.parse({ api_type: 'bogus' }),
    ).toThrow();
  });
});
