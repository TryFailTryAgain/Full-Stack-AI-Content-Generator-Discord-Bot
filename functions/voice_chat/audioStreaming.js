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
const { cancelResponse, startSilenceStream, stopSilenceStream } = require('./openaiControl.js');

// Custom PCM-16LE mono sum-and-average mixer
class PCMMonoMixer {
    constructor(ws, options = {}) {
        this.ws = ws;
        this.buffers = new Map();
        this.sampleRate = options.sampleRate || 24000;
        this.frameMs = options.frameMs || 20;
        this.flushIntervalMs = options.flushIntervalMs || 20;
        this.maxBufferedFrames = options.maxBufferedFrames || 50;
        this.frameSizeBytes = Math.floor((this.sampleRate * this.frameMs / 1000) * 2);
        if (this.frameSizeBytes % 2 !== 0) this.frameSizeBytes -= 1;
        this.flushTimer = null;
    }

    start() {
        if (this.flushTimer) return;
        this.flushTimer = setInterval(() => this.mixAndSend(), this.flushIntervalMs);
    }

    stop() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        this.buffers.clear();
    }

    updateBuffer(userId, chunk) {
        if (!Buffer.isBuffer(chunk) || chunk.length === 0) return;
        const prev = this.buffers.get(userId) || Buffer.alloc(0);
        let merged = Buffer.concat([prev, chunk]);
        const maxBytes = this.frameSizeBytes * this.maxBufferedFrames;
        if (merged.length > maxBytes) {
            merged = merged.subarray(merged.length - maxBytes);
        }
        this.buffers.set(userId, merged);
    }

    removeBuffer(userId) { this.buffers.delete(userId); }

    mixAndSend() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.buffers.size === 0) return;

        const mixed = Buffer.alloc(this.frameSizeBytes);
        let contributorCount = 0;

        for (const [userId, buffer] of this.buffers.entries()) {
            if (!buffer || buffer.length === 0) continue;
            contributorCount += 1;

            const readLength = Math.min(this.frameSizeBytes, buffer.length - (buffer.length % 2));
            for (let i = 0; i < this.frameSizeBytes; i += 2) {
                const existing = mixed.readInt16LE(i);
                const sample = i < readLength ? buffer.readInt16LE(i) : 0;
                let sum = existing + sample;
                sum = Math.max(-32768, Math.min(32767, sum));
                mixed.writeInt16LE(sum, i);
            }

            this.buffers.set(userId, buffer.subarray(readLength));
        }

        if (contributorCount === 0) return;

        for (let i = 0; i < this.frameSizeBytes; i += 2) {
            const value = mixed.readInt16LE(i);
            const avg = Math.max(-32768, Math.min(32767, Math.trunc(value / contributorCount)));
            mixed.writeInt16LE(avg, i);
        }

        this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: mixed.toString('base64') }));
    }
}

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

    // Listen for WebSocket messages that contain audio related data
    ws.on("message", message => {
        const serverMessage = JSON.parse(message);
        if (serverMessage.type === "conversation.item.created" && serverMessage.item.role === "assistant") {
            // Track response item ID when we get it
            currentAudioState.responseItemId = serverMessage.item.id;
            console.log(`-Tracking response item ID: ${currentAudioState.responseItemId}, role: ${serverMessage.item.role}`);
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
    });

    console.log("--Ready to stream OpenAI audio to Discord");
}


