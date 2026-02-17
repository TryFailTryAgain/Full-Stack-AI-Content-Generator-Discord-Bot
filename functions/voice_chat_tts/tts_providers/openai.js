/*
* tts_providers/openai.js
* OpenAI TTS provider - streams audio directly from OpenAI's API
*/
const axios = require('axios');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');
const { createAudioResource, createAudioPlayer, StreamType, AudioPlayerStatus } = require('@discordjs/voice');
const { playbackState } = require('../voiceGlobalState.js');

const PROVIDER_NAME = 'openai';

/**
 * Synthesizes text to speech using OpenAI's TTS API and streams to Discord
 * @param {string} text - Text to synthesize
 * @param {Object} connection - Discord voice connection
 * @param {Object} options - TTS options
 * @returns {Promise<void>}
 */
async function synthesizeAndPlay(text, connection, options = {}) {
    if (!text || !text.trim()) return;

    const { voice, noInterruptions, voiceDetails } = options;

    // Stop existing playback unless noInterruptions is set
    if (!noInterruptions && playbackState.isPlaying && playbackState.player) {
        try { playbackState.player.stop(); } catch { }
    }

    const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
    const chosenVoice = voice || process.env.OPENAI_TTS_VOICE || 'sage';
    const instructions = voiceDetails || process.env.OPENAI_TTS_INSTRUCTIONS;
    options.onSynthesisStart?.({ provider: PROVIDER_NAME });

    const requestStart = Date.now();
    console.log(`[TTS:OpenAI] Requesting: model=${model}, voice=${chosenVoice}`);

    const resp = await axios.post('https://api.openai.com/v1/audio/speech', {
        model,
        voice: chosenVoice,
        input: text,
        instructions,
        format: 'wav'
    }, {
        headers: {
            'Authorization': `Bearer ${process.env.API_KEY_OPENAI_CHAT}`,
            'Content-Type': 'application/json'
        },
        responseType: 'stream'
    });

    const input = new PassThrough();
    let firstChunkLogged = false;
    let settled = false;

    const deferred = {};
    deferred.promise = new Promise((resolve, reject) => {
        deferred.resolve = resolve;
        deferred.reject = reject;
    });

    resp.data.on('end', () => {
        if (!settled) {
            console.log('[TTS:OpenAI] Stream ended');
            input.end();
        }
    });

    // FFmpeg to convert to Discord format
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

    // Defer Discord playback until audio is actually streaming for lower latency
    const startPlayback = () => {
        if (playbackInitialized) return;
        playbackInitialized = true;
        options.onAudioStart?.({ provider: PROVIDER_NAME });
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
        options.onPlaybackEnd?.({ provider: PROVIDER_NAME, ok: true });
        deferred.resolve();
    };

    const rejectOnce = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        options.onPlaybackEnd?.({ provider: PROVIDER_NAME, ok: false, error: err });
        deferred.reject(err);
    };

    resp.data.once('error', err => {
        console.error('[TTS:OpenAI] Stream error:', err?.message || err);
        rejectOnce(err);
    });

    ff.once('error', err => {
        console.error('[TTS:OpenAI] FFmpeg error:', err);
        rejectOnce(err);
    });

    player.once('error', err => {
        console.error('[TTS:OpenAI] Player error:', err);
        rejectOnce(err);
    });

    player.once(AudioPlayerStatus.Idle, resolveOnce);

    resp.data.on('data', chunk => {
        if (!firstChunkLogged) {
            firstChunkLogged = true;
            const latency = Date.now() - requestStart;
            console.log(`[TTS:OpenAI] First chunk received: ${latency}ms`);
            startPlayback();
        }
        if (!settled && !input.destroyed && !input.writableEnded) {
            input.write(chunk);
        }
    });

    return deferred.promise;
}

module.exports = {
    name: PROVIDER_NAME,
    synthesizeAndPlay
};
