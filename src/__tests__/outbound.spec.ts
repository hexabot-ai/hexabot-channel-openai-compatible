/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { StdOutgoingMessageEnvelope } from '@hexabot-ai/types';
import { ButtonType, FileType, OutgoingMessageType } from '@hexabot-ai/types';

import { renderEnvelopeToText } from '../outbound/index-encoder';

const ctx = {
  getAttachmentUrl: jest.fn(async () => 'https://cdn.example.com/file.png'),
};

describe('renderEnvelopeToText', () => {
  afterEach(() => jest.clearAllMocks());

  it('renders text envelopes as-is', async () => {
    const envelope: StdOutgoingMessageEnvelope = {
      type: OutgoingMessageType.text,
      data: { text: 'Hello there' },
    };

    expect(await renderEnvelopeToText(envelope, ctx)).toBe('Hello there');
  });

  it('renders quick replies as a bulleted list under the text', async () => {
    const envelope: StdOutgoingMessageEnvelope = {
      type: OutgoingMessageType.quickReply,
      data: {
        text: 'Pick one',
        quickReplies: [
          { title: 'Yes', payload: 'YES' },
          { title: 'No', payload: 'NO' },
        ],
      },
    };

    expect(await renderEnvelopeToText(envelope, ctx)).toBe(
      'Pick one\n- Yes\n- No',
    );
  });

  it('renders web_url buttons as markdown links', async () => {
    const envelope: StdOutgoingMessageEnvelope = {
      type: OutgoingMessageType.buttons,
      data: {
        text: 'Learn more',
        buttons: [
          {
            type: ButtonType.web_url,
            title: 'Docs',
            url: 'https://example.com',
          },
          { type: ButtonType.postback, title: 'Cancel', payload: 'CANCEL' },
        ],
      },
    };

    expect(await renderEnvelopeToText(envelope, ctx)).toBe(
      'Learn more\n- [Docs](https://example.com)\n- Cancel',
    );
  });

  it('renders image attachments as markdown images using the resolved public URL', async () => {
    const envelope: StdOutgoingMessageEnvelope = {
      type: OutgoingMessageType.attachment,
      data: { attachment: { type: FileType.image, payload: { id: 'abc' } } },
    };

    expect(await renderEnvelopeToText(envelope, ctx)).toBe(
      '![attachment](https://cdn.example.com/file.png)',
    );
    expect(ctx.getAttachmentUrl).toHaveBeenCalledWith({ id: 'abc' });
  });

  it('renders non-image attachments as markdown links', async () => {
    const envelope: StdOutgoingMessageEnvelope = {
      type: OutgoingMessageType.attachment,
      data: { attachment: { type: FileType.file, payload: { id: 'abc' } } },
    };

    expect(await renderEnvelopeToText(envelope, ctx)).toBe(
      '[attachment](https://cdn.example.com/file.png)',
    );
  });

  it('renders list/carousel elements as a markdown list with titles and subtitles', async () => {
    const envelope: StdOutgoingMessageEnvelope = {
      type: OutgoingMessageType.list,
      data: {
        options: { display: 'list', fields: {}, buttons: [], limit: 10 } as any,
        elements: [
          { id: '1', title: 'Item A', subtitle: 'Subtitle A' },
          { id: '2', title: 'Item B' },
        ],
        pagination: { total: 2, skip: 0, limit: 10 },
      },
    };

    expect(await renderEnvelopeToText(envelope, ctx)).toBe(
      '- **Item A** — Subtitle A\n- **Item B**',
    );
  });
});
