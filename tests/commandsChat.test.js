const path = require('path');
require(path.resolve(__dirname, '..', 'tests', 'setup.js'));

jest.mock('../collectors/chatCollector.js', () => ({
  startChatCollector: jest.fn(),
  stopChatCollector: jest.fn(),
}));

const { startChatCollector, stopChatCollector } = require('../collectors/chatCollector.js');
const chatCommand = require('../commands/CoreFunctions/chat.js');

function createInteraction({ timeValue, chatActive }) {
  const chatStates = new Map([['channel-1', chatActive]]);
  return {
    channel: { id: 'channel-1' },
    client: { chatStates },
    options: {
      getInteger: jest.fn().mockReturnValue(timeValue),
    },
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

describe('commands/chat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stops active chat sessions', async () => {
    const interaction = createInteraction({ timeValue: 10, chatActive: true });

    await chatCommand.execute(interaction);

    expect(stopChatCollector).toHaveBeenCalledWith('channel-1');
    expect(interaction.client.chatStates.get('channel-1')).toBe(false);
    expect(interaction.reply).toHaveBeenCalledWith('Chatbot was already active! Disabling now for this channel. Reactive with /Chat again');
  });

  it('handles time=0 when chat is inactive', async () => {
    const interaction = createInteraction({ timeValue: 0, chatActive: false });

    await chatCommand.execute(interaction);

    expect(startChatCollector).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith('Chatbot is not active in this channel. Use /Chat + a time frame to activate the chat');
  });

  it('starts collector for valid time', async () => {
    const interaction = createInteraction({ timeValue: 5, chatActive: false });

    await chatCommand.execute(interaction);

    expect(startChatCollector).toHaveBeenCalledWith(interaction, 5);
    expect(interaction.client.chatStates.get('channel-1')).toBe(true);
    expect(interaction.reply).toHaveBeenCalledWith('Chatbot is now active for ALL users in this channel for the next 5 minutes');
  });
});
