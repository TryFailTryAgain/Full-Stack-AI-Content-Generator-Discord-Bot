/*
* tts_providers/qwen3tts.js
* Qwen3-TTS provider using Replicate API
* Supports voice cloning, custom voices, and voice design
* 
* Streams audio directly from Replicate's FileOutput for lowest latency
*/
const Replicate = require('replicate');
const axios = require('axios');
const { spawn } = require('child_process');
const { PassThrough, Readable } = require('stream');
const { createAudioResource, createAudioPlayer, StreamType, AudioPlayerStatus } = require('@discordjs/voice');
const { playbackState } = require('../voiceGlobalState.js');

const PROVIDER_NAME = 'qwen3tts';
const MODEL_ID = 'qwen/qwen3-tts';

function requireEnvVar(name, { allowEmpty = false } = {}) {
    const value = process.env[name];
    if (value === undefined || value === null) {
        throw new Error(`[TTS:Qwen3] Missing required environment variable: ${name}`);
    }

    if (!allowEmpty && String(value).trim() === '') {
        throw new Error(`[TTS:Qwen3] Environment variable ${name} cannot be empty`);
    }

    return value;
}

// Available preset speakers for custom_voice mode
const PRESET_SPEAKERS = [
    'Aiden', 'Aria', 'Bella', 'Callum', 'Charlotte', 'Dylan', 'Ella', 'Grace',
    'Harry', 'Isabella', 'Jack', 'Liam', 'Mia', 'Noah', 'Olivia', 'Sophia'
];

/**
 * Get Replicate client instance
 */
function getReplicateClient() {
    const apiToken = process.env.API_KEY_REPLICATE;
    if (!apiToken) {
        throw new Error('[TTS:Qwen3] API_KEY_REPLICATE environment variable is not set');
    }
    return new Replicate({ auth: apiToken });
}

/**
 * Build input parameters for Qwen3-TTS based on configuration
 * @param {string} text - Text to synthesize
 * @param {Object} options - TTS options
 * @returns {Object} Input parameters for Replicate
 */
function buildInputParams(text, options = {}) {
    const mode = requireEnvVar('QWEN3_TTS_MODE');
    const language = requireEnvVar('QWEN3_TTS_LANGUAGE');
    
    const input = {
        text: text,
        mode: mode,
        language: language
    };

    // Add style instruction if provided
    const styleInstruction = options.styleInstruction || process.env.QWEN3_TTS_STYLE_INSTRUCTION;
    if (styleInstruction) {
        input.style_instruction = styleInstruction;
    }

    switch (mode) {
        case 'custom_voice':
            // Use preset speaker
            input.speaker = options.speaker || requireEnvVar('QWEN3_TTS_SPEAKER');
            if (!PRESET_SPEAKERS.includes(input.speaker)) {
                throw new Error(`[TTS:Qwen3] Invalid QWEN3_TTS_SPEAKER: ${input.speaker}`);
            }
            break;

        case 'voice_clone':
            // Use reference audio for cloning
            const refAudio = options.referenceAudio || process.env.QWEN3_TTS_REFERENCE_AUDIO;
            if (!refAudio) {
                throw new Error('[TTS:Qwen3] voice_clone mode requires QWEN3_TTS_REFERENCE_AUDIO');
            }
            input.reference_audio = refAudio;
            
            const refText = options.referenceText || process.env.QWEN3_TTS_REFERENCE_TEXT;
            if (refText) {
                input.reference_text = refText;
            }
            break;

        case 'voice_design':
            // Create voice from description
            const voiceDesc = options.voiceDescription || process.env.QWEN3_TTS_VOICE_DESCRIPTION;
            if (!voiceDesc) {
                throw new Error('[TTS:Qwen3] voice_design mode requires QWEN3_TTS_VOICE_DESCRIPTION');
            }
            input.voice_description = voiceDesc;
            break;

        default:
            throw new Error(`[TTS:Qwen3] Invalid QWEN3_TTS_MODE: ${mode}`);
    }

    return input;
}

/**
 * Stream audio from a ReadableStream (FileOutput) to Discord
 * This provides the lowest latency by starting playback as soon as chunks arrive
 * @param {ReadableStream|Readable} audioStream - The audio stream from Replicate
 * @param {Object} connection - Discord voice connection
 * @param {number} requestStart - Timestamp when request started
 * @returns {Promise<void>}
 */
