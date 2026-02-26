require('./setup');

const { createMockInteraction } = require('./utils/testHelpers');

const mockStartVoiceFactCheck = jest.fn().mockResolvedValue(undefined);
const mockFollowUpEphemeral = jest.fn().mockResolvedValue(undefined);

jest.mock('../functions/voice_chat_tts/voice-fact-check.js', () => ({
    startVoiceFactCheck: (...args) => mockStartVoiceFactCheck(...args)
}));

jest.mock('../functions/helperFunctions.js', () => ({
    followUpEphemeral: (...args) => mockFollowUpEphemeral(...args)
}));

jest.mock('discord.js', () => ({
    ChannelType: { GuildVoice: 2 },
    SlashCommandBuilder: jest.fn().mockImplementation(() => {
        const builder = {
            setName: jest.fn().mockReturnThis(),
            setDescription: jest.fn().mockReturnThis(),
            addChannelOption: jest.fn().mockImplementation((fn) => {
                const option = {
                    setName: jest.fn().mockReturnThis(),
                    setDescription: jest.fn().mockReturnThis(),
                    setRequired: jest.fn().mockReturnThis(),
                    addChannelTypes: jest.fn().mockReturnThis()
                };
                fn(option);
                return builder;
            }),
            addBooleanOption: jest.fn().mockImplementation((fn) => {
                const option = {
                    setName: jest.fn().mockReturnThis(),
                    setDescription: jest.fn().mockReturnThis(),
                    setRequired: jest.fn().mockReturnThis()
                };
                fn(option);
                return builder;
            })
        };
        return builder;
    })
}));

const command = require('../commands/CoreFunctions/voice-fact-check.js');

describe('/voice-fact-check command', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('calls startVoiceFactCheck with parsed options', async () => {
        const channel = { id: 'voice-1', name: 'General' };
        const interaction = createMockInteraction({
            options: {
                getBoolean: jest.fn().mockImplementation((name) => name === 'prevent_interruptions' ? true : null),
                getChannel: jest.fn().mockImplementation((name) => name === 'channel' ? channel : null)
            }
        });

        await command.execute(interaction);

        expect(mockStartVoiceFactCheck).toHaveBeenCalledTimes(1);
        expect(mockStartVoiceFactCheck).toHaveBeenCalledWith({
            interaction,
            channel,
            preventInterruptions: true
        });
    });

    test('reports failure via followUpEphemeral', async () => {
        const channel = { id: 'voice-2', name: 'Ops' };
        const interaction = createMockInteraction({
            options: {
                getBoolean: jest.fn().mockReturnValue(false),
                getChannel: jest.fn().mockReturnValue(channel)
            }
        });

        mockStartVoiceFactCheck.mockRejectedValueOnce(new Error('boom'));

        await command.execute(interaction);

        expect(mockFollowUpEphemeral).toHaveBeenCalledTimes(1);
        expect(mockFollowUpEphemeral.mock.calls[0][1]).toContain('Unable to start voice fact-check session');
    });
});