// Stream user audio from Discord to OpenAI
function streamUserAudioToOpenAI(connection, ws, noInterruptions = false, interaction) {
    const { EndBehaviorType } = require('@discordjs/voice');
    const currentAudioState = state.currentAudioState;

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
    const endTimers = new Map();
    const SPEAKER_END_DEBOUNCE_MS = 250;

    // Local variable to track the active silence stream control
    let silenceControl = null;

    // Initialize our custom mixer
    const mixer = new PCMMonoMixer(ws);
    mixer.start();

    connection.receiver.speaking.on("start", userId => {
                // If an end debounce timer exists, cancel cleanup because user resumed speaking
                if (endTimers.has(userId)) {
                    clearTimeout(endTimers.get(userId));
                    endTimers.delete(userId);
                }

        // Don't process new speakers if shutting down
        if (state.isVoiceChatShuttingDown) {
            console.log(`--User ${userId} started speaking, but voice chat is shutting down. Ignoring audio input.`);
            return;
        }
        // If we are in no interruptions mode and the AI is currently speaking,
        // we still ignore this as an interruption signal. We will continue to
        // capture audio only if desired by upstream logic. Interruption is now
        // driven solely by the Realtime API speech_started event.
        if (noInterruptions && currentAudioState.isPlaying) {
            console.log(`-No interruptions mode active - allowing AI to finish speaking`);
        }

        // If user is already being processed, don't create another pipeline
        if (activeSpeakers.has(userId)) {
            console.log(`--User ${userId} already has an active speaking session. Ignoring duplicate.`);
            return;
        }

        console.log(`--User ${userId} started speaking`);

        // User started speaking: cancel any active silence stream
        if (silenceControl) {
            stopSilenceStream(silenceControl);
            silenceControl = null;
        }

        // Subscribe to user's Opus stream (manual end) and decode to PCM16 mono
        const opusStream = connection.receiver.subscribe(userId, {
            end: { behavior: EndBehaviorType.Manual }
        });
        const decoderStream = new OpusDecoderStream();
        const pcmStream = opusStream.pipe(decoderStream);
        // Prevent unhandled stream errors
        opusStream.on('error', err => { console.error(`OpusStream error for user ${userId}:`, err); cleanup(userId); });
        decoderStream.on('error', err => { console.error(`DecoderStream error for user ${userId}:`, err); cleanup(userId); });
        pcmStream.on('error', err => { console.error(`PCMStream error for user ${userId}:`, err); cleanup(userId); });

        // Track streams and timestamp for interruption and cleanup
        activeSpeakers.set(userId, {
            opusStream,
            decoderStream,
            pcmStream,
            timestamp: Date.now()
        });

        // On each PCM chunk, feed directly to mixer. Interruption is handled by
        // the Realtime API's VAD via input_audio_buffer.speech_started.
        pcmStream.on('data', chunk => {
            if (!activeSpeakers.has(userId) || state.isVoiceChatShuttingDown) return;
            mixer.updateBuffer(userId, chunk);
        });

    });

    // Handle stop speaking event to properly clean up resources
    connection.receiver.speaking.on("end", userId => {
        console.log(`--User ${userId} stopped speaking. Scheduling cleanup.`);

        if (endTimers.has(userId)) {
            clearTimeout(endTimers.get(userId));
        }

        const timerId = setTimeout(() => {
            // cleanup mixer buffer and user streams
            mixer.removeBuffer(userId);
            cleanup(userId);
            endTimers.delete(userId);

            // Check if any users are still speaking
            if (activeSpeakers.size === 0) {
                console.log(`-No one is currently speaking, starting silence stream`);
                if (silenceControl) {
                    stopSilenceStream(silenceControl);
                }
                silenceControl = startSilenceStream(ws);
            }
        }, SPEAKER_END_DEBOUNCE_MS);

        endTimers.set(userId, timerId);
    });

    // Clean up function ensure we track and clean up resources for each user
    function cleanup(userId) {
        if (endTimers.has(userId)) {
            clearTimeout(endTimers.get(userId));
            endTimers.delete(userId);
        }

        if (activeSpeakers.has(userId)) {
            console.log(`-Cleaning up resources for user ${userId}`);
            const speakerData = activeSpeakers.get(userId);
            try {
                if (speakerData.pcmStream) speakerData.pcmStream.destroy();
                if (speakerData.decoderStream) speakerData.decoderStream.destroy();
                if (speakerData.opusStream) speakerData.opusStream.destroy();
            } catch (err) {
                console.error(`-Error cleaning up streams for user ${userId}:`, err);
            }
            activeSpeakers.delete(userId);
        }
    }

    function cleanupAll() {
        for (const timerId of endTimers.values()) {
            clearTimeout(timerId);
        }
        endTimers.clear();

        for (const userId of Array.from(activeSpeakers.keys())) {
            mixer.removeBuffer(userId);
            cleanup(userId);
        }

        if (silenceControl) {
            stopSilenceStream(silenceControl);
            silenceControl = null;
        }

        mixer.stop();
    }

    // Listen for server-side speech detection and use it to drive interruption behavior
    ws.on('message', (message) => {
        try {
            const serverMessage = JSON.parse(message);
            if (serverMessage.type === 'input_audio_buffer.speech_started') {
                console.log('--Realtime VAD detected speech_started');
                if (state.isVoiceChatShuttingDown) return;

                // Only interrupt if we are allowed to interrupt
                if (!noInterruptions && currentAudioState.responseItemId && currentAudioState.isPlaying) {
                    console.log('-Interrupting current assistant audio due to speech_started');
                    cancelResponse(ws);
                    truncateAudio(ws, currentAudioState.responseItemId);
                }
            }
        } catch (err) {
            // Ignore non-JSON or unrelated messages
        }
    });

    ws.on('close', () => cleanupAll());
    ws.on('error', () => cleanupAll());
}


module.exports = {
    truncateAudio,
    streamOpenAIAudio,
    streamUserAudioToOpenAI
};
