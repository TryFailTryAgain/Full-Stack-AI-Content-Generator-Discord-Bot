const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { followUpEphemeral } = require('../../functions/helperFunctions.js');
const { startVoiceFactCheck } = require('../../functions/voice_chat_tts/voice-fact-check.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voice-fact-check')
        .setDescription('Transcribe voice chat and fact-check recent spoken claims when requested')
        .addChannelOption((option) =>
            option.setName('channel')
                .setDescription('The voice channel the bot should join')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildVoice)
        )
        .addBooleanOption((option) =>
            option.setName('prevent_interruptions')
                .setDescription('Prevent the bot from being interrupted while speaking fact-check results')
                .setRequired(false)
        ),

    async execute(interaction) {
        const preventInterruptions = interaction.options.getBoolean('prevent_interruptions') || false;
        const channel = interaction.options.getChannel('channel');

        try {
            await startVoiceFactCheck({ interaction, channel, preventInterruptions });
        } catch (error) {
            console.error('[VoiceFactCheck] Command failed', error);
            await followUpEphemeral(interaction, 'Unable to start voice fact-check session. Please try again or contact the bot owner.');
        }
    }
};
