/* 
* File: voice-chat.js
* Author: TryFailTryAgain
* Copyright (c) 2025. All rights reserved. For use in Open-Source projects this
* may be freely copied or excerpted with credit to the author.
*/
const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { followUpEphemeral } = require('../../functions/helperFunctions.js');
const { startVoiceChatTTS } = require('../../functions/voice_chat_tts/voice-chat-tts.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voice-chat-tts')
        .setDescription('Real-time voice chat with AI using TTS')
        .addChannelOption((option) =>
            option.setName('channel')
                .setDescription('The voice channel the bot should join')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildVoice)
        )
        .addBooleanOption((option) =>
            option.setName('prevent_interruptions')
                .setDescription('Prevent the bot from being interrupted while it is speaking')
                .setRequired(false)
        ),

    async execute(interaction) {
        const preventInterruptions = interaction.options.getBoolean('prevent_interruptions') || false;
        const channel = interaction.options.getChannel('channel');
        try {
            await startVoiceChatTTS({ interaction, channel, preventInterruptions });
        } catch (error) {
            console.error('[VoiceChatTTS] Command failed', error);
            await followUpEphemeral(interaction, 'Unable to start voice chat TTS session. Please try again or contact the bot owner.');
        }
    },
};
