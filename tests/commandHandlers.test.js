/**
 * Tests for Discord command handlers
 *
 * Verifies that command handlers correctly:
 *  - Parse slash command options
 *  - Call the right underlying functions with correct arguments
 *  - Handle errors gracefully (moderation flags, API failures)
 *  - Manage Discord interaction lifecycle (defer, reply, followUp)
 *
 * Discord.js is fully mocked; these test the command logic, not Discord itself.
 */

const path = require('path');
require(path.resolve(__dirname, '..', 'tests', 'setup.js'));

const { createMockInteraction } = require('./utils/testHelpers');

// ─── Mock all external dependencies ──────────────────────────

// Mock image_functions
const mockGenerateImage = jest.fn().mockResolvedValue([Buffer.from('mock-image')]);
const mockUpscaleImage = jest.fn().mockResolvedValue(Buffer.from('upscaled-mock'));
const mockPromptOptimizer = jest.fn().mockResolvedValue('optimized prompt');
const mockAdaptImagePrompt = jest.fn().mockResolvedValue('refined prompt');
const mockGenerateImageToImage = jest.fn().mockResolvedValue([Buffer.from('i2i-mock')]);
const mockGenerateImageEdit = jest.fn().mockResolvedValue([Buffer.from('edit-mock')]);

jest.mock('../functions/image_functions.js', () => ({
  generateImage: mockGenerateImage,
  upscaleImage: mockUpscaleImage,
  promptOptimizer: mockPromptOptimizer,
  adaptImagePrompt: mockAdaptImagePrompt,
  generateImageToImage: mockGenerateImageToImage,
  generateImageEdit: mockGenerateImageEdit,
  saveToDiskCheck: jest.fn().mockResolvedValue(false),
  validateApiKeys: jest.fn(),
  genSeed: jest.fn().mockResolvedValue(12345),
  getDimensions: jest.fn().mockReturnValue('1:1'),
  autoDisableUnneededPromptOptimization: jest.fn().mockReturnValue(false),
  searchAndReplace: jest.fn().mockResolvedValue([Buffer.from('snr-mock')]),
}));

// Mock helper functions
jest.mock('../functions/helperFunctions.js', () => ({
  generateHashedUserId: jest.fn().mockResolvedValue('hashed-user'),
  deleteAndFollowUpEphemeral: jest.fn().mockResolvedValue(undefined),
  followUpEphemeral: jest.fn().mockResolvedValue(undefined),
  sendImages: jest.fn().mockResolvedValue(undefined),
  saveToDiskCheck: jest.fn().mockResolvedValue(false),
  generateRandomHex: jest.fn().mockReturnValue('aabbccdd'),
  checkThenSave_ReturnSendImage: jest.fn().mockImplementation(async (buf) => buf),
  collectUserInput: jest.fn().mockResolvedValue('user input text'),
  collectImageAndPrompt: jest.fn().mockResolvedValue({ imageURL: 'https://example.com/img.png', prompt: 'edit this' }),
  collectImage: jest.fn().mockResolvedValue('https://example.com/upload.png'),
  collectImagesAndPrompt: jest.fn().mockResolvedValue({ imageURLs: ['https://example.com/img.png'], prompt: 'transform' }),
  collectImages: jest.fn().mockResolvedValue(['https://example.com/img.png']),
}));

// Mock chatFunctions
const mockSendChatMessage = jest.fn().mockResolvedValue('Hello! I am a chatbot.');
jest.mock('../functions/chatFunctions.js', () => ({
  sendChatMessage: mockSendChatMessage,
  getChatSettings: jest.fn().mockReturnValue({
    chatModel: 'gpt-5-nano',
    chatTemperature: 0.7,
    maxTokens: 500,
    systemMessage: 'You are helpful.',
  }),
  sendChatMessageCompletions: jest.fn().mockResolvedValue('completions response'),
  sendChatMessageResponses: jest.fn().mockResolvedValue('responses response'),
}));

