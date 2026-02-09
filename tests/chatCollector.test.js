const path = require('path');
require(path.resolve(__dirname, '..', 'tests', 'setup.js'));

jest.mock('../functions/chatFunctions.js', () => ({
  sendChatMessage: jest.fn(),
}));

jest.mock('../functions/moderation.js', () => ({
  moderateContent: jest.fn(),
}));

const { sendChatMessage } = require('../functions/chatFunctions.js');
const { moderateContent } = require('../functions/moderation.js');
const { startChatCollector, stopChatCollector } = require('../collectors/chatCollector.js');

function createCollectorHarness() {
  const handlers = {};
  const collector = {
    on: jest.fn((event, cb) => {
      handlers[event] = cb;
    }),
    stop: jest.fn(() => {
      if (handlers.end) {
        handlers.end();
      }
    }),
  };

  const channel = {
    id: 'channel-1',
    createMessageCollector: jest.fn(() => collector),
  };

  const interaction = {
    channel,
    client: { chatStates: new Map([['channel-1', true]]) },
  };

  return { interaction, collector, handlers };
}

function createMessage() {
  return {
    content: 'hello',
    author: { bot: false, id: 'user-1' },
    channel: { id: 'channel-1' },
    guild: {
      members: {
        cache: new Map([
          ['user-1', { nickname: null, user: { username: 'tester' } }],
        ]),
      },
    },
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

describe('collectors/chatCollector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('replies with moderation message when flagged', async () => {
    const { interaction, handlers } = createCollectorHarness();
    const message = createMessage();

    moderateContent.mockResolvedValueOnce({
      flagged: true,
      cleanedText: 'blocked',
    });

    startChatCollector(interaction, 5);

    await handlers.collect(message);

    expect(message.reply).toHaveBeenCalledWith('Your message/username was flagged by the moderation system. This may be logged for review.');
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  it('replies with error when moderation fails', async () => {
    const { interaction, handlers } = createCollectorHarness();
    const message = createMessage();

    moderateContent.mockRejectedValueOnce(new Error('mod fail'));

    startChatCollector(interaction, 5);

    await handlers.collect(message);

    expect(message.reply).toHaveBeenCalledWith('An error occurred during moderation. Please try again.');
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  it('replies when sendChatMessage throws', async () => {
    const { interaction, handlers } = createCollectorHarness();
    const message = createMessage();

    moderateContent.mockResolvedValueOnce({
      flagged: false,
      cleanedText: 'clean message',
    });
    sendChatMessage.mockRejectedValueOnce(new Error('chat fail'));

    startChatCollector(interaction, 5);

    await handlers.collect(message);

    expect(message.reply).toHaveBeenCalledWith('An error occurred while sending/receiving the message to the chatbot service. Please try again later');
  });

  it('stops and clears active collector', () => {
    const { interaction } = createCollectorHarness();

    startChatCollector(interaction, 5);

    stopChatCollector('channel-1');

    expect(interaction.client.chatStates.get('channel-1')).toBe(false);
  });
});
