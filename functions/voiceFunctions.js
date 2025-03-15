const fs = require('fs');
const path = require('path');
const prism = require('prism-media');
const { createAudioPlayer, createAudioResource, StreamType, joinVoiceChannel, VoiceConnectionStatus } = require('@discordjs/voice');
const { PassThrough, Transform } = require('stream');
const WebSocket = require('ws');
const { OpusEncoder } = require('@discordjs/opus');
const { spawn } = require('child_process');

// Add a flag to track if voice chat is in shutdown mode
let isVoiceChatShuttingDown = false;

// Global variables to track audio state
let currentAudioState = {
    responseItemId: null,
    startTimestamp: null,
    isPlaying: false,
    player: null,
    audioStream: null,
    ffmpeg: null
};

function setupRealtimeVoiceWS() {
    // Reset the shutdown flag when setting up a new connection
    isVoiceChatShuttingDown = false;
    // Use the environment variable for the model URL
    const wsUrl = process.env.VOICE_CHAT_MODEL_URL;
    const ws = new WebSocket(wsUrl, {
        headers: {
            "Authorization": "Bearer " + process.env.API_KEY_OPENAI_CHAT,
            "OpenAI-Beta": "realtime=v1",
        },
    });
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
    return ws;
}

// Sends a session update to OpenAI with any passed parameters.
function updateSessionParams(ws, params) {
    let event = null;
    if (process.env.ADVCONF_OPENAI_VOICE_CHAT_SYSTEM_LOGGING === 'true') {
        console.log(`-Session has enabled full logging.`);
        event = {
            type: 'session.update',
            session: {
                instructions: params.instructions,
                temperature: parseFloat(params.temperature),
                voice: params.voice,
                max_response_output_tokens: params.max_response_output_tokens,
                input_audio_transcription: {
                    "model": "whisper-1"
                },
            }
        };
    } else {
        event = {
            type: 'session.update',
            session: {
                instructions: params.instructions,
                temperature: parseFloat(params.temperature),
                voice: params.voice,
                max_response_output_tokens: params.max_response_output_tokens
            }
        };
    }
    console.log('-Updating session params');
    ws.send(JSON.stringify(event));
}

// Requests a greeting from OpenAI when the user joins the voice channel.
function injectMessageGetResponse(ws, instruction) {
    const responseRequest = {
        type: "response.create",
        response: {
            modalities: ['audio', 'text'],
            instructions: instruction
        }
    };
    ws.send(JSON.stringify(responseRequest));
    console.log("-Requested audio response with instruction from server");
}

// Helper function to truncate audio
function truncateAudio(ws, itemId) {
    if (!itemId || !currentAudioState.startTimestamp || !currentAudioState.isPlaying) {
        console.log("No active audio to truncate");
        return;
    }

    // Calculate how long the audio has been playing
    const audioPlayedMs = Date.now() - currentAudioState.startTimestamp;

    console.log(`-Truncating audio ${itemId} after ${audioPlayedMs}ms of playback`);

    // IMPORTANT: Use a safer shutdown sequence to prevent EPIPE errors
    try {
        // 1. First stop the player (this stops the consumption from ffmpeg output)
        if (currentAudioState.player) {
            currentAudioState.player.stop();
        }

        // 2. Mark as not playing to prevent further operations
        currentAudioState.isPlaying = false;

        // 3. Send truncation event to OpenAI
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                "type": "conversation.item.truncate",
                "item_id": itemId,
                "content_index": 0,
                "audio_end_ms": audioPlayedMs
            }));
        }

        // 4. Safely end the audio stream with error handling
        if (currentAudioState.audioStream) {
            currentAudioState.audioStream.end();
            // Detach all event listeners to prevent further writes
            currentAudioState.audioStream.removeAllListeners();
            // Unset to prevent accidental writes
            currentAudioState.audioStream = null;
        }

        // 5. Finally, terminate ffmpeg process if it exists
        if (currentAudioState.ffmpeg) {
            // First try graceful termination
            try {
                currentAudioState.ffmpeg.stdin.end();
            } catch (err) {
                // Ignore errors at this point
            }

            // Then force kill after a short delay to ensure clean shutdown
            setTimeout(() => {
                try {
                    if (currentAudioState.ffmpeg) {
                        currentAudioState.ffmpeg.kill('SIGKILL');
                        currentAudioState.ffmpeg = null;
                    }
                } catch (err) {
                    // Just log, don't throw
                    console.error("Error killing FFmpeg process:", err);
                }
            }, 50);
        }

    } catch (err) {
        console.error("Error during audio truncation:", err);
    }

    console.log(`Audio truncated after ${audioPlayedMs}ms`);
}