// Mock moderation
jest.mock('../functions/moderation.js', () => ({
  moderateContent: jest.fn().mockResolvedValue({
    flagged: false,
    flaggedCategories: [],
    cleanedText: 'clean text',
  }),
}));

// Mock chatCollector
const mockStartChatCollector = jest.fn();
const mockStopChatCollector = jest.fn();
jest.mock('../collectors/chatCollector.js', () => ({
  startChatCollector: mockStartChatCollector,
  stopChatCollector: mockStopChatCollector,
}));

// Mock discord.js
jest.mock('discord.js', () => ({
  SlashCommandBuilder: jest.fn().mockImplementation(() => {
    const builder = {
      setName: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      addStringOption: jest.fn().mockImplementation((fn) => { fn(builder._optBuilder); return builder; }),
      addIntegerOption: jest.fn().mockImplementation((fn) => { fn(builder._optBuilder); return builder; }),
      _optBuilder: {
        setName: jest.fn().mockReturnThis(),
        setDescription: jest.fn().mockReturnThis(),
        setMaxLength: jest.fn().mockReturnThis(),
        setRequired: jest.fn().mockReturnThis(),
        addChoices: jest.fn().mockReturnThis(),
      },
    };
    return builder;
  }),
  AttachmentBuilder: jest.fn().mockImplementation((data) => ({ data, name: 'image.png' })),
  ActionRowBuilder: jest.fn().mockImplementation(() => ({
    addComponents: jest.fn().mockReturnThis(),
    components: [],
  })),
  ButtonBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setLabel: jest.fn().mockReturnThis(),
    setStyle: jest.fn().mockReturnThis(),
    setEmoji: jest.fn().mockReturnThis(),
    setDisabled: jest.fn().mockReturnThis(),
  })),
  ButtonStyle: { Primary: 1, Secondary: 2 },
  ModalBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setTitle: jest.fn().mockReturnThis(),
    addComponents: jest.fn().mockReturnThis(),
  })),
  TextInputBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setLabel: jest.fn().mockReturnThis(),
    setStyle: jest.fn().mockReturnThis(),
    setMaxLength: jest.fn().mockReturnThis(),
    setRequired: jest.fn().mockReturnThis(),
  })),
  TextInputStyle: { Paragraph: 2 },
  StringSelectMenuBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setPlaceholder: jest.fn().mockReturnThis(),
    addOptions: jest.fn().mockReturnThis(),
  })),
  StringSelectMenuOptionBuilder: jest.fn().mockImplementation(() => ({
    setLabel: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setValue: jest.fn().mockReturnThis(),
  })),
  Events: {},
}));

// Mock openai (required by chatFunctions at module level)
jest.mock('openai', () => {
  const MockOpenAI = jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn() } },
    responses: { create: jest.fn() },
    images: { generate: jest.fn() },
    moderations: { create: jest.fn() },
    set baseURL(url) {},
    get baseURL() { return 'https://api.openai.com/v1'; },
  }));
  MockOpenAI.OpenAI = MockOpenAI;
  return MockOpenAI;
});

// ─── Require commands after mocks ────────────────────────────

const imageCommand = require('../commands/CoreFunctions/image.js');
const chatCommand = require('../commands/CoreFunctions/chat.js');
const imageAdvancedCommand = require('../commands/CoreFunctions/imageAdvanced.js');
const helperFunctions = require('../functions/helperFunctions.js');

