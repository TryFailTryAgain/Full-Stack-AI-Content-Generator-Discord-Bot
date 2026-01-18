/* 
* File: voice-chat.js
* Author: TryFailTryAgain
* Copyright (c) 2025. All rights reserved. For use in Open-Source projects this
* may be freely copied or excerpted with credit to the author.
*/
const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { followUpEphemeral } = require('../../functions/helperFunctions.js');
const { VoiceConnectionStatus } = require('@discordjs/voice');
const { handleJoinVoiceChannel, gracefulDisconnect } = require('../../functions/voice_chat/channelConnection.js');
const { setupRealtimeVoiceWS, updateSessionParams, injectMessageGetResponse } = require('../../functions/voice_chat/openaiControl.js');
const { streamOpenAIAudio, streamUserAudioToOpenAI } = require('../../functions/voice_chat/audioStreaming.js');
const { setupVoiceChatTimeLimit } = require('../../functions/voice_chat/sessionManagement.js');
const { toolDef_generateImage } = require('../../functions/tools/imageTool.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('voice-chat')
		.setDescription('Real-time voice chat with AI')
		.addChannelOption((option) =>
			option.setName('channel')
				.setDescription('The voice channel the bot should join')
				.setRequired(true)
				.addChannelTypes(ChannelType.GuildVoice)
		)
		.addBooleanOption((option) =>
			option.setName('no_interruptions')
				.setDescription('When enabled, bot will finish speaking even if users talk over it')
				.setRequired(false)
		),

	async execute(interaction) {
		const timeLimit = process.env.VOICE_CHAT_TIME_LIMIT;
		let ws = await setupRealtimeVoiceWS(interaction);
		const noInterruptions = interaction.options.getBoolean('no_interruptions') || false;
		const channel = interaction.options.getChannel('channel');
		// Build user list from the voice channel
		const userList = Array.from(channel.members.values()).map(member => member.nickname || member.user.username).join(', ');
		let connection;

		// Configure session parameters for Voice Chat
		const sessionParams = {
			instructions: process.env.OPENAI_VOICE_CHAT_INSTRUCTIONS,
			temperature: process.env.OPENAI_VOICE_CHAT_TEMPERATURE,
			voice: process.env.OPENAI_VOICE_CHAT_VOICE,
			max_response_output_tokens: process.env.OPENAI_VOICE_CHAT_MAX_TOKENS,
			tools: toolDef_generateImage
		};
		// Update the session with current environment parameters
		updateSessionParams(ws, sessionParams);

		// Join the voice channel
		try {
			connection = await handleJoinVoiceChannel(interaction, channel);
		} catch (error) {
			console.error('Error joining voice channel:', error);
			return followUpEphemeral(interaction, 'An error occurred while trying to join the voice channel. Please try again later.');
		}

		// Wait for the connection to be ready
		connection.on(VoiceConnectionStatus.Ready, () => {
			console.log(`- Successfully joined voice channel: ${channel.name}`);
			try {
				// Begin capturing user's audio and streaming to OpenAI
				streamOpenAIAudio(ws, connection, noInterruptions);
				// Begin streaming audio from OpenAI back to Discord
				streamUserAudioToOpenAI(connection, ws, noInterruptions, interaction);
				// Set up a time limit for the voice chat if defined
				setupVoiceChatTimeLimit(ws, connection, interaction, timeLimit);
				// Request a greeting from OpenAI with list of voice users
				injectMessageGetResponse(ws, process.env.OPENAI_VOICE_CHAT_GREETING + "\n Here is a list of everyone's username that is currently in the voice-chat: " + userList);

				// Log if no_interruptions mode is enabled
				if (noInterruptions) {
					console.log("-- No interruptions mode enabled. Bot will finish speaking even when users talk over it.");
				}
			} catch (error) {
				console.error(error);
				followUpEphemeral(interaction, 'An error occurred while setting up the connection. Please try again later and notify your bot host if this persists.');
			}
		});

		connection.on(VoiceConnectionStatus.Disconnected, () => {
			console.log('- Disconnected from the voice channel');
			gracefulDisconnect(ws, connection);
		});
		connection.on(VoiceConnectionStatus.Destroyed, () => {
			console.log('- Voice connection destroyed');
			gracefulDisconnect(ws, connection);
		});
	},
};
