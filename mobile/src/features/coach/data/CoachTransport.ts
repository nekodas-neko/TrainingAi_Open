import { DefaultChatTransport, type UIMessage, type UIMessageChunk } from 'ai';

export class CoachTransport extends DefaultChatTransport<UIMessage> {
  async sendMessages(options: Parameters<DefaultChatTransport<UIMessage>['sendMessages']>[0]) {
    const stream = await super.sendMessages(options);
    const last = options.messages.at(-1);
    if (last?.role !== 'assistant') return stream;
    // A tool answer continues the existing assistant turn, even if the server mints a new ID.
    return stream.pipeThrough(
      new TransformStream<UIMessageChunk, UIMessageChunk>({
        transform(part, controller) {
          controller.enqueue(part.type === 'start' ? { ...part, messageId: last.id } : part);
        },
      }),
    );
  }
}
