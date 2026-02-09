const path = require('path');
require(path.resolve(__dirname, '..', 'tests', 'setup.js'));

jest.mock('discord.js', () => {
  class BaseBuilder {
    constructor() {
      this.data = {};
    }
    setCustomId(value) {
      this.data.customId = value;
      return this;
    }
    setLabel(value) {
      this.data.label = value;
      return this;
    }
    setMaxLength(value) {
      this.data.maxLength = value;
      return this;
    }
    setStyle(value) {
      this.data.style = value;
      return this;
    }
    setRequired(value) {
      this.data.required = value;
      return this;
    }
    setTitle(value) {
      this.data.title = value;
      return this;
    }
  }

  class ActionRowBuilder extends BaseBuilder {
    constructor() {
      super();
      this.components = [];
    }
    addComponents(component) {
      this.components.push(component);
      return this;
    }
  }

  class ModalBuilder extends BaseBuilder {
    constructor() {
      super();
      this.components = [];
    }
    addComponents(...rows) {
      this.components.push(...rows);
      return this;
    }
  }

  class TextInputBuilder extends BaseBuilder {}

  return {
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle: { Short: 'short', Paragraph: 'paragraph' },
  };
});

const { createImageChatModal, waitForModalSubmit } = require('../components/imageChatModal');

describe('components/imageChatModal', () => {
  it('builds a modal with three input rows', () => {
    const modal = createImageChatModal();

    expect(modal.data.customId).toBe('chatRefineModal');
    expect(modal.data.title).toBe('Chat Refinement');
    expect(modal.components).toHaveLength(3);
  });

  it('resolves modal submit data and defers update', async () => {
    const modalInteraction = {
      fields: {
        getTextInputValue: jest.fn((id) => {
          const values = {
            toBeReplaced: 'car',
            replaceWith: 'spaceship',
            negative_prompt: 'rain',
          };
          return values[id];
        }),
      },
      deferUpdate: jest.fn().mockResolvedValue(undefined),
    };

    const interaction = {
      user: { id: 'user-1' },
      awaitModalSubmit: jest.fn().mockResolvedValue(modalInteraction),
    };

    const result = await waitForModalSubmit(interaction);

    expect(result).toEqual({
      toBeReplaced: 'car',
      replaceWith: 'spaceship',
      negativePrompt: 'rain',
    });
    expect(modalInteraction.deferUpdate).toHaveBeenCalled();
  });

  it('rejects when awaitModalSubmit fails', async () => {
    const interaction = {
      user: { id: 'user-1' },
      awaitModalSubmit: jest.fn().mockRejectedValue(new Error('timeout')),
    };

    await expect(waitForModalSubmit(interaction)).rejects.toThrow('timeout');
  });
});
