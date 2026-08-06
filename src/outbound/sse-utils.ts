/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Response } from 'express';

/**
 * Starts an SSE response by setting the required headers and flushing them
 * to the client immediately, so the stream connection is established before
 * any events are written.
 */
export const startSseResponse = (res: Response): void => {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
};
