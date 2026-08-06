/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Source, StdOutgoingMessageEnvelope } from '@hexabot-ai/types';
import { OutgoingMessageType } from '@hexabot-ai/types';
import type { Request, Response } from 'express';

import OpenAiChannelHandler from '../index.channel';
import {
  OPENAI_CHANNEL_NAME,
  OPENAI_CHANNEL_SOURCE_SETTINGS_SCHEMA,
  OpenAiChannelSettings,
} from '../settings.schema';
import { OpenAiRequestError } from '../types';

type MockRes = Response & {
  statusCode?: number;
  body?: unknown;
  headersSent: boolean;
  write: jest.Mock;
  end: jest.Mock;
  setHeader: jest.Mock;
};

const createRes = (): MockRes => {
  const res = {
    headersSent: false,
  } as MockRes;
  res.status = jest.fn((code: number) => {
    res.statusCode = code;

    return res;
  }) as unknown as MockRes['status'];
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    res.headersSent = true;

    return res;
  }) as unknown as MockRes['json'];
  res.setHeader = jest.fn();
  res.flushHeaders = jest.fn();
  res.write = jest.fn();
  res.end = jest.fn();

  return res;
};
const createReq = (
  overrides: Partial<Request> & Record<string, unknown> = {},
): Request =>
  ({
    method: 'POST',
    path: '/api/webhook/source-1/openai-compatible/chat/completions',
    headers: {},
    body: { model: 'hexabot', messages: [{ role: 'user', content: 'Hello' }] },
    params: { sourceRef: 'source-1' },
    ip: '127.0.0.1',
    ...overrides,
  }) as unknown as Request;
const createSource = (
  settingsOverrides: Partial<OpenAiChannelSettings> = {},
): Source =>
  ({
    id: 'source-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    name: 'openai-compatible-source',
    channel: OPENAI_CHANNEL_NAME,
    settings: OPENAI_CHANNEL_SOURCE_SETTINGS_SCHEMA.parse(settingsOverrides),
    state: true,
    defaultWorkflow: null,
  }) as unknown as Source;
const createHandler = () => {
  const handler = new OpenAiChannelHandler();
  const credentialService = { findOneValue: jest.fn() };
  const sourceService = { findActiveByRef: jest.fn() };
  const channelService = { handle: jest.fn() };
  const channelEventBus = { emitMessage: jest.fn() };
  const logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };

  Object.assign(handler as unknown as Record<string, unknown>, {
    credentialService,
    sourceService,
    channelService,
    channelEventBus,
    logger,
  });
  (handler as unknown as { resolveSubscriber: jest.Mock }).resolveSubscriber =
    jest.fn(async () => ({ id: 'subscriber-1' }));
  (
    handler as unknown as { getAttachmentPublicUrl: jest.Mock }
  ).getAttachmentPublicUrl = jest.fn(
    async () => 'https://cdn.example.com/file',
  );

  return {
    handler,
    credentialService,
    sourceService,
    channelService,
    channelEventBus,
  };
};

