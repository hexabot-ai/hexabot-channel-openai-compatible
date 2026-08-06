/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { DEFAULT_MODEL_NAME, OpenAiChannelSettings } from '../settings.schema';
import { OpenAiModelsResponse } from '../types';

export const buildModelsList = ({
  model_name,
}: OpenAiChannelSettings): OpenAiModelsResponse => ({
  object: 'list',
  data: [
    {
      id: model_name === '*' ? DEFAULT_MODEL_NAME : model_name,
      object: 'model',
      created: 0,
      owned_by: DEFAULT_MODEL_NAME,
    },
  ],
});