// Streams OpenAI audio to Discord with fixes for timing and pipeline creation
function streamOpenAIAudio(ws, connection) {
    let currentResponseId = null;
    let audioStream = null;
    let ffmpeg = null;
    let player = null;
    let audioBuffer = Buffer.alloc(0);

    // Reset the audio state
    currentAudioState = {
        responseItemId: null,
        startTimestamp: null,
        isPlaying: false,
        player: null,
        audioStream: null,
        ffmpeg: null
    };

    // Function to set up a new audio pipeline
    const setupNewPipeline = (responseId) => {
        console.log(`--Setting up pipeline for response: ${responseId}`);
        // Clean up any existing pipeline with error handling
        try {
            if (audioStream) {
                console.log("-Cleaning up previous audio stream");
                audioStream.removeAllListeners();  // Remove listeners first
                audioStream.end();                 // Then end the stream
            }
        } catch (err) {
            console.error("Error cleaning up previous audio stream:", err);
        }

        // Reset buffer
        audioBuffer = Buffer.alloc(0);
        // Creates a fresh stream component
        audioStream = new PassThrough({
            // Add highWaterMark to prevent buffer issues
            highWaterMark: 64 * 1024
        });
        currentAudioState.audioStream = audioStream;

        // Set up a new FFmpeg process. This happens as a co-process so it can run in parallel. Needs stereo output for Discord.
        // Without stereo, Discord plays mono audio at 2x speed and twice the pitch.
        ffmpeg = spawn('ffmpeg', [
            '-hide_banner',
            '-loglevel', 'error',
            '-analyzeduration', '0',
            '-f', 's16le',
            '-ar', '24000',
            '-ac', '1',
            '-i', 'pipe:0',
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '2',
            'pipe:1'
        ]);

        currentAudioState.ffmpeg = ffmpeg;
        // Pipe the audioStream to ffmpeg.stdin only once
        audioStream.pipe(ffmpeg.stdin);
        // Attach an error handler to suppress a reoccurring error when the stream is closed
        ffmpeg.stdin.on('error', error => {
            console.error("FFmpeg stdin error (suppressed):", error);
        });

        // Create a new audio resource and player
        const resource = createAudioResource(ffmpeg.stdout, {
            inputType: StreamType.Raw
        });

        player = createAudioPlayer();
        currentAudioState.player = player;

        player.on('error', error => console.error("Audio player error:", error));
        player.on('playing', () => {
            // Mark when audio begins playing and update state
            currentAudioState.startTimestamp = Date.now();
            currentAudioState.isPlaying = true;
            console.log(`-Audio playback started at ${new Date(currentAudioState.startTimestamp).toISOString()}`);
        });

        player.on('idle', () => {
            currentAudioState.isPlaying = false;
        });

        player.play(resource);
        connection.subscribe(player);

        currentResponseId = responseId;
        console.log(`-Created new audio pipeline for ${responseId}`);
    };

    // Listen for WebSocket messages
    ws.on("message", message => {
        try {
            const serverMessage = JSON.parse(message);

            // Check if this is a new response we should handle
            const messageResponseId = serverMessage.response_id;

            // Track response item ID when we get it
            if (serverMessage.type === "conversation.item.created") {
                currentAudioState.responseItemId = serverMessage.item.id;
                console.log(`-Tracking response item ID: ${currentAudioState.responseItemId}`);
            }

            // Check for truncation confirmation
            if (serverMessage.type === "conversation.item.truncated") {
                console.log(`-Server confirmed audio truncation for item ${serverMessage.item_id}`);
            }

            // Handle audio delta messages with error handling
            if (serverMessage.type === "response.audio.delta" && serverMessage.delta) {
                const audioChunk = Buffer.from(serverMessage.delta, 'base64');

                // Case 1: No active pipeline yet for this response
                if (currentResponseId === null || messageResponseId !== currentResponseId) {
                    setupNewPipeline(messageResponseId);
                    audioBuffer = Buffer.concat([audioBuffer, audioChunk]);
                }

                // Case 2: Active pipeline already playing
                else if (audioStream) {
                    try {
                        console.log(`-Writing ${audioChunk.length} bytes of audio to stream`);
                        audioBuffer = Buffer.concat([audioBuffer, audioChunk]);
                        if (audioBuffer.length > 0) {
                            // Only write if the stream is still writable
                            if (audioStream && !audioStream.destroyed && audioStream.writable) {
                                audioStream.write(audioBuffer);
                            } else {
                                console.log("-Skipping write to destroyed/closed stream");
                            }
                            audioBuffer = Buffer.alloc(0);
                        }
                    } catch (err) {
                        console.error("Error writing to audio stream:", err);
                        // Don't rethrow - just log and continue
                    }
                }
            }

            // End of response - clean up
            if (serverMessage.type === "response.done") {
                // Ensure we finish writing any buffered data
                if (audioBuffer.length > 0) {
                    console.log(`-Writing remaining ${audioBuffer.length} bytes of audio to stream`);
                    audioStream.write(audioBuffer);
                }

                // End the stream to ensure FFmpeg completes processing
                if (audioStream) {
                    console.log("Ending audio stream");
                    audioStream.end();
                }
                console.log("-Response complete and stream cleaned up. Ready for next response.");
                currentResponseId = null;
            }

        } catch (err) {
            console.error("Error while receiving audio:", err);
        }
    });

    console.log("--Ready to stream OpenAI audio to Discord");
}

