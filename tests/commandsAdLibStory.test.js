const path = require('path');
require(path.resolve(__dirname, '..', 'tests', 'setup.js'));

jest.mock('discord.js', () => {
  class SlashCommandBuilder {
    setName() { return this; }
    setDescription() { return this; }
    addStringOption(fn) {
      const option = {
        setName: () => option,
        setDescription: () => option,
        setRequired: () => option,
      };
      fn(option);
      return this;
    }
  }

  class ButtonBuilder {
    setCustomId() { return this; }
    setLabel() { return this; }
    setStyle() { return this; }
  }

  class ActionRowBuilder {
    addComponents() { return this; }
  }

  class ModalBuilder {
    setCustomId() { return this; }
    setTitle() { return this; }
    addComponents() { return this; }
  }

  class TextInputBuilder {
    setCustomId() { return this; }
    setLabel() { return this; }
    setMaxLength() { return this; }
    setStyle() { return this; }
  }

  return {
    SlashCommandBuilder,
    ButtonBuilder,
    ButtonStyle: { Primary: 1 },
    ActionRowBuilder,
    Events: { InteractionCreate: 'interactionCreate' },
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle: { Short: 1 },
  };
});

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: 'story [NOUN]' } }],
        }),
      },
    },
  }));
});

jest.mock('../functions/moderation', () => ({
  moderateContent: jest.fn(),
}));

const { moderateContent } = require('../functions/moderation');
const adLibCommand = require('../commands/CoreFunctions/ad-lib_story.js');

function createInteraction() {
  return {
    user: { id: 'user-1' },
    options: {
      getString: jest.fn().mockReturnValue('make a story'),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    deleteReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    channel: {
      createMessageComponentCollector: jest.fn(() => ({ on: jest.fn() })),
    },
  };
}

describe('commands/ad-lib-story', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('handles flagged prompt moderation', async () => {
    const interaction = createInteraction();
    moderateContent.mockResolvedValueOnce({
      flagged: true,
      cleanedText: 'blocked',
    });

    await adLibCommand.execute(interaction);

    expect(interaction.deleteReply).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'Your prompt did not pass moderation. Please try again with different content.',
      ephemeral: true,
    });
  });

  it('handles moderation errors gracefully', async () => {
    const interaction = createInteraction();
    moderateContent.mockRejectedValueOnce(new Error('mod fail'));

    await adLibCommand.execute(interaction);

    expect(interaction.deleteReply).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'An error occurred during moderation. Please try again later.',
      ephemeral: true,
    });
  });
});
