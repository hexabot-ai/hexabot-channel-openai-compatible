/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { FileType, OutgoingMessageType } from '@hexabot-ai/types';
import type {
  AttachmentRef,
  StdOutgoingMessageEnvelope,
} from '@hexabot-ai/types';

export interface OpenAiOutboundEncodeContext {
  getAttachmentUrl(ref: AttachmentRef): Promise<string>;
}

/**
 * Turns one Hexabot envelope into markdown text, since OpenAI replies only
 * carry plain text. Quick replies, buttons, lists, and carousels become
 * markdown so they still show up and work in clients that render it.
 */
export const renderEnvelopeToText = async (
  envelope: StdOutgoingMessageEnvelope,
  ctx: OpenAiOutboundEncodeContext,
): Promise<string> => {
  switch (envelope.type) {
    case OutgoingMessageType.text:
      return envelope.data.text;

    case OutgoingMessageType.quickReply:
      return [
        envelope.data.text,
        ...envelope.data.quickReplies.map(
          (quickReply) => `- ${quickReply.title}`,
        ),
      ].join('\n');

    case OutgoingMessageType.buttons:
      return [
        envelope.data.text,
        ...envelope.data.buttons.map((button) =>
          button.type === 'web_url' && button.url
            ? `- [${button.title}](${button.url})`
            : `- ${button.title}`,
        ),
      ].join('\n');

    case OutgoingMessageType.attachment: {
      const url = await ctx.getAttachmentUrl(envelope.data.attachment.payload);
      const isImage = envelope.data.attachment.type === FileType.image;

      return isImage ? `![attachment](${url})` : `[attachment](${url})`;
    }

    case OutgoingMessageType.list:
    case OutgoingMessageType.carousel:
      return envelope.data.elements
        .map((element) => {
          const subtitle =
            typeof element.subtitle === 'string' && element.subtitle
              ? ` — ${element.subtitle}`
              : '';

          return `- **${element.title}**${subtitle}`;
        })
        .join('\n');

    default:
      return '';
  }
};
