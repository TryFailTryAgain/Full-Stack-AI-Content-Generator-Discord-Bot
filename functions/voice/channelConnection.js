/* 
* File: channelConnection.js
* Author: TryFailTryAgain
* Copyright (c) 2025. All rights reserved. For use in Open-Source projects this
* may be freely copied or excerpted with credit to the author.
*/
const { joinVoiceChannel, VoiceConnectionStatus } = require('@discordjs/voice');
const WebSocket = require('ws');
const state = require('./voiceGlobalState.js');


// Join a voice channel
async function handleJoinVoiceChannel(interaction, channel) {
    console.log(`--/Voice-Chat Attempting to join Channel ID: ${channel.id}`);
    // Check if the bot is already in a voice channel
    const botVoiceChannel = interaction.guild.members.me.voice.channel;
    if (botVoiceChannel) {
        console.log(`-Bot is currently in voice channel: ${botVoiceChannel.name}`);
        await interaction.reply(`Leaving ${botVoiceChannel.name} and joining ${channel.name} shortly.`);
    } else {
        console.log(`-Bot is not currently in any voice channel. Joining ${channel.name}.`);
        await interaction.reply(`Joining ${channel.name} shortly.`);
    }
    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
    });

    connection.on('error', (error) => {
        console.error(error);
        throw new Error('Failed to join voice channel');
    });

    return connection;
}


// Gracefully disconnect from voice channel
async function gracefulDisconnect(ws, connection) {
    console.log("--Starting graceful disconnection process");
    // Set the shutdown flag when disconnecting
    state.isVoiceChatShuttingDown = true;

    // Check if connection exists and is not destroyed  
    if (connection && connection.state && connection.state.status !== 'destroyed') {
        // Check if the connection has an active subscription (player)
        const subscriptions = connection.state.subscription;
        if (subscriptions && subscriptions.player) {
            // Determine if player is still active
            const player = subscriptions.player;
            if (player && player.state.status === 'playing') {
                // Wait loop with timeout protection
                while (player.state.status === 'playing') {
                    console.log("-Audio playing. Waiting for current audio to finish playing before disconnecting.");
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
                console.log("Audio playback completed");
            }
        }
        // Destroy the connection
        console.log("-Disconnecting from voice channel");
        connection.destroy();
    }

    // Close WebSocket if it still exists and is open
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log("-Closing WebSocket connection");
        ws.close();
    }
    console.log("-Graceful disconnect complete");
    return;
}

module.exports = {
    handleJoinVoiceChannel,
    gracefulDisconnect
};
