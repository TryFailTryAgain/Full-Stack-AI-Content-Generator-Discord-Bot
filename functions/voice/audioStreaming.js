/* 
* File: audioStreaming.js
* Author: TryFailTryAgain
* Copyright (c) 2025. All rights reserved. For use in Open-Source projects this
* may be freely copied or excerpted with credit to the author.
*/
const { PassThrough, Transform } = require('stream');
const { createAudioPlayer, createAudioResource, StreamType } = require('@discordjs/voice');
const { OpusEncoder } = require('@discordjs/opus');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const state = require('./voiceGlobalState.js');

// Truncate currently playing audio
function truncateAudio(ws, itemId) {
    const currentAudioState = state.currentAudioState;

    if (!itemId || !currentAudioState.startTimestamp || !currentAudioState.isPlaying) {
        console.log("No active audio to truncate");
        return;
    }

    // Calculate how long the audio has been playing
    const audioPlayedMs = Date.now() - currentAudioState.startTimestamp;

    console.log(`-Truncating audio ${itemId} after ${audioPlayedMs}ms of playback`);
    try {
        // 1. First stop the player (this stops the consumption from ffmpeg output)
        if (currentAudioState.player) {
            currentAudioState.player.stop();
        }
        // 2. Mark as not playing to prevent further operations
        currentAudioState.isPlaying = false;

        // 3. Send truncation event to OpenAI with the audio end time
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                "type": "conversation.item.truncate",
                "item_id": itemId,
                "content_index": 0,
                "audio_end_ms": audioPlayedMs
            }));
        }

        // 4. Safely end the audio stream
        if (currentAudioState.audioStream) {
            currentAudioState.audioStream.end();
            // Detach all event listeners to prevent further writes
            currentAudioState.audioStream.removeAllListeners();
            // Unset to prevent accidental writes
            currentAudioState.audioStream = null;
        }

        // 5. Terminate ffmpeg process if it exists
        if (currentAudioState.ffmpeg) {
            // First try graceful termination
            try {
                currentAudioState.ffmpeg.stdin.end();
            } catch (err) {
                // Ignore errors at this point
            }
            // Then force kill to ensure clean shutdown
            try {
                if (currentAudioState.ffmpeg) {
                    currentAudioState.ffmpeg.kill('SIGKILL');
                    currentAudioState.ffmpeg = null;
                }
            } catch (err) {
                // Ignore errors at this point
            }
        }
    } catch (err) {
        console.error("Error during audio truncation:", err);
    }
}

// Stream audio from OpenAI to Discord
function streamOpenAIAudio(ws, connection, noInterruptions = false) {
    let currentResponseId = null;
    let audioStream = null;
    let ffmpeg = null;
    let player = null;
    let audioBuffer = Buffer.alloc(0);
    const currentAudioState = state.currentAudioState;

    // Reset the audio state
    Object.assign(currentAudioState, {
        responseItemId: null,
        startTimestamp: null,
        isPlaying: false,
        player: null,
        audioStream: null,
        ffmpeg: null
    });

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
        audioStream = new PassThrough();
        currentAudioState.audioStream = audioStream;

        /* Set up a new FFmpeg process. This happens as a co-process so it can run asynchronously. 
           Needs stereo output for Discord. Without stereo, Discord plays mono audio at 2x 
           speed and twice the pitch.*/
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
        // Pipe the audioStream to ffmpeg.stdin
        audioStream.pipe(ffmpeg.stdin);
        // Log but ignore a reoccurring error when the stream is closed unexpectedly
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
            console.log("-Audio playback finished");
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

            // Track response item ID when we get it
            if (serverMessage.type === "response.created") {
                currentAudioState.responseItemId = serverMessage.response.id;
                console.log(`-Tracking response item ID: ${currentAudioState.responseItemId}`);
                /* If we are in no interruptions mode, we need to set the isPlaying flag to true
                as soon as we get audio data arriving to prevent cutting off the audio stream before it has been
                transcoded and played on Discord. */
                if (noInterruptions) {
                    currentAudioState.isPlaying = true;
                }
            }
            // Check for truncation confirmation
            if (serverMessage.type === "conversation.item.truncated") {
                console.log(`-Server confirmed audio truncation for item ${serverMessage.item_id}`);
            }

            // Handle audio delta messages with error handling
            if (serverMessage.type === "response.audio.delta" && serverMessage.delta) {
                const audioChunk = Buffer.from(serverMessage.delta, 'base64');

                // Case 1: No active pipeline yet for this response
                if (currentResponseId === null || currentAudioState.responseItemId !== currentResponseId) {
                    setupNewPipeline(currentAudioState.responseItemId);
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
                    console.log("Ending audio stream to ffmpeg");
                }
                console.log("-Response complete. Ready for next response.");
                currentResponseId = null;
            }

        } catch (err) {
            console.error("Error while receiving audio:", err);
        }
    });

    console.log("--Ready to stream OpenAI audio to Discord");
}


