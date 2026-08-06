/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { OPENAI_CHANNEL_NAME } from './settings.schema';

declare global {
  interface SubscriberChannelDict {
    [OPENAI_CHANNEL_NAME]: {
      identity: string;
    };
  }
}

export {};