async function streamToDiscord(audioStream, connection, requestStart, callbacks = {}) {
    let settled = false;

    const deferred = {};
    deferred.promise = new Promise((resolve, reject) => {
        deferred.resolve = resolve;
        deferred.reject = reject;
    });

    const input = new PassThrough();
    let firstChunkLogged = false;

    // FFmpeg to convert to Discord format (48kHz stereo s16le)
    const ff = spawn('ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-i', 'pipe:0',
        '-f', 's16le', '-ar', '48000', '-ac', '2',
        'pipe:1'
    ]);

    input.pipe(ff.stdin);
    ff.stdin.on('error', () => { });

    const player = createAudioPlayer();
    let playbackInitialized = false;

    // Start playback as soon as first chunk is received for lowest latency
    const startPlayback = () => {
        if (playbackInitialized) return;
        playbackInitialized = true;
        callbacks.onAudioStart?.({ provider: PROVIDER_NAME });
        const resource = createAudioResource(ff.stdout, { inputType: StreamType.Raw });
        player.play(resource);
        connection.subscribe(player);
        playbackState.player = player;
        playbackState.isPlaying = true;
        playbackState.startTimestamp = Date.now();
    };

    const cleanup = () => {
        playbackState.isPlaying = false;
        if (playbackState.player === player) {
            playbackState.player = null;
        }
        try { input.destroy(); } catch { }
        try { ff.kill('SIGKILL'); } catch { }
    };

    const resolveOnce = () => {
        if (settled) return;
        settled = true;
        cleanup();
        callbacks.onPlaybackEnd?.({ provider: PROVIDER_NAME, ok: true });
        deferred.resolve();
    };

    const rejectOnce = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        callbacks.onPlaybackEnd?.({ provider: PROVIDER_NAME, ok: false, error: err });
        deferred.reject(err);
    };

    ff.once('error', err => {
        console.error('[TTS:Qwen3] FFmpeg error:', err);
        rejectOnce(err);
    });

    player.once('error', err => {
        console.error('[TTS:Qwen3] Player error:', err);
        rejectOnce(err);
    });

    player.once(AudioPlayerStatus.Idle, resolveOnce);

    // Handle the stream - FileOutput from Replicate is a ReadableStream (web streams API)
    // We need to consume it and pipe to our PassThrough
    try {
        // Check if it's a web ReadableStream (has getReader) or Node.js Readable
        if (typeof audioStream.getReader === 'function') {
            // Web ReadableStream - use async iteration
            const reader = audioStream.getReader();
            
            const pump = async () => {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        
                        if (done) {
                            console.log('[TTS:Qwen3] Stream complete');
                            input.end();
                            break;
                        }
                        
                        if (!firstChunkLogged) {
                            firstChunkLogged = true;
                            const latency = Date.now() - requestStart;
                            console.log(`[TTS:Qwen3] First audio chunk received: ${latency}ms`);
                            startPlayback();
                        }
                        
                        if (!settled && !input.destroyed && !input.writableEnded) {
                            input.write(Buffer.from(value));
                        }
                    }
                } catch (err) {
                    console.error('[TTS:Qwen3] Stream read error:', err);
                    rejectOnce(err);
                }
            };
            
            pump();
        } else if (typeof audioStream.on === 'function') {
            // Node.js Readable stream
            audioStream.on('data', chunk => {
                if (!firstChunkLogged) {
                    firstChunkLogged = true;
                    const latency = Date.now() - requestStart;
                    console.log(`[TTS:Qwen3] First audio chunk received: ${latency}ms`);
                    startPlayback();
                }
                if (!settled && !input.destroyed && !input.writableEnded) {
                    input.write(chunk);
                }
            });

            audioStream.on('end', () => {
                console.log('[TTS:Qwen3] Stream complete');
                input.end();
            });

            audioStream.once('error', err => {
                console.error('[TTS:Qwen3] Stream error:', err?.message || err);
                rejectOnce(err);
            });
        } else {
            throw new Error('[TTS:Qwen3] Unknown stream type received');
        }
    } catch (err) {
        rejectOnce(err);
    }

    return deferred.promise;
}

/**
 * Stream audio from URL and pipe to Discord (fallback method)
 * @param {string} audioUrl - URL to the audio file
 * @param {Object} connection - Discord voice connection
 * @param {number} requestStart - Timestamp when request started
 * @returns {Promise<void>}
 */
