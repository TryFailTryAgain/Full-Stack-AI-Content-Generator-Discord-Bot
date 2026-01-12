/*
* ttsStreamer.js
* Streams TTS audio from OpenAI to Discord
*/
const axios = require('axios');
const { createAudioResource, createAudioPlayer, StreamType, AudioPlayerStatus } = require('@discordjs/voice');
const { playbackState } = require('./voiceGlobalState.js');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');

async function synthesizeAndPlay(text, connection, { voice, noInterruptions, voiceDetails } = {}) {
    if (!text || !text.trim()) return;
    
    // Stop existing playback unless noInterruptions is set
    if (!noInterruptions && playbackState.isPlaying && playbackState.player) {
        try { playbackState.player.stop(); } catch { }
    }

    const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
    const chosenVoice = voice || process.env.OPENAI_TTS_VOICE || 'sage';
    const instructions = voiceDetails || process.env.OPENAI_TTS_INSTRUCTIONS;

    const requestStart = Date.now();
    console.log(`[TTS] Requesting: model=${model}, voice=${chosenVoice}`);
    
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
            console.log('[TTS] Stream ended');
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
    ff.stdin.on('error', () => {});

    const player = createAudioPlayer();
    let playbackInitialized = false;

    // Defer Discord playback until audio is actually streaming for lower latency
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

    resp.data.once('error', err => {
        console.error('[TTS] Stream error:', err?.message || err);
        rejectOnce(err);
    });
    
    ff.once('error', err => {
        console.error('[TTS] FFmpeg error:', err);
        rejectOnce(err);
    });
    
    player.once('error', err => {
        console.error('[TTS] Player error:', err);
        rejectOnce(err);
    });
    
    player.once(AudioPlayerStatus.Idle, resolveOnce);

    resp.data.on('data', chunk => {
        if (!firstChunkLogged) {
            firstChunkLogged = true;
            const latency = Date.now() - requestStart;
            console.log(`[TTS] First chunk received: ${latency}ms`);
            startPlayback();
        }
        if (!settled && !input.destroyed && !input.writableEnded) {
            input.write(chunk);
        }
    });

    return deferred.promise;
}

function stopActivePlayback(reason = 'manual-stop') {
    if (playbackState.player) {
        try {
            console.log(`[TTS] Stopping playback: ${reason}`);
            playbackState.player.stop();
        } catch (err) {
            console.error('[TTS] Failed to stop playback:', err);
        }
    }
    playbackState.isPlaying = false;
    playbackState.player = null;
}

function isPlaybackActive() {
    return Boolean(playbackState.isPlaying);
}

module.exports = { synthesizeAndPlay, stopActivePlayback, isPlaybackActive };
