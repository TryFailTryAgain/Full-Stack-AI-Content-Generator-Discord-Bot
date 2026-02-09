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
        setMaxLength: () => option,
        setRequired: () => option,
        addChoices: () => option,
      };
      fn(option);
      return this;
    }
  }

  class AttachmentBuilder {
    constructor(buffer) {
      this.attachment = buffer;
    }
  }

  class ActionRowBuilder {
    constructor() {
      this.components = [];
    }
    addComponents(...components) {
      this.components.push(...components);
      return this;
    }
  }

  class ButtonBuilder {
    constructor() {
      this.data = {};
      this.disabled = false;
    }
    setCustomId(value) { this.data.customId = value; return this; }
    setLabel(value) { this.data.label = value; return this; }
    setStyle(value) { this.data.style = value; return this; }
    setEmoji(value) { this.data.emoji = value; return this; }
    setDisabled(value) { this.disabled = value; return this; }
  }

  class ModalBuilder {
    setCustomId() { return this; }
    setTitle() { return this; }
    addComponents() { return this; }
  }

  class TextInputBuilder {
    setCustomId() { return this; }
    setLabel() { return this; }
    setStyle() { return this; }
    setMaxLength() { return this; }
    setRequired() { return this; }
  }

  return {
    SlashCommandBuilder,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle: { Primary: 1, Secondary: 2 },
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle: { Paragraph: 1 },
  };
});

jest.mock('../functions/image_functions.js', () => ({
  generateImage: jest.fn(),
  generateImageToImage: jest.fn(),
  upscaleImage: jest.fn(),
  promptOptimizer: jest.fn(),
}));

jest.mock('../functions/helperFunctions.js', () => ({
  deleteAndFollowUpEphemeral: jest.fn().mockResolvedValue(undefined),
  followUpEphemeral: jest.fn().mockResolvedValue(undefined),
}));

const imageFunctions = require('../functions/image_functions.js');
const helperFunctions = require('../functions/helperFunctions.js');
const imageCommand = require('../commands/CoreFunctions/image.js');

function createInteraction() {
  return {
    user: { id: 'user-1' },
    options: {
      getString: jest.fn((key) => {
        if (key === 'prompt') return 'a test prompt';
        if (key === 'dimensions') return null;
        return null;
      }),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue({
      createMessageComponentCollector: jest.fn(() => ({
        on: jest.fn(),
      })),
    }),
    client: { on: jest.fn() },
  };
}

describe('commands/image', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('handles flagged moderation errors', async () => {
    imageFunctions.generateImage.mockRejectedValueOnce(new Error('flagged'));
    const interaction = createInteraction();

    await imageCommand.execute(interaction);

    expect(helperFunctions.deleteAndFollowUpEphemeral).toHaveBeenCalledWith(
      interaction,
      'Your prompt was flagged by the moderation system. This may be logged for review.'
    );
  });

  it('handles general generation errors', async () => {
    imageFunctions.generateImage.mockRejectedValueOnce(new Error('other error'));
    const interaction = createInteraction();

    await imageCommand.execute(interaction);

    expect(helperFunctions.deleteAndFollowUpEphemeral).toHaveBeenCalledWith(
      interaction,
      'An error occurred while generating the image. Please try again'
    );
  });

  it('sends the generated image with components', async () => {
    imageFunctions.generateImage.mockResolvedValueOnce([Buffer.from('img')]);
    const interaction = createInteraction();

    await imageCommand.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalled();
    const call = interaction.editReply.mock.calls[0][0];
    expect(call.files).toHaveLength(1);
    expect(call.components).toHaveLength(2);
  });
});