// ─────────────────────────────────────────────────────────────
// /image command
// ─────────────────────────────────────────────────────────────
describe('/image command', () => {
  let interaction;

  beforeEach(() => {
    jest.clearAllMocks();
    interaction = createMockInteraction({
      options: {
        getString: jest.fn().mockImplementation((name) => {
          if (name === 'prompt') return 'a beautiful sunset';
          if (name === 'dimensions') return 'wide';
          return null;
        }),
        getInteger: jest.fn().mockReturnValue(null),
      },
    });
    // Provide a mock reply object with createMessageComponentCollector
    const mockCollector = {
      on: jest.fn().mockReturnThis(),
    };
    interaction.editReply = jest.fn().mockResolvedValue({
      createMessageComponentCollector: jest.fn().mockReturnValue(mockCollector),
    });
    interaction.client = {
      on: jest.fn(),
    };

    // Re-mock generateImage for fresh state
    mockGenerateImage.mockResolvedValue([Buffer.from('mock-image-data')]);
  });

  it('should have the correct command name', () => {
    expect(imageCommand.data).toBeDefined();
    expect(imageCommand.cooldown).toBe(1);
  });

  it('should defer reply before processing', async () => {
    await imageCommand.execute(interaction, interaction.client);
    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
  });

  it('should call generateImage with correct params from slash options', async () => {
    await imageCommand.execute(interaction, interaction.client);

    expect(mockGenerateImage).toHaveBeenCalledTimes(1);
    const callArgs = mockGenerateImage.mock.calls[0][0];
    expect(callArgs.userInput).toBe('a beautiful sunset');
    expect(callArgs.dimensions).toBe('wide');
    expect(callArgs.numberOfImages).toBe(1);
    expect(callArgs.userID).toBe(interaction.user.id);
  });

  it('should default dimensions to square when not provided', async () => {
    interaction.options.getString = jest.fn().mockImplementation((name) => {
      if (name === 'prompt') return 'a cat';
      if (name === 'dimensions') return null;
      return null;
    });

    await imageCommand.execute(interaction, interaction.client);

    const callArgs = mockGenerateImage.mock.calls[0][0];
    expect(callArgs.dimensions).toBe('square');
  });

  it('should send image attachments via editReply', async () => {
    await imageCommand.execute(interaction, interaction.client);

    expect(interaction.editReply).toHaveBeenCalled();
    const editCall = interaction.editReply.mock.calls[0][0];
    expect(editCall.files).toBeDefined();
    expect(editCall.files.length).toBe(1);
  });

  it('should handle moderation flagged error gracefully', async () => {
    mockGenerateImage.mockRejectedValueOnce(new Error('Content was flagged by the moderation system'));

    await imageCommand.execute(interaction, interaction.client);

    expect(helperFunctions.deleteAndFollowUpEphemeral).toHaveBeenCalledTimes(1);
    const [, message] = helperFunctions.deleteAndFollowUpEphemeral.mock.calls[0];
    expect(message).toContain('flagged');
  });

  it('should handle generic errors gracefully', async () => {
    mockGenerateImage.mockRejectedValueOnce(new Error('Network timeout'));

    await imageCommand.execute(interaction, interaction.client);

    expect(helperFunctions.deleteAndFollowUpEphemeral).toHaveBeenCalledTimes(1);
    const [, message] = helperFunctions.deleteAndFollowUpEphemeral.mock.calls[0];
    expect(message).toContain('error occurred');
  });

  it('should set up button collector with correct filter', async () => {
    await imageCommand.execute(interaction, interaction.client);

    const editReplyResult = await interaction.editReply.mock.results[0].value;
    expect(editReplyResult.createMessageComponentCollector).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────
// /chat command
// ─────────────────────────────────────────────────────────────
describe('/chat command', () => {
  let interaction;

  beforeEach(() => {
    jest.clearAllMocks();
    interaction = createMockInteraction();
    interaction.client = {
      chatStates: new Map(),
    };
  });

  it('should have the correct command name and cooldown', () => {
    expect(chatCommand.data).toBeDefined();
    expect(chatCommand.cooldown).toBe(1);
  });

  it('should activate chatbot and start collector for valid time', async () => {
    interaction.options.getInteger = jest.fn().mockReturnValue(5);
    interaction.client.chatStates.set(interaction.channel.id, false);

    await chatCommand.execute(interaction);

    expect(interaction.client.chatStates.get(interaction.channel.id)).toBe(true);
    expect(mockStartChatCollector).toHaveBeenCalledWith(interaction, 5);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.stringContaining('5 minutes')
    );
  });

  it('should stop active chatbot if already running', async () => {
    interaction.options.getInteger = jest.fn().mockReturnValue(10);
    interaction.client.chatStates.set(interaction.channel.id, true);

    await chatCommand.execute(interaction);

    expect(mockStopChatCollector).toHaveBeenCalledWith(interaction.channel.id);
    expect(interaction.client.chatStates.get(interaction.channel.id)).toBe(false);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.stringContaining('Disabling')
    );
  });

  it('should respond with inactive message when time=0 and chat not active', async () => {
    interaction.options.getInteger = jest.fn().mockReturnValue(0);
    interaction.client.chatStates.set(interaction.channel.id, false);

    await chatCommand.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.stringContaining('not active')
    );
    expect(mockStartChatCollector).not.toHaveBeenCalled();
  });

  it('should handle indefinite mode (time=-1)', async () => {
    interaction.options.getInteger = jest.fn().mockReturnValue(-1);
    interaction.client.chatStates.set(interaction.channel.id, false);

    await chatCommand.execute(interaction);

    expect(mockStartChatCollector).toHaveBeenCalledWith(interaction, -1);
    expect(interaction.client.chatStates.get(interaction.channel.id)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// /image-advanced command
// ─────────────────────────────────────────────────────────────
describe('/image-advanced command', () => {
  let interaction;

  beforeEach(() => {
    jest.clearAllMocks();
    interaction = createMockInteraction();

    // Set up environment for action types
    process.env.IMAGE_ADV_TEXT2IMG_MODELS = 'black-forest-labs/flux-2-dev,dall-e-3';
    process.env.IMAGE_ADV_EDIT_MODELS = 'black-forest-labs/flux-kontext-pro';
    process.env.IMAGE_ADV_IMG2IMG_MODELS = 'black-forest-labs/flux-2-dev';
    process.env.IMAGE_ADV_UPSCALE_MODELS = 'nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa';

    // Mock the collector on the channel
    const mockCollector = {
      on: jest.fn().mockReturnThis(),
      stop: jest.fn(),
    };
    interaction.channel.createMessageComponentCollector = jest.fn().mockReturnValue(mockCollector);
  });

  it('should have the correct command name', () => {
    expect(imageAdvancedCommand.data).toBeDefined();
  });

  it('should defer reply and show action selection menu', async () => {
    await imageAdvancedCommand.execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    const editCall = interaction.editReply.mock.calls[0][0];
    expect(editCall.content).toContain('select an action');
    expect(editCall.components).toBeDefined();
  });

  it('should set up a message component collector on the channel', async () => {
    await imageAdvancedCommand.execute(interaction);

    expect(interaction.channel.createMessageComponentCollector).toHaveBeenCalledWith(
      expect.objectContaining({ time: 180000 })
    );
  });
});

// ─────────────────────────────────────────────────────────────
// chatCollector
// ─────────────────────────────────────────────────────────────
describe('chatCollector', () => {
  // Use requireActual since chatCollector is mocked at the top level for command handler tests
  const chatCollector = jest.requireActual('../collectors/chatCollector.js');
  const { moderateContent } = require('../functions/moderation.js');
  const { sendChatMessage } = require('../functions/chatFunctions.js');

  it('should export startChatCollector and stopChatCollector', () => {
    expect(typeof chatCollector.startChatCollector).toBe('function');
    expect(typeof chatCollector.stopChatCollector).toBe('function');
  });

  it('should create a message collector when started', () => {
    const mockCollector = {
      on: jest.fn().mockReturnThis(),
      stop: jest.fn(),
    };
    const interaction = createMockInteraction();
    interaction.channel.createMessageCollector = jest.fn().mockReturnValue(mockCollector);
    interaction.client = {
      chatStates: new Map(),
    };

    chatCollector.startChatCollector(interaction, 5);

    expect(interaction.channel.createMessageCollector).toHaveBeenCalledWith(
      expect.objectContaining({ time: 300000 }) // 5 * 60000
    );
    expect(mockCollector.on).toHaveBeenCalledWith('collect', expect.any(Function));
    expect(mockCollector.on).toHaveBeenCalledWith('end', expect.any(Function));
  });

  it('should stop a collector when stopChatCollector is called', () => {
    const mockCollectorObj = {
      on: jest.fn().mockReturnThis(),
      stop: jest.fn(),
    };
    const interaction = createMockInteraction();
    interaction.channel.createMessageCollector = jest.fn().mockReturnValue(mockCollectorObj);
    interaction.client = {
      chatStates: new Map(),
    };

    chatCollector.startChatCollector(interaction, 10);
    chatCollector.stopChatCollector(interaction.channel.id);

    expect(mockCollectorObj.stop).toHaveBeenCalledTimes(1);
  });

  it('should handle collect event by moderating and sending chat message', async () => {
    const mockCollectorObj = {
      on: jest.fn().mockReturnThis(),
      stop: jest.fn(),
    };
    const interaction = createMockInteraction();
    interaction.channel.createMessageCollector = jest.fn().mockReturnValue(mockCollectorObj);
    interaction.client = {
      chatStates: new Map(),
    };

    chatCollector.startChatCollector(interaction, 5);

    // Get the collect handler
    const collectHandler = mockCollectorObj.on.mock.calls.find(c => c[0] === 'collect')[1];

    // Create a mock message
    const mockMessage = {
      author: { id: '123', bot: false },
      content: 'Hello bot!',
      guild: {
        members: {
          cache: {
            get: jest.fn().mockReturnValue({
              nickname: 'TestNick',
              user: { username: 'testuser' },
            }),
          },
        },
      },
      reply: jest.fn().mockResolvedValue(undefined),
    };

    await collectHandler(mockMessage);

    const { moderateContent } = require('../functions/moderation.js');
    expect(moderateContent).toHaveBeenCalled();
    const { sendChatMessage } = require('../functions/chatFunctions.js');
    expect(sendChatMessage).toHaveBeenCalled();
    expect(mockMessage.reply).toHaveBeenCalledWith('Hello! I am a chatbot.');
  });

  it('should reject flagged messages during collection', async () => {
    const mockCollectorObj = {
      on: jest.fn().mockReturnThis(),
      stop: jest.fn(),
    };
    const interaction = createMockInteraction();
    interaction.channel.createMessageCollector = jest.fn().mockReturnValue(mockCollectorObj);
    interaction.client = {
      chatStates: new Map(),
    };

    chatCollector.startChatCollector(interaction, 5);

    const collectHandler = mockCollectorObj.on.mock.calls.find(c => c[0] === 'collect')[1];

    // Make moderation flag the message
    const { moderateContent } = require('../functions/moderation.js');
    moderateContent.mockResolvedValueOnce({
      flagged: true,
      flaggedCategories: ['flagged_category_a'],
      cleanedText: '',
    });

    // Clear sendChatMessage call history from previous tests
    const { sendChatMessage } = require('../functions/chatFunctions.js');
    sendChatMessage.mockClear();

    const mockMessage = {
      author: { id: '123', bot: false },
      content: 'bad message',
      guild: {
        members: {
          cache: {
            get: jest.fn().mockReturnValue({
              nickname: null,
              user: { username: 'testuser' },
            }),
          },
        },
      },
      reply: jest.fn().mockResolvedValue(undefined),
    };

    await collectHandler(mockMessage);

    expect(mockMessage.reply).toHaveBeenCalledWith(
      expect.stringContaining('flagged')
    );
    // sendChatMessage should NOT have been called for flagged content
    expect(sendChatMessage).not.toHaveBeenCalled();
  });
});
