/* 
* File: voice-chat.js
* Author: TryFailTryAgain
* Copyright (c) 2025. All rights reserved. For use in Open-Source projects this
* may be freely copied or excerpted with credit to the author.
*/
const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { followUpEphemeral } = require('../../functions/helperFunctions.js');
const { VoiceConnectionStatus } = require('@discordjs/voice');
const { handleJoinVoiceChannel, gracefulDisconnect } = require('../../functions/voice/channelConnection.js');
const { setupRealtimeVoiceWS, updateSessionParams, injectMessageGetResponse } = require('../../functions/voice/openaiControl.js');
const { streamOpenAIAudio, streamUserAudioToOpenAI } = require('../../functions/voice/audioStreaming.js');
const { setupVoiceChatTimeLimit } = require('../../functions/voice/sessionManagement.js');
const { filterCheckThenFilterString } = require('../../functions/helperFunctions.js');


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
		let ws = null;
		const noInterruptions = interaction.options.getBoolean('no_interruptions') || false;
		const channel = interaction.options.getChannel('channel');
		// Build user list from the voice channel
		const userList = await filterCheckThenFilterString(Array.from(channel.members.values()).map(member => member.nickname).join(', '));
		let connection;

		// Configure session parameters for Voice Chat
		const sessionParams = {
			instructions: process.env.OPENAI_VOICE_CHAT_INSTRUCTIONS,
			temperature: process.env.OPENAI_VOICE_CHAT_TEMPERATURE,
			voice: process.env.OPENAI_VOICE_CHAT_VOICE,
			max_response_output_tokens: process.env.OPENAI_VOICE_CHAT_MAX_TOKENS
		};

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
			ws = setupRealtimeVoiceWS(); // Opens realtime voice websocket connection

			ws.on('open', () => {
				try {
					console.log('-- Realtime voice websocket connection opened');
					// Update the session with current environment parameters
					updateSessionParams(ws, sessionParams);
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
					console.error('Error during WebSocket open event:', error);
					followUpEphemeral(interaction, 'An error occurred while opening the connection. Please try again later and notify your bot host if this persists.');
				}
				// Toggle logging based on environment variable: ENABLE_SERVER_LOGGING
				if (process.env.ADVCONF_OPENAI_VOICE_CHAT_SYSTEM_LOGGING === 'true') {
					ws.on("message", message => {
						const serverMessage = JSON.parse(message);
						const excludedTypes = [
							"response.audio.delta", "response.audio_transcript.delta"
						];
						if (!excludedTypes.includes(serverMessage.type)) {
							console.log("Server message:", serverMessage);
						}
					});
				}
			});
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