async function streamAudioFromUrl(audioUrl, connection, requestStart, callbacks = {}) {
    let settled = false;

    const deferred = {};
    deferred.promise = new Promise((resolve, reject) => {
        deferred.resolve = resolve;
        deferred.reject = reject;
    });

    // Stream audio from URL
    const resp = await axios.get(audioUrl, {
        responseType: 'stream',
        timeout: 60000
    });

    const input = new PassThrough();
    let firstChunkLogged = false;

    // FFmpeg to convert to Discord format (48kHz stereo s16le)
    const ff = spawn('ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-i', 'pipe:0',
        '-f', 's16le', '-ar', '48000', '-ac', '2',
        'pipe:1'
    ]);

    input.pipe(ff.stdin);
    ff.stdin.on('error', () => { });

    const player = createAudioPlayer();
    let playbackInitialized = false;

    const startPlayback = () => {
        if (playbackInitialized) return;
        playbackInitialized = true;
        callbacks.onAudioStart?.({ provider: PROVIDER_NAME });
        const resource = createAudioResource(ff.stdout, { inputType: StreamType.Raw });
        player.play(resource);
        connection.subscribe(player);
        playbackState.player = player;
        playbackState.isPlaying = true;
        playbackState.startTimestamp = Date.now();
    };

    const cleanup = () => {
        playbackState.isPlaying = false;
        if (playbackState.player === player) {
            playbackState.player = null;
        }
        try { input.destroy(); } catch { }
        try { resp.data.destroy(); } catch { }
        try { ff.kill('SIGKILL'); } catch { }
    };

    const resolveOnce = () => {
        if (settled) return;
        settled = true;
        cleanup();
        callbacks.onPlaybackEnd?.({ provider: PROVIDER_NAME, ok: true });
        deferred.resolve();
    };

    const rejectOnce = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        callbacks.onPlaybackEnd?.({ provider: PROVIDER_NAME, ok: false, error: err });
        deferred.reject(err);
    };

    resp.data.on('end', () => {
        if (!settled) {
            console.log('[TTS:Qwen3] Audio stream ended');
            input.end();
        }
    });

    resp.data.once('error', err => {
        console.error('[TTS:Qwen3] Stream error:', err?.message || err);
        rejectOnce(err);
    });

    ff.once('error', err => {
        console.error('[TTS:Qwen3] FFmpeg error:', err);
        rejectOnce(err);
    });

    player.once('error', err => {
        console.error('[TTS:Qwen3] Player error:', err);
        rejectOnce(err);
    });

    player.once(AudioPlayerStatus.Idle, resolveOnce);

    resp.data.on('data', chunk => {
        if (!firstChunkLogged) {
            firstChunkLogged = true;
            const latency = Date.now() - requestStart;
            console.log(`[TTS:Qwen3] First audio chunk from URL: ${latency}ms`);
            startPlayback();
        }
        if (!settled && !input.destroyed && !input.writableEnded) {
            input.write(chunk);
        }
    });

    return deferred.promise;
}

/**
 * Stream audio from the Replicate file stream URL
 * This URL provides audio data as it's being generated for lowest latency
 * @param {string} streamUrl - The stream URL from prediction.urls.stream
 * @param {Object} connection - Discord voice connection
 * @param {number} requestStart - Timestamp when request started
 * @returns {Promise<void>}
 */
async function streamFromReplicateUrl(streamUrl, connection, requestStart, callbacks = {}) {
    let settled = false;

    const deferred = {};
    deferred.promise = new Promise((resolve, reject) => {
        deferred.resolve = resolve;
        deferred.reject = reject;
    });

    console.log(`[TTS:Qwen3] Connecting to stream URL...`);

    // Stream audio from the Replicate stream URL
    // This provides data as it's being generated
    const resp = await axios.get(streamUrl, {
        responseType: 'stream',
        timeout: 120000, // Long timeout for generation
        headers: {
            'Accept': '*/*'
        }
    });

    const input = new PassThrough();
    let firstChunkLogged = false;
    let totalBytes = 0;

    // FFmpeg to convert to Discord format (48kHz stereo s16le)
    const ff = spawn('ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-i', 'pipe:0',
        '-f', 's16le', '-ar', '48000', '-ac', '2',
        'pipe:1'
    ]);

    input.pipe(ff.stdin);
    ff.stdin.on('error', () => { });

    const player = createAudioPlayer();
    let playbackInitialized = false;

    const startPlayback = () => {
        if (playbackInitialized) return;
        playbackInitialized = true;
        callbacks.onAudioStart?.({ provider: PROVIDER_NAME });
        const resource = createAudioResource(ff.stdout, { inputType: StreamType.Raw });
        player.play(resource);
        connection.subscribe(player);
        playbackState.player = player;
        playbackState.isPlaying = true;
        playbackState.startTimestamp = Date.now();
    };

    const cleanup = () => {
        playbackState.isPlaying = false;
        if (playbackState.player === player) {
            playbackState.player = null;
        }
        try { input.destroy(); } catch { }
        try { resp.data.destroy(); } catch { }
        try { ff.kill('SIGKILL'); } catch { }
    };

    const resolveOnce = () => {
        if (settled) return;
        settled = true;
        console.log(`[TTS:Qwen3] Stream complete, total bytes: ${totalBytes}`);
        cleanup();
        callbacks.onPlaybackEnd?.({ provider: PROVIDER_NAME, ok: true });
        deferred.resolve();
    };

    const rejectOnce = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        callbacks.onPlaybackEnd?.({ provider: PROVIDER_NAME, ok: false, error: err });
        deferred.reject(err);
    };

    resp.data.on('end', () => {
        if (!settled) {
            console.log('[TTS:Qwen3] Stream ended');
            input.end();
        }
    });

    resp.data.once('error', err => {
        console.error('[TTS:Qwen3] Stream error:', err?.message || err);
        rejectOnce(err);
    });

    ff.once('error', err => {
        console.error('[TTS:Qwen3] FFmpeg error:', err);
        rejectOnce(err);
    });

    player.once('error', err => {
        console.error('[TTS:Qwen3] Player error:', err);
        rejectOnce(err);
    });

    player.once(AudioPlayerStatus.Idle, resolveOnce);

    resp.data.on('data', chunk => {
        totalBytes += chunk.length;
        
        if (!firstChunkLogged) {
            firstChunkLogged = true;
            const latency = Date.now() - requestStart;
            console.log(`[TTS:Qwen3] First audio chunk received: ${latency}ms (${chunk.length} bytes)`);
            startPlayback();
        }
        
        if (!settled && !input.destroyed && !input.writableEnded) {
            input.write(chunk);
        }
    });

    return deferred.promise;
}

