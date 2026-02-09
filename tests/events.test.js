const path = require('path');
require(path.resolve(__dirname, '..', 'tests', 'setup.js'));

jest.mock('discord.js', () => ({
  Events: {
    InteractionCreate: 'interactionCreate',
    ClientReady: 'ready',
  },
}));

const interactionCreate = require('../events/interactionCreate');
const ready = require('../events/ready');

function createInteraction(overrides = {}) {
  return {
    isChatInputCommand: jest.fn().mockReturnValue(true),
    commandName: 'test',
    client: {
      commands: new Map(),
      chatStates: new Map(),
    },
    replied: false,
    deferred: false,
    reply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('events/interactionCreate', () => {
  it('skips non-chat-input interactions', async () => {
    const interaction = createInteraction({
      isChatInputCommand: jest.fn().mockReturnValue(false),
    });

    await interactionCreate.execute(interaction);

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it('logs when command is missing', async () => {
    const interaction = createInteraction();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await interactionCreate.execute(interaction);

    expect(errorSpy).toHaveBeenCalledWith('No command matching test was found.');
    errorSpy.mockRestore();
  });

  it('executes the command when found', async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const interaction = createInteraction({
      client: {
        commands: new Map([['test', { execute }]]),
      },
    });

    await interactionCreate.execute(interaction);

    expect(execute).toHaveBeenCalledWith(interaction);
  });

  it('replies when a command errors and no reply sent', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('boom'));
    const interaction = createInteraction({
      client: {
        commands: new Map([['test', { execute }]]),
      },
      replied: false,
      deferred: false,
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await interactionCreate.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'There was an error while executing this command! Notify your bot host if this persists.',
      ephemeral: true,
    });
    errorSpy.mockRestore();
  });

  it('follows up when a command errors after reply/defer', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('boom'));
    const interaction = createInteraction({
      client: {
        commands: new Map([['test', { execute }]]),
      },
      replied: true,
      deferred: true,
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await interactionCreate.execute(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'There was an error while executing this command! Notify your bot host if this persists.',
      ephemeral: true,
    });
    errorSpy.mockRestore();
  });
});

describe('events/ready', () => {
  it('initializes chatStates map', () => {
    const client = { user: { tag: 'bot#0001' } };
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    ready.execute(client);

    expect(client.chatStates).toBeInstanceOf(Map);
    expect(logSpy).toHaveBeenCalledWith('Ready! Logged in as bot#0001');
    logSpy.mockRestore();
  });
});
