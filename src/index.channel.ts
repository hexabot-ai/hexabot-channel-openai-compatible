/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { randomUUID, timingSafeEqual } from 'crypto';

import {
  ChannelCapabilities,
  ChannelInboundEvent,
  ChannelInboundEventContext,
  ChannelService,
  CredentialService,
  DEFAULT_CHANNEL_CAPABILITIES,
  HttpChannelHandler,
  MessageInboundEvent,
  SourceService,
  SubscriberCreateDto,
  SyntheticMessageInboundEvent,
} from '@hexabot-ai/api';
import type {
  ActionOptions,
  Source,
  StdOutgoingMessageEnvelope,
} from '@hexabot-ai/types';
import { IncomingMessageType } from '@hexabot-ai/types';
import { Inject, Injectable } from '@nestjs/common';
import { Request, Response } from 'express';

import {
  decodeChatCompletionsRequest,
  decodeResponsesRequest,
} from './inbound';
import {
  buildChatCompletion,
  buildModelsList,
  buildResponsesObject,
  renderEnvelopeToText,
  streamChatCompletion,
  streamResponsesEvents,
} from './outbound';
import {
  OPENAI_CHANNEL_NAME,
  OPENAI_CHANNEL_SOURCE_SETTINGS_SCHEMA,
  OpenAiChannelSettings,
} from './settings.schema';
import { OpenAiAnyRequest, OpenAiRequestError } from './types';

/** Same error shape the real OpenAI API uses for an unknown source. */
const buildOpenAiErrorBody = (sourceRef: string) => ({
  error: {
    message: `Unknown source '${sourceRef}'.`,
    type: 'invalid_request_error',
    code: 'model_not_found',
  },
});

/**
 * Lets an OpenAI-compatible client talk to a Hexabot bot like it's a model,
 * via `/api/webhook/:sourceRef/openai-compatible/<chat/completions|responses|models>`.
 * Request parsing per style lives in `inbound/*-decoder.ts`, response
 * building in `outbound/*-encoder.ts`. This file holds what both styles
 * share: auth, finding the subscriber/thread, and running the chatbot.
 *
 * Other webhook channels (Facebook, WhatsApp) ack fast and send the real
 * answer later. An OpenAI client needs the answer in the same HTTP
 * response, so `handle()` works differently: it waits for the chatbot to
 * finish, then writes the answer. This works because
 * `ChannelEventBus.emitMessage()` only resolves once the whole chatbot run
 * — including any LLM call — is done.
 */
@Injectable()
export default class OpenAiChannelHandler extends HttpChannelHandler<
  typeof OPENAI_CHANNEL_NAME