// Stream user audio from Discord to OpenAI
function streamUserAudioToOpenAI(connection, ws, noInterruptions = false) {
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
    const currentAudioState = state.currentAudioState;

    connection.receiver.speaking.on("start", userId => {
        // Don't process new speakers if shutting down
        if (state.isVoiceChatShuttingDown) {
            console.log(`--User ${userId} started speaking, but voice chat is shutting down. Ignoring audio input.`);
            return;
        }
        // If we are in no interruptions mode, just ignore this event.
        if (noInterruptions && currentAudioState.isPlaying) {
            console.log(`-No interruptions mode active - allowing AI to finish speaking`);
            return;
        }

        // If user is already being processed, don't create another pipeline
        if (activeSpeakers.has(userId)) {
            console.log(`--User ${userId} already has an active speaking session. Ignoring duplicate.`);
            return;
        }

        console.log(`--User ${userId} started speaking`);

        // Create a fresh decoder stream for each speaking session
        const decoderStream = new OpusDecoderStream();

        // Subscribe to the user's opus audio stream.
        const opusStream = connection.receiver.subscribe(userId, {
            end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 }
        });

        // Pipe the opus stream through the decoder to get PCM16 @24000 Hz mono.
        const pcmStream = opusStream.pipe(decoderStream);
        let bufferData = Buffer.alloc(0);

        // Add user to active speakers list with timestamp
        activeSpeakers.set(userId, {
            timestamp: Date.now(),
            streams: { opusStream, decoderStream, pcmStream },
            firstPass: true,
            interruptionDelayTime: Date.now()
        });

        pcmStream.on('data', chunk => {
            if (!activeSpeakers.has(userId) || state.isVoiceChatShuttingDown) {
                return; // Skip processing if no longer active
            }

            // Set the speaker
            const speakerData = activeSpeakers.get(userId);
            // Combine any past unsent data with the new chunk
            bufferData = Buffer.concat([bufferData, chunk]);

            /* Send data, cancel any in-progress response from OpenAI, and truncate the past 
            response if needed when we reach the chunk size and the interruption delay has passed */
                // Cancel any in-progress response when a user starts speaking
                if (currentAudioState.responseItemId && speakerData.firstPass && currentAudioState.isPlaying) {
                    console.log(`--Cancelling any in-progress response as the user has started speaking past the interruption delay`);
                    ws.send(JSON.stringify({
                        type: 'response.cancel'
                    }));
                    truncateAudio(ws, currentAudioState.responseItemId);
                }
                speakerData.firstPass = false;
                // Finish by sending the chunk
                const sendChunk = bufferData;
                bufferData = Buffer.alloc(0);

                ws.send(JSON.stringify({
                    type: 'input_audio_buffer.append',
                    audio: sendChunk.toString('base64')
                }));
                console.log(`-Sent input_audio_buffer.append chunk: }${sendChunk.length} bytes`);
            }
        });

        // When the stream ends, send any leftover data.
        pcmStream.on('end', () => {
            if (activeSpeakers.has(userId)) {
                console.log(`--User ${userId} finished speaking`);
                // Clean up and remove from active speakers
                activeSpeakers.delete(userId);
            }
        });

        // Add error handlers to prevent crashes
        opusStream.on('error', (error) => {
            console.error(`Opus stream error for user ${userId}:`, error);
            cleanup(userId);
        });

        decoderStream.on('error', (error) => {
            console.error(`Decoder stream error for user ${userId}:`, error);
            cleanup(userId);
        });

        pcmStream.on('error', (error) => {
            console.error(`PCM stream error for user ${userId}:`, error);
            cleanup(userId);
        });
    });

    // Handle stop speaking event to properly clean up resources
    connection.receiver.speaking.on("end", userId => {
        console.log(`--User ${userId} stopped speaking. Cleaning up.`);
        cleanup(userId);
    });

    // Clean up function to handle errors
    function cleanup(userId) {
        if (activeSpeakers.has(userId)) {
            console.log(`-Cleaning up resources for user ${userId}`);
            const { streams } = activeSpeakers.get(userId);

            try {
                if (streams.opusStream) streams.opusStream.destroy();
                if (streams.decoderStream) streams.decoderStream.destroy();
                if (streams.pcmStream) streams.pcmStream.destroy();
            } catch (err) {
                console.error(`-Error cleaning up streams for user ${userId}:`, err);
            }
            activeSpeakers.delete(userId);
        }
    }
}


module.exports = {
    truncateAudio,
    streamOpenAIAudio,
    streamUserAudioToOpenAI
};