function streamUserAudioToOpenAI(connection, ws) {
    const { EndBehaviorType } = require('@discordjs/voice');
    // Transform stream that decodes each Opus packet to PCM16 at 24000Hz mono.
    class OpusDecoderStream extends Transform {
        constructor() {
            super();
            this.encoder = new OpusEncoder(24000, 1);
        }
        _transform(chunk, encoding, callback) {
            try {
                this.push(this.encoder.decode(chunk));
                callback();
            } catch (err) {
                callback(err);
            }
        }
    }

    // Track active speaking users to prevent duplicate streams
    const activeSpeakers = new Map();

    connection.receiver.speaking.on("start", userId => {
        // Don't process new speakers if shutting down
        if (isVoiceChatShuttingDown) {
            console.log(`--User ${userId} started speaking, but voice chat is shutting down. Ignoring audio input.`);
            return;
        }

        // If user is already being processed, don't create another pipeline
        if (activeSpeakers.has(userId)) {
            console.log(`--User ${userId} already has an active speaking session. Ignoring duplicate.`);
            return;
        }

        console.log(`--User ${userId} started speaking`);

        // Cancel any in-progress response when a user starts speaking
        if (currentAudioState.responseItemId) {
            console.log(`--Cancelling in-progress response as the user has started speaking`);
            ws.send(JSON.stringify({
                type: 'response.cancel'
            }));
        }

        // Truncate any currently playing audio when user starts speaking
        if (currentAudioState.isPlaying && currentAudioState.responseItemId) {
            console.log(`--User started speaking - truncating current audio playback`);
            truncateAudio(ws, currentAudioState.responseItemId);
        }

        // Create a fresh decoder stream for each speaking session
        const decoderStream = new OpusDecoderStream();

        // Subscribe to the user's opus audio stream.
        const opusStream = connection.receiver.subscribe(userId, {
            end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 }
        });

        // Pipe the opus stream through the decoder to get PCM16 @24000 Hz mono.
        const pcmStream = opusStream.pipe(decoderStream);
        let bufferData = Buffer.alloc(0);
        const chunkSize = 32000; // Approximately 32KB.

        // Add user to active speakers list with timestamp
        activeSpeakers.set(userId, {
            timestamp: Date.now(),
            streams: { opusStream, decoderStream, pcmStream },
            totalBytesProcessed: 0
        });

        pcmStream.on('data', chunk => {
            if (!activeSpeakers.has(userId) || isVoiceChatShuttingDown) {
                return; // Skip processing if no longer active
            }

            // Update total bytes processed for debugging
            const speakerData = activeSpeakers.get(userId);
            speakerData.totalBytesProcessed += chunk.length;

            bufferData = Buffer.concat([bufferData, chunk]);

            // Send data when we reach the chunk size
            while (bufferData.length >= chunkSize) {
                const sendChunk = bufferData.slice(0, chunkSize);
                bufferData = bufferData.slice(chunkSize);

                ws.send(JSON.stringify({
                    type: 'input_audio_buffer.append',
                    audio: sendChunk.toString('base64')
                }));
                console.log(`-Sent input_audio_buffer.append chunk: ${chunkSize} bytes`);
            }
        });

        // When the stream ends, send any leftover data.
        pcmStream.on('end', () => {
            if (activeSpeakers.has(userId)) {
                const speakerData = activeSpeakers.get(userId);
                console.log(`--User ${userId} finished speaking (processed ${speakerData.totalBytesProcessed} bytes total)`);

                // Send any remaining buffer data
                if (bufferData.length > 0) {
                    ws.send(JSON.stringify({
                        type: 'input_audio_buffer.append',
                        audio: bufferData.toString('base64')
                    }));
                    console.log(`-Sending final input_audio_buffer.append chunk: ${bufferData.length} bytes`);
                }

                // Clean up and remove from active speakers
                activeSpeakers.delete(userId);
            }
        });

        // Add error handlers to prevent crashes
        opusStream.on('error', (error) => {
            console.error(`Opus stream error for user ${userId}:`, error);
            cleanup();
        });

        decoderStream.on('error', (error) => {
            console.error(`Decoder stream error for user ${userId}:`, error);
            cleanup();
        });

        pcmStream.on('error', (error) => {
            console.error(`PCM stream error for user ${userId}:`, error);
            cleanup();
        });

        // Clean up function to handle errors
        function cleanup() {
            if (activeSpeakers.has(userId)) {
                const { streams } = activeSpeakers.get(userId);

                try {
                    if (streams.opusStream) streams.opusStream.destroy();
                    if (streams.decoderStream) streams.decoderStream.destroy();
                    if (streams.pcmStream) streams.pcmStream.destroy();
                } catch (err) {
                    console.error(`Error cleaning up streams for user ${userId}:`, err);
                }

                activeSpeakers.delete(userId);
            }
        }
    });

    // Handle stop speaking event to properly clean up resources
    connection.receiver.speaking.on("end", userId => {
        if (activeSpeakers.has(userId)) {
            console.log(`--User ${userId} stopped speaking. Waiting for audio processing to complete.`);
            // Note: We don't delete from activeSpeakers here, letting the 'end' event on pcmStream handle it
        }
    });
}