/**
 * Synthesizes text to speech using Qwen3-TTS via Replicate and streams to Discord
 * Uses prediction streaming for lowest possible latency - starts playing as audio generates
 * @param {string} text - Text to synthesize
 * @param {Object} connection - Discord voice connection
 * @param {Object} options - TTS options
 * @returns {Promise<void>}
 */
async function synthesizeAndPlay(text, connection, options = {}) {
    if (!text || !text.trim()) return;

    const { noInterruptions } = options;

    // Stop existing playback unless noInterruptions is set
    if (!noInterruptions && playbackState.isPlaying && playbackState.player) {
        try { playbackState.player.stop(); } catch { }
    }

    const requestStart = Date.now();
    const inputParams = buildInputParams(text.trim(), options);
    options.onSynthesisStart?.({ provider: PROVIDER_NAME });
    
    console.log(`[TTS:Qwen3] Requesting: mode=${inputParams.mode}, speaker=${inputParams.speaker || 'N/A'}`);

    try {
        const replicate = getReplicateClient();

        // Use predictions.create() instead of run() to get the stream URL immediately
        // This allows us to start streaming audio as it's being generated
        const prediction = await replicate.predictions.create({
            model: MODEL_ID,
            input: inputParams
        });

        const createLatency = Date.now() - requestStart;
        console.log(`[TTS:Qwen3] Prediction created in ${createLatency}ms, id: ${prediction.id}`);

        // Check if we have a stream URL - this is the key for low latency
        if (prediction.urls && prediction.urls.stream) {
            console.log(`[TTS:Qwen3] Stream URL available, starting streaming playback...`);
            
            // Start streaming from the URL immediately
            // The stream will provide audio data as it's generated
            await streamFromReplicateUrl(prediction.urls.stream, connection, requestStart, {
                onAudioStart: options.onAudioStart,
                onPlaybackEnd: options.onPlaybackEnd
            });
            
        } else {
            // Fallback: wait for prediction to complete and stream from output URL
            console.log('[TTS:Qwen3] No stream URL, falling back to polling...');
            
            // Poll for completion
            let completedPrediction = prediction;
            while (completedPrediction.status !== 'succeeded' && completedPrediction.status !== 'failed') {
                await new Promise(resolve => setTimeout(resolve, 500));
                completedPrediction = await replicate.predictions.get(prediction.id);
            }
            
            if (completedPrediction.status === 'failed') {
                throw new Error(`[TTS:Qwen3] Prediction failed: ${completedPrediction.error}`);
            }
            
            const output = completedPrediction.output;
            if (!output) {
                throw new Error('[TTS:Qwen3] No output received from model');
            }

            const modelLatency = Date.now() - requestStart;
            console.log(`[TTS:Qwen3] Model completed in ${modelLatency}ms`);

            // Stream from output URL
            const audioUrl = typeof output === 'string' ? output : output.toString();
            await streamAudioFromUrl(audioUrl, connection, requestStart, {
                onAudioStart: options.onAudioStart,
                onPlaybackEnd: options.onPlaybackEnd
            });
        }

    } catch (error) {
        console.error('[TTS:Qwen3] Synthesis failed:', error?.message || error);
        throw error;
    }
}

module.exports = {
    name: PROVIDER_NAME,
    synthesizeAndPlay,
    PRESET_SPEAKERS
};
