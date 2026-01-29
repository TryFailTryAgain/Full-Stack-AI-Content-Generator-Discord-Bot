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
    const mode = process.env.QWEN3_TTS_MODE || 'custom_voice';
    const language = process.env.QWEN3_TTS_LANGUAGE || 'auto';
    
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
            input.speaker = options.speaker || process.env.QWEN3_TTS_SPEAKER || 'Aiden';
            if (!PRESET_SPEAKERS.includes(input.speaker)) {
                console.warn(`[TTS:Qwen3] Unknown speaker "${input.speaker}", defaulting to Aiden`);
                input.speaker = 'Aiden';
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
            console.warn(`[TTS:Qwen3] Unknown mode "${mode}", defaulting to custom_voice`);
            input.mode = 'custom_voice';
            input.speaker = 'Aiden';
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
async function streamToDiscord(audioStream, connection, requestStart) {
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
        deferred.resolve();
    };

    const rejectOnce = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
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
async function streamAudioFromUrl(audioUrl, connection, requestStart) {
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
        deferred.resolve();
    };

    const rejectOnce = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
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
 * Synthesizes text to speech using Qwen3-TTS via Replicate and streams to Discord
 * Uses FileOutput streaming for lowest possible latency
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
    
    console.log(`[TTS:Qwen3] Requesting: mode=${inputParams.mode}, speaker=${inputParams.speaker || 'N/A'}`);

    try {
        const replicate = getReplicateClient();

        // Run the model - replicate.run() returns a FileOutput which is a ReadableStream
        // This allows us to stream the audio as it's generated
        const output = await replicate.run(MODEL_ID, { input: inputParams });

        if (!output) {
            throw new Error('[TTS:Qwen3] No output received from model');
        }

        const modelLatency = Date.now() - requestStart;
        console.log(`[TTS:Qwen3] Model responded in ${modelLatency}ms`);

        // Check if output is a FileOutput (ReadableStream) or a URL string
        if (output && typeof output.getReader === 'function') {
            // FileOutput - stream directly for lowest latency
            console.log('[TTS:Qwen3] Streaming from FileOutput...');
            await streamToDiscord(output, connection, requestStart);
        } else if (output && typeof output.url === 'function') {
            // FileOutput with url() method - get the URL and stream from there
            const audioUrl = output.url();
            console.log(`[TTS:Qwen3] Streaming from URL: ${audioUrl}`);
            await streamAudioFromUrl(audioUrl, connection, requestStart);
        } else if (typeof output === 'string') {
            // Plain URL string - stream from the URL
            console.log(`[TTS:Qwen3] Streaming from URL string...`);
            await streamAudioFromUrl(output, connection, requestStart);
        } else if (output && typeof output.toString === 'function') {
            // Fallback - try to get URL from toString
            const audioUrl = output.toString();
            if (audioUrl.startsWith('http')) {
                console.log(`[TTS:Qwen3] Streaming from converted URL...`);
                await streamAudioFromUrl(audioUrl, connection, requestStart);
            } else {
                throw new Error('[TTS:Qwen3] Unable to extract audio URL from output');
            }
        } else {
            throw new Error('[TTS:Qwen3] Unknown output format received');
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
