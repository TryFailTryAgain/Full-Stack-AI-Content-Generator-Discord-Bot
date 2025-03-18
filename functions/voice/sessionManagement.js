/* 
* File: chatFunctions.js
* Author: TryFailTryAgain
* Copyright (c) 2025. All rights reserved. For use in Open-Source projects this
* may be freely copied or excerpted with credit to the author.
*/
const { VoiceConnectionStatus } = require('@discordjs/voice');
const state = require('./voiceGlobalState.js');

// Set up a time limit for the voice chat session
function setupVoiceChatTimeLimit(ws, connection, interaction, timeLimit) {
    const { injectMessageGetResponse } = require('./openaiControl.js');
    const { gracefulDisconnect } = require('./channelConnection.js');

    if (!isNaN(parseInt(timeLimit))) {
        const timeLimitMs = parseInt(timeLimit) * 1000; // Convert to milliseconds
        console.log(`--Voice chat time limit set: ${timeLimit} seconds`);

        // Set timeout for disconnection and store the timeout ID
        const timeoutId = setTimeout(async () => {
            console.log(`--Voice chat time limit (${timeLimit}s) reached, initiating disconnect`);

            // Set the shutdown flag to true to stop processing new user audio
            state.isVoiceChatShuttingDown = true;
            console.log("--User audio input disabled, no longer sending to OpenAI");

            // Wait a bit to allow for any final messages currently streaming in to finish.
            await new Promise(resolve => setTimeout(resolve, 4000));
            injectMessageGetResponse(ws, process.env.OPENAI_VOICE_CHAT_DISCONNECT_MESSAGE);

            const messageHandler = message => {
                const serverMessage = JSON.parse(message);
                if (serverMessage.type === "response.done") {
                    ws.removeListener("message", messageHandler);
                    gracefulDisconnect(ws, connection);
                }
            };

            ws.on("message", messageHandler);

            interaction.followUp({
                content: `Voice chat has been disconnected due to reaching the time limit (${timeLimit} seconds).`,
                ephemeral: false
            }).catch(err => console.error("Error sending disconnect notification:", err));
        }, timeLimitMs);

        // Clear the timeout if the connection is destroyed before the time limit
        connection.on(VoiceConnectionStatus.Destroyed, () => {
            console.log(`-clearing voice chat time limit`);
            clearTimeout(timeoutId);
        });

        return true;
    } else {
        console.error("--Invalid time limit provided. No time limit set.");
        return false;
    }
}

module.exports = {
    setupVoiceChatTimeLimit
};