async function handleJoinVoiceChannel(interaction, channel) {
    console.log(`--/Voice-Chat Attempting to join Channel ID: ${channel.id}`);
    // Check if the bot is already in a voice channel. Will be useful for not disconnecting an in-use connection later on.
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

// Function to handle the disconnection process with cleanup
async function gracefulDisconnect(ws, connection) {
    console.log("--Starting graceful disconnection process");
    // Set the shutdown flag when disconnecting
    isVoiceChatShuttingDown = true;

    // Check if connection exists and is not destroyed  
    if (connection.state.status !== 'destroyed') {
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

// Function to set up time limit for voice chat
function setupVoiceChatTimeLimit(ws, connection, interaction, timeLimit) {
    if (!isNaN(parseInt(timeLimit))) {
        const timeLimitMs = parseInt(timeLimit) * 1000; // Convert to milliseconds
        console.log(`--Voice chat time limit set: ${timeLimit} seconds`);

        // Set timeout for disconnection and store the timeout ID
        const timeoutId = setTimeout(async () => {
            console.log(`--Voice chat time limit (${timeLimit}s) reached, initiating disconnect`);

            // Set the shutdown flag to true to stop processing new user audio
            isVoiceChatShuttingDown = true;
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

// Add a function to manually set the shutdown status (useful for other parts of the code)
function setVoiceChatShutdownStatus(status) {
    isVoiceChatShuttingDown = status;
    console.log(`--Voice chat shutdown status set to: ${status}`);
}

module.exports = {
    setupRealtimeVoiceWS,
    injectMessageGetResponse,
    streamOpenAIAudio,
    updateSessionParams,
    streamUserAudioToOpenAI,
    handleJoinVoiceChannel,
    gracefulDisconnect,
    setupVoiceChatTimeLimit,
    setVoiceChatShutdownStatus,
    truncateAudio // Export the truncate function for potential external use
};