describe('OpenAiChannelHandler', () => {
  describe('verifySignature', () => {
    it('lets every request through when no api_key is configured', async () => {
      const { handler } = createHandler();
      const source = createSource();

      await expect(
        (handler as any).verifySignature(createReq(), createRes(), source),
      ).resolves.toBeUndefined();
    });

    it('throws when the configured credential cannot be found', async () => {
      const { handler, credentialService } = createHandler();
      credentialService.findOneValue.mockResolvedValue(undefined);
      const source = createSource({ api_key: 'cred-id' });

      await expect(
        (handler as any).verifySignature(createReq(), createRes(), source),
      ).rejects.toThrow('OpenAI channel API key credential is not configured');
    });

    it('throws when the Authorization header is missing', async () => {
      const { handler, credentialService } = createHandler();
      credentialService.findOneValue.mockResolvedValue('secret-token');
      const source = createSource({ api_key: 'cred-id' });

      await expect(
        (handler as any).verifySignature(createReq(), createRes(), source),
      ).rejects.toThrow('Missing bearer token');
    });

    it('throws when the bearer token does not match', async () => {
      const { handler, credentialService } = createHandler();
      credentialService.findOneValue.mockResolvedValue('secret-token');
      const source = createSource({ api_key: 'cred-id' });
      const req = createReq({ headers: { authorization: 'Bearer wrong' } });

      await expect(
        (handler as any).verifySignature(req, createRes(), source),
      ).rejects.toThrow('Invalid bearer token');
    });

    it('resolves when the bearer token matches', async () => {
      const { handler, credentialService } = createHandler();
      credentialService.findOneValue.mockResolvedValue('secret-token');
      const source = createSource({ api_key: 'cred-id' });
      const req = createReq({
        headers: { authorization: 'Bearer secret-token' },
      });

      await expect(
        (handler as any).verifySignature(req, createRes(), source),
      ).resolves.toBeUndefined();
    });
  });

  describe('authorize', () => {
    it('returns true and touches the response only on success', async () => {
      const { handler } = createHandler();
      const source = createSource();
      const res = createRes();
      const ok = await (handler as any).authorize(createReq(), res, source);

      expect(ok).toBe(true);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('writes a 401 and returns false on failure', async () => {
      const { handler, credentialService } = createHandler();
      credentialService.findOneValue.mockResolvedValue('secret-token');
      const source = createSource({ api_key: 'cred-id' });
      const res = createRes();
      const ok = await (handler as any).authorize(createReq(), res, source);

      expect(ok).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body).toMatchObject({
        error: { code: 'invalid_api_key' },
      });
    });
  });

  describe('resolveIdentity', () => {
    it('uses the header value when identity_source is "header"', () => {
      const { handler } = createHandler();
      const source = createSource({
        identity_source: 'header',
        identity_header: 'x-session-id',
      });
      const req = createReq({ headers: { 'x-session-id': 'abc123' } });
      const identity = (handler as any).resolveIdentity(
        req,
        {},
        source.settings,
      );

      expect(identity).toBe('header:abc123');
    });

    it('falls back to ip when the configured header is absent', () => {
      const { handler } = createHandler();
      const source = createSource({ identity_source: 'header' });
      const req = createReq({ headers: {}, ip: '10.0.0.1' });
      const identity = (handler as any).resolveIdentity(
        req,
        {},
        source.settings,
      );

      expect(identity).toBe('ip:10.0.0.1');
    });

    it('uses the "user" field when identity_source is "user_field"', () => {
      const { handler } = createHandler();
      const source = createSource({ identity_source: 'user_field' });
      const identity = (handler as any).resolveIdentity(
        createReq(),
        { user: 'alice' },
        source.settings,
      );

      expect(identity).toBe('user:alice');
    });

    it('falls back to ip when "user_field" is picked but no user is sent', () => {
      const { handler } = createHandler();
      const source = createSource({ identity_source: 'user_field' });
      const req = createReq({ ip: '10.0.0.2' });
      const identity = (handler as any).resolveIdentity(
        req,
        {},
        source.settings,
      );

      expect(identity).toBe('ip:10.0.0.2');
    });

    it('uses ip directly when identity_source is "ip"', () => {
      const { handler } = createHandler();
      const source = createSource({ identity_source: 'ip' });
      const req = createReq({ ip: '10.0.0.3' });
      const identity = (handler as any).resolveIdentity(
        req,
        { user: 'alice' },
        source.settings,
      );

      expect(identity).toBe('ip:10.0.0.3');
    });
  });

  describe('isOpenWebUiTaskPrompt', () => {
    it('detects an Open WebUI task prompt with no tools array', () => {
      const { handler } = createHandler();

      expect(
        (handler as any).isOpenWebUiTaskPrompt(
          {},
          '### Task:\nGenerate a title',
        ),
      ).toBe(true);
    });

    it('tolerates leading whitespace before the marker', () => {
      const { handler } = createHandler();

      expect(
        (handler as any).isOpenWebUiTaskPrompt(
          {},
          '   ### Task:\nSuggest follow-ups',
        ),
      ).toBe(true);
    });

    it('is false for a real chat message', () => {
      const { handler } = createHandler();

      expect((handler as any).isOpenWebUiTaskPrompt({}, 'Hello there')).toBe(
        false,
      );
    });

    it('is false when a tools array is present, even with a matching prompt', () => {
      const { handler } = createHandler();

      expect(
        (handler as any).isOpenWebUiTaskPrompt(
          { tools: [{ type: 'function' }] },
          '### Task:\nGenerate a title',
        ),
      ).toBe(false);
    });
  });

  describe('resolveEndpointSuffix', () => {
    it('returns "responses" for a /responses path', () => {
      const { handler } = createHandler();
      const req = createReq({
        path: '/api/webhook/source-1/openai-compatible/responses',
      });

      expect((handler as any).resolveEndpointSuffix(req)).toBe('responses');
    });

    it('returns "chat/completions" for a /chat/completions path', () => {
      const { handler } = createHandler();

      expect((handler as any).resolveEndpointSuffix(createReq())).toBe(
        'chat/completions',
      );
    });

    it('returns "chat/completions" for the bare webhook path', () => {
      const { handler } = createHandler();
      const req = createReq({ path: '/api/webhook/source-1' });

      expect((handler as any).resolveEndpointSuffix(req)).toBe(
        'chat/completions',
      );
    });
  });

  describe('decode', () => {
    it('rejects a request whose suffix does not match the configured api_type', async () => {
      const { handler } = createHandler();
      const source = createSource({ api_type: 'chat/completions' });
      const req = createReq({
        path: '/api/webhook/source-1/openai-compatible/responses',
        body: { model: 'hexabot', input: 'Hello' },
      });

      await expect((handler as any).decode(req, source)).rejects.toThrow(
        OpenAiRequestError,
      );
      await expect((handler as any).decode(req, source)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('decodes a valid chat/completions request into one event', async () => {
      const { handler } = createHandler();
      const source = createSource();
      const req = createReq({
        body: {
          model: 'hexabot',
          messages: [{ role: 'user', content: 'Hi there' }],
        },
      });
      const events = await (handler as any).decode(req, source);

      expect(events).toHaveLength(1);
      expect(events[0].getText()).toBe('Hi there');
    });

    it('decodes a valid responses request into one event', async () => {
      const { handler } = createHandler();
      const source = createSource({ api_type: 'responses' });
      const req = createReq({
        path: '/api/webhook/source-1/openai-compatible/responses',
        body: { model: 'hexabot', input: 'Hi there' },
      });
      const events = await (handler as any).decode(req, source);

      expect(events).toHaveLength(1);
      expect(events[0].getText()).toBe('Hi there');
    });

    it('propagates the decoder error for an invalid body', async () => {
      const { handler } = createHandler();
      const source = createSource();
      const req = createReq({ body: { model: 'hexabot', messages: [] } });

      await expect((handler as any).decode(req, source)).rejects.toThrow(
        OpenAiRequestError,
      );
    });
  });

  describe('getSubscriberData', () => {
    it('maps the event to a subscriber DTO', async () => {
      const { handler } = createHandler();
      const source = createSource();
      const [event] = await (handler as any).decode(createReq(), source);
      const dto = await handler.getSubscriberData(event);

      expect(dto).toMatchObject({
        firstName: 'API',
        lastName: 'Client',
        foreignId: event.getSenderForeignId(),
      });
    });
  });

  describe('doSendMessage', () => {
    it('pushes the envelope into pendingReplies for a tracked event', async () => {
      const { handler } = createHandler();
      const source = createSource();
      const [event] = await (handler as any).decode(createReq(), source);
      const collector: StdOutgoingMessageEnvelope[] = [];
      (handler as any).pendingReplies.set(event, collector);
      const envelope: StdOutgoingMessageEnvelope = {
        type: OutgoingMessageType.text,
        data: { text: 'hi' },
      };
      const result = await (handler as any).doSendMessage(event, envelope, {});

      expect(collector).toEqual([envelope]);
      expect(result.mid).toEqual(expect.any(String));
    });

    it('does nothing for an event that was never tracked', async () => {
      const { handler } = createHandler();
      const source = createSource();
      const [event] = await (handler as any).decode(createReq(), source);
      const envelope: StdOutgoingMessageEnvelope = {
        type: OutgoingMessageType.text,
        data: { text: 'hi' },
      };

      await expect(
        (handler as any).doSendMessage(event, envelope, {}),
      ).resolves.toEqual({ mid: expect.any(String) });
    });
  });

  describe('handle', () => {
    it('responds to a GET request with a status ping, without checking auth', async () => {
      const { handler, credentialService } = createHandler();
      const source = createSource({ api_key: 'cred-id' });
      const res = createRes();

      await handler.handle(createReq({ method: 'GET' }), res, source);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ status: 'ok', channel: OPENAI_CHANNEL_NAME });
      expect(credentialService.findOneValue).not.toHaveBeenCalled();
    });

    it('rejects a POST with an invalid bearer token before running the pipeline', async () => {
      const { handler, credentialService, channelEventBus } = createHandler();
      credentialService.findOneValue.mockResolvedValue('correct-token');
      const source = createSource({ api_key: 'cred-id' });
      const req = createReq({
        headers: { authorization: 'Bearer wrong-token' },
      });
      const res = createRes();

      await handler.handle(req, res, source);

      expect(res.statusCode).toBe(401);
      expect(channelEventBus.emitMessage).not.toHaveBeenCalled();
    });

    it('rejects a malformed body with 400', async () => {
      const { handler } = createHandler();
      const source = createSource();
      const req = createReq({ body: { model: 'hexabot', messages: [] } });
      const res = createRes();

      await handler.handle(req, res, source);

      expect(res.statusCode).toBe(400);
    });

    it('rejects a request whose suffix does not match the configured api_type', async () => {
      const { handler } = createHandler();
      const source = createSource({ api_type: 'chat/completions' });
      const req = createReq({
        path: '/api/webhook/source-1/openai-compatible/responses',
        body: { model: 'hexabot', input: 'hi' },
      });
      const res = createRes();

      await handler.handle(req, res, source);

      expect(res.statusCode).toBe(404);
      expect(res.body).toMatchObject({
        error: {
          message: 'This source does not expose the /responses endpoint.',
        },
      });
    });

    it('replies with empty content for an Open WebUI task prompt, without running the pipeline', async () => {
      const { handler, channelEventBus } = createHandler();
      const source = createSource();
      const req = createReq({
        body: {
          model: 'hexabot',
          messages: [{ role: 'user', content: '### Task:\nGenerate a title' }],
        },
      });
      const res = createRes();

      await handler.handle(req, res, source);

      expect(res.statusCode).toBe(200);
      expect((res.body as any).choices[0].message.content).toBe('');
      expect(channelEventBus.emitMessage).not.toHaveBeenCalled();
    });

    it('returns the rendered reply for a real chat/completions request', async () => {
      const { handler, channelEventBus } = createHandler();
      channelEventBus.emitMessage.mockImplementation(async (event: any) => {
        (handler as any).pendingReplies.get(event)?.push({
          type: OutgoingMessageType.text,
          data: { text: 'Hello back!' },
        });
      });
      const source = createSource();
      const res = createRes();

      await handler.handle(createReq(), res, source);

      expect(res.statusCode).toBe(200);
      expect((res.body as any).choices[0].message.content).toBe('Hello back!');
      expect((res.body as any).model).toBe('hexabot');
    });

    it('returns a Responses-shaped reply when api_type is "responses"', async () => {
      const { handler, channelEventBus } = createHandler();
      channelEventBus.emitMessage.mockImplementation(async (event: any) => {
        (handler as any).pendingReplies.get(event)?.push({
          type: OutgoingMessageType.text,
          data: { text: 'Hi!' },
        });
      });
      const source = createSource({ api_type: 'responses' });
      const req = createReq({
        path: '/api/webhook/source-1/openai-compatible/responses',
        body: { model: 'hexabot', input: 'Hello' },
      });
      const res = createRes();

      await handler.handle(req, res, source);

      expect(res.statusCode).toBe(200);
      expect((res.body as any).output_text).toBe('Hi!');
    });

    it('streams an SSE response when stream is true', async () => {
      const { handler, channelEventBus } = createHandler();
      channelEventBus.emitMessage.mockImplementation(async (event: any) => {
        (handler as any).pendingReplies.get(event)?.push({
          type: OutgoingMessageType.text,
          data: { text: 'Streamed reply' },
        });
      });
      const source = createSource();
      const req = createReq({
        body: {
          model: 'hexabot',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true,
        },
      });
      const res = createRes();

      await handler.handle(req, res, source);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/event-stream',
      );
      const written = res.write.mock.calls.map((call) => call[0]).join('');
      expect(written).toContain('Streamed reply');
      expect(written).toContain('[DONE]');
    });

    it('returns 504 when the chatbot pipeline exceeds the configured timeout', async () => {
      const { handler, channelEventBus } = createHandler();
      channelEventBus.emitMessage.mockImplementation(
        () => new Promise(() => {}),
      );
      const source = createSource({ response_timeout_ms: 10 });
      const res = createRes();

      await handler.handle(createReq(), res, source);

      expect(res.statusCode).toBe(504);
      expect(res.body).toMatchObject({ error: { type: 'timeout_error' } });
    });
  });
});