> {
  @Inject(CredentialService)
  private readonly credentialService!: CredentialService;

  @Inject(SourceService)
  private readonly sourceService!: SourceService;

  @Inject(ChannelService)
  private readonly channelService!: ChannelService;

  /** Links a request's event to the reply/replies `doSendMessage` sends for it. */
  private readonly pendingReplies = new WeakMap<
    MessageInboundEvent<typeof OPENAI_CHANNEL_NAME>,
    StdOutgoingMessageEnvelope[]
  >();

  constructor() {
    super(OPENAI_CHANNEL_NAME, OPENAI_CHANNEL_SOURCE_SETTINGS_SCHEMA);
  }

  private getSourceRef(req: Request): string {
    return typeof req.params.sourceRef === 'string' ? req.params.sourceRef : '';
  }

  private notFoundResponse(req: Request, res: Response) {
    const sourceRef = this.getSourceRef(req);
    res.status(404).json(buildOpenAiErrorBody(sourceRef));
  }

  /** Checks the request's API key, sending a 401 itself on failure. Returns whether the caller should keep going. */
  private async authorize(
    req: Request,
    res: Response,
    source: Source,
  ): Promise<boolean> {
    try {
      await this.verifySignature(req, res, source);

      return true;
    } catch {
      res.status(401).json({
        error: {
          message: 'Invalid API key provided.',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      });

      return false;
    }
  }

  /**
   * Registers the three routes this channel needs — `models`,
   * `chat/completions`, `responses` — unconditionally, for every source.
   * `decode()` rejects a request whose suffix doesn't match that specific
   * source's configured `api_type`.
   */
  private async registerOpenAiCompatibleCustomRoutes() {
    const postHandler = async (req: Request, res: Response): Promise<void> => {
      try {
        const sourceRef = this.getSourceRef(req);
        await this.channelService.handle(sourceRef, req, res);
      } catch (err) {
        this.logger.warn('Failed to handle dynamic endpoint request', err);
        if (!res.headersSent) {
          this.notFoundResponse(req, res);
        }
      }
    };
    // The models endpoint does not touch the chatbot pipeline at all — it only
    // needs the source settings to build the model list — so it is handled
    // inline here instead of going through `channelService.handle()` (which
    // would route back to `this.handle()` and trigger a full pipeline run).
    const getHandler = async (req: Request, res: Response): Promise<void> => {
      const sourceRef = this.getSourceRef(req);
      const source = await this.sourceService.findActiveByRef(sourceRef);
      if (!source) {
        this.notFoundResponse(req, res);

        return;
      }

      if (!(await this.authorize(req, res, source))) {
        return;
      }

      res
        .status(200)
        .json(buildModelsList(source.settings as OpenAiChannelSettings));
    };

    if (
      'registerCustomRoutes' in this &&
      typeof this.registerCustomRoutes === 'function'
    )
      await this.registerCustomRoutes(OPENAI_CHANNEL_NAME, async () => {
        return [
          {
            suffix: 'models',
            method: 'get',
            handler: getHandler,
          },
          {
            suffix: 'responses',
            handler: postHandler,
          },
          {
            suffix: 'chat/completions',
            handler: postHandler,
          },
        ];
      });
  }

  async onModuleInit() {
    await super.onModuleInit();
    await this.registerOpenAiCompatibleCustomRoutes();
  }

  getCapabilities(): ChannelCapabilities {
    return {
      ...DEFAULT_CHANNEL_CAPABILITIES,
      typingIndicator: false,
    };
  }

  /**
   * Main request dispatcher — overrides the base class's ack-then-async pattern
   * because an OpenAI client needs the answer in the *same* HTTP response.
   *
   * Flow:
   * 1. GET → return a simple `{ status: 'ok' }` ping (models endpoint is handled
   *    separately by the dynamic suffix route registered in `registerOpenAiCompatibleCustomRoutes`).
   * 2. POST → authenticate via `authorize()`, then `decode()` the body into an
   *    inbound event.
   * 3. If the text looks like an Open WebUI background task, short-circuit with
   *    an empty reply so it does not pollute conversation state.
   * 4. Otherwise, run the full chatbot pipeline via `channelEventBus.emitMessage()`
   *    (which only resolves once the pipeline — including any LLM call — is done),
   *    with a configurable timeout.  Outbound envelopes are collected by
   *    `doSendMessage()` into `pendingReplies` instead of being dispatched over
   *    the network.
   * 5. Render all collected envelopes to markdown text, then write the response
   *    as either a streaming SSE reply or a single JSON object, in whichever
   *    API style (`chat/completions` or `responses`) the source is configured for.
   */
  async handle(
    req: Request,
    res: Response,
    source: Source,
    workflowId?: string,
  ): Promise<void> {
    if (req.method === 'GET') {
      res.status(200).json({ status: 'ok', channel: this.getName() });

      return;
    }

    if (!(await this.authorize(req, res, source))) {
      return;
    }

    let events: ChannelInboundEvent<typeof OPENAI_CHANNEL_NAME>[];
    try {
      events = await this.decode(req, source);
    } catch (err) {
      if (err instanceof OpenAiRequestError) {
        res.status(err.status).json(err.body);
      } else {
        this.logger.warn('Failed to decode OpenAI-compatible request', err);
        res.status(400).json({
          error: {
            message: 'Bad request.',
            type: 'invalid_request_error',
            code: null,
          },
        });
      }

      return;
    }

    const event = events[0] as MessageInboundEvent<typeof OPENAI_CHANNEL_NAME>;
    const payload = event.getRaw<OpenAiAnyRequest>();
    const settings = source.settings as OpenAiChannelSettings;
    const suffix = this.resolveEndpointSuffix(req);

    event.setHandler(this);
    event.setSourceContext(source.id, source.settings);
    if (workflowId) {
      event.setWorkflowId(workflowId);
    }

    let replyText: string;

    if (this.isOpenWebUiTaskPrompt(payload, event.getText())) {
      // Not a real chat message, skip the bot and just reply empty.
      replyText = '';
    } else {
      const collector: StdOutgoingMessageEnvelope[] = [];
      this.pendingReplies.set(event, collector);

      try {
        const subscriber = await this.resolveSubscriber(event);
        event.setInitiator(subscriber);

        await this.withTimeout(
          this.channelEventBus.emitMessage(event),
          settings.response_timeout_ms,
        );
      } catch (err) {
        this.pendingReplies.delete(event);
        this.logger.error('Failed to process OpenAI-compatible request', err);
        res.status(504).json({
          error: {
            message: 'Timed out waiting for a response from the chatbot.',
            type: 'timeout_error',
            code: null,
          },
        });

        return;
      }

      const envelopes = this.pendingReplies.get(event) ?? [];
      this.pendingReplies.delete(event);

      const rendered = await Promise.all(
        envelopes.map((envelope) =>
          renderEnvelopeToText(envelope, {
            getAttachmentUrl: (ref) =>
              this.getAttachmentPublicUrl(source.id, ref),
          }),
        ),
      );
      replyText = rendered.filter(Boolean).join('\n\n') || '…';
    }

    if (suffix === 'responses') {
      if (payload.stream) {
        streamResponsesEvents(res, replyText, settings);
      } else {
        res.status(200).json(buildResponsesObject(replyText, settings));
      }

      return;
    }

    if (payload.stream) {
      streamChatCompletion(res, replyText, settings);

      return;
    }

    res.status(200).json(buildChatCompletion(replyText, settings));
  }

  /** Reads the suffix from the URL. No suffix (the plain webhook path) counts as "chat/completions". */
  private resolveEndpointSuffix(
    req: Request,
  ): OpenAiChannelSettings['api_type'] {
    return req.path.endsWith('/responses') ? 'responses' : 'chat/completions';
  }

  /**
   * Parses the incoming request into a single inbound event.
   *
   * Guards first: if the URL suffix (`/responses` or `/chat/completions`)
   * does not match the source's configured `api_type`, the request is
   * rejected with a 404 before the body is even read — mirroring how the real
   * OpenAI API responds to requests sent to the wrong endpoint path.
   *
   * Note: `resolveEndpointSuffix()` is called here independently of the call
   * in `handle()` because the base-class contract for `decode(req, source)`
   * does not allow passing extra arguments; the URL parse is cheap enough
   * that the duplication is acceptable.
   */
  protected async decode(
    req: Request,
    source: Source,
  ): Promise<ChannelInboundEvent<typeof OPENAI_CHANNEL_NAME>[]> {
    const settings = source.settings as OpenAiChannelSettings;
    const suffix = this.resolveEndpointSuffix(req);

    if (suffix !== settings.api_type) {
      throw new OpenAiRequestError(404, {
        error: {
          message:
            suffix === 'responses'
              ? 'This source does not expose the /responses endpoint.'
              : 'This source does not expose the /chat/completions endpoint.',
          type: 'invalid_request_error',
          code: null,
        },
      });
    }

    const { payload, finalText } =
      suffix === 'responses'
        ? decodeResponsesRequest(req, settings)
        : decodeChatCompletionsRequest(req, settings);

    return [this.buildEvent(req, payload, finalText, settings)];
  }

  /**
   * Wraps the decoded request body and resolved identity into a
   * `SyntheticMessageInboundEvent` that the chatbot pipeline can process.
   *
   * The same `identity` string (e.g. `"user:alice"`, `"header:sess-123"`,
   * `"ip:127.0.0.1"`) is used for two purposes:
   * - as `channelData.identity` — the per-channel subscriber key stored under
   *   `SubscriberChannelDict['openai-compatible']`, used to look up or create
   *   the subscriber on each request;
   * - as the `foreignId` passed directly to `ChannelInboundEventContext`,
   *   which `SubscriberResolver` reads to find the matching subscriber record.
   */
  private buildEvent(
    req: Request,
    payload: OpenAiAnyRequest,
    finalText: string,
    settings: OpenAiChannelSettings,
  ): SyntheticMessageInboundEvent<typeof OPENAI_CHANNEL_NAME> {
    const identity = this.resolveIdentity(req, payload, settings);

    return new SyntheticMessageInboundEvent(
      new ChannelInboundEventContext(
        this.getName(),
        payload,
        { identity },
        new Date(),
        randomUUID(),
        identity,
        null,
      ),
      { type: IncomingMessageType.text, data: { text: finalText } },
      IncomingMessageType.text,
    );
  }

  /**
   * Intercepts outbound messages during a request's chatbot pipeline run.
   *
   * Unlike every other channel's `doSendMessage()`, this implementation does
   * *not* deliver the envelope over the network.  Instead it pushes it into the
   * `pendingReplies` accumulator for the originating `handle()` call, which
   * collects all envelopes, renders them to text, and writes the final HTTP
   * response only once the full pipeline has resolved.  This is what makes the
   * hold-open-and-wait pattern work.
   */
  protected async doSendMessage(
    event: MessageInboundEvent<typeof OPENAI_CHANNEL_NAME>,
    envelope: StdOutgoingMessageEnvelope,
    _options: ActionOptions,
  ): Promise<{ mid: string }> {
    this.pendingReplies.get(event)?.push(envelope);

    return { mid: randomUUID() };
  }

  async getSubscriberData(
    event: MessageInboundEvent<typeof OPENAI_CHANNEL_NAME>,
  ): Promise<SubscriberCreateDto> {
    return {
      foreignId: event.getSenderForeignId(),
      firstName: 'API',
      lastName: 'Client',
      channel: event.getChannelData(),
      labels: [],
      assignedTo: null,
      assignedAt: null,
      lastvisit: new Date(),
      retainedFrom: new Date(),
      avatar: null,
      // The fields below are DTO-required placeholders; they carry no real
      // meaning for an API client and are never shown to end users.
      // `source` is overwritten by SubscriberResolver with the actual source
      // id regardless of what is set here.
      language: '',
      locale: '',
      timezone: 0,
      gender: 'male',
      country: '',
      source: '',
    };
  }

  /**
   * Checks the `Authorization: Bearer <token>` header against the source's
   * API key. If no API key is set, every request is let through (fine for
   * local testing only).
   */
  protected async verifySignature(
    req: Request,
    _res: Response,
    source: Source,
  ): Promise<void> {
    const settings = source.settings as OpenAiChannelSettings;
    if (!settings.api_key) {
      return;
    }

    const expected = await this.credentialService.findOneValue(
      settings.api_key,
    );
    if (!expected) {
      throw new Error('OpenAI channel API key credential is not configured');
    }

    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(
      Array.isArray(header) ? header[0] : header,
    );
    if (!match) {
      throw new Error('Missing bearer token');
    }

    const provided = Buffer.from(match[1]);
    const expectedBuffer = Buffer.from(expected);
    if (
      provided.length !== expectedBuffer.length ||
      !timingSafeEqual(provided, expectedBuffer)
    ) {
      throw new Error('Invalid bearer token');
    }
  }

  /**
   * Picks a stable id for the caller, so replies keep using the same
   * subscriber/thread. Uses the source's "Conversation identity source"
   * setting to decide how:
   * - `user_field` — uses the `user` field from the request body.
   * - `header` — reads the header named by `identity_header`.
   * - `ip` — uses the caller's IP address.
   *
   * Falls back to `ip:` identity in three cases: `identity_source` is
   * `'ip'`; it's `'header'` but the configured header is absent from the
   * request; or it's `'user_field'` but the request has no `user` field.
   * A misconfigured `identity_header`/missing `user` therefore silently
   * merges all callers from the same IP into one subscriber — no warning
   * is logged for this today.
   */
  private resolveIdentity(
    req: Request,
    payload: OpenAiAnyRequest,
    settings: OpenAiChannelSettings,
  ): string {
    if (settings.identity_source === 'header') {
      const header = req.headers[settings.identity_header.toLowerCase()];
      const value = Array.isArray(header) ? header[0] : header;
      if (value) return `header:${value}`;
    } else if (settings.identity_source === 'user_field' && payload.user) {
      return `user:${payload.user}`;
    }

    return `ip:${req.ip ?? 'unknown'}`;
  }

  /** True if this is an Open WebUI background task (title, tags, follow-ups), not a real chat message. */
  private isOpenWebUiTaskPrompt(
    payload: OpenAiAnyRequest,
    text: string,
  ): boolean {
    return !Array.isArray(payload.tools) && /^\s*###\s*Task:/i.test(text);
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Chatbot response timed out')),
        ms,
      );
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }
}
