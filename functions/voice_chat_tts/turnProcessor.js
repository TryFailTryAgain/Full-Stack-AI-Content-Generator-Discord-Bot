/*
* turnProcessor.js
* Manages turn-based conversation flow: thinking indicators,
* speech interface, and inference orchestration between STT and TTS.
*
* Uses a modeHandler strategy pattern so different modes (assistant_chat,
* fact_check, etc.) can plug into the same turn pipeline.
*/
const { Readable } = require('stream');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createAudioPlayer, createAudioResource, StreamType } = require('@discordjs/voice');
const { synthesizeAndPlay, stopActivePlayback, isPlaybackActive } = require('./ttsStreamer.js');

function requireEnvVar(name, { allowEmpty = false } = {}) {
    const value = process.env[name];
    if (value === undefined || value === null) {
        throw new Error(`[TurnProcessor] Missing required environment variable: ${name}`);
    }
    if (!allowEmpty && String(value).trim() === '') {
        throw new Error(`[TurnProcessor] Environment variable ${name} cannot be empty`);
    }
    return value;
}

function createSpeechInterface(connection, speechConfig) {
    return {
        async speak(text, { forceNoInterruptions, onSynthesisStart, onAudioStart, onPlaybackEnd } = {}) {
            if (!text || !text.trim()) return null;

            const noInterruptions = typeof forceNoInterruptions === 'boolean'
                ? forceNoInterruptions
                : speechConfig.preventInterruptions;

            // Build options based on provider
            const options = {
                provider: speechConfig.provider,
                noInterruptions,
                onSynthesisStart,
                onAudioStart,
                onPlaybackEnd
            };

            // Add provider-specific options
            if (speechConfig.provider === 'openai') {
                options.voice = speechConfig.voice;
                options.voiceDetails = speechConfig.voiceDetails;
            } else if (['qwen3tts', 'qwen3', 'qwen'].includes(speechConfig.provider)) {
                if (speechConfig.qwen3) {
                    options.speaker = speechConfig.qwen3.speaker;
                    options.styleInstruction = speechConfig.qwen3.styleInstruction;
                    options.voiceDescription = speechConfig.qwen3.voiceDescription;
                    options.referenceAudio = speechConfig.qwen3.referenceAudio;
                    options.referenceText = speechConfig.qwen3.referenceText;
                }
            }

            try {
                await synthesizeAndPlay(text.trim(), connection, options);
                return true;
            } catch (error) {
                console.error(`[TTS:${speechConfig.provider}] Synthesis failed:`, error);
                throw error;
            }
        },
        stop(reason = 'manual-stop') {
            stopActivePlayback(reason);
        },
        isSpeaking() {
            return isPlaybackActive();
        },
        getProvider() {
            return speechConfig.provider;
        }
    };
}

function createThinkingPcmStream() {
    const sampleRate = 48000;
    const channels = 2;
    const bytesPerSample = 2;
    const chunkMs = 40;
    const chunkSamples = Math.floor((sampleRate * chunkMs) / 1000);
    const cycleMs = 960;
    const gain = 0.11;

    let phase = 0;
    let elapsedMs = 0;
    let timer = null;

    const stream = new Readable({ read() { } });

    const writeChunk = () => {
        const chunk = Buffer.alloc(chunkSamples * channels * bytesPerSample);
        for (let i = 0; i < chunkSamples; i++) {
            const tMs = (elapsedMs + (i * 1000 / sampleRate)) % cycleMs;
            const firstTone = tMs >= 0 && tMs < 130;
            const secondTone = tMs >= 260 && tMs < 390;
            const toneHz = firstTone ? 700 : (secondTone ? 820 : 0);
            const sample = toneHz
                ? Math.floor(Math.sin(phase) * 32767 * gain)
                : 0;

            if (toneHz) {
                phase += (2 * Math.PI * toneHz) / sampleRate;
                if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
            }

            const offset = i * channels * bytesPerSample;
            chunk.writeInt16LE(sample, offset);
            chunk.writeInt16LE(sample, offset + 2);
        }

        elapsedMs += chunkMs;
        stream.push(chunk);
    };

    timer = setInterval(writeChunk, chunkMs);

    const stop = () => {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        if (!stream.destroyed) {
            stream.push(null);
            stream.destroy();
        }
    };

    stream.on('close', () => {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    });

    return { stream, stop };
}

function createThinkingLoopController(connection) {
    let thinkingPlayer = null;
    let stopStream = null;
    let ffmpegProc = null;

    const configuredThinkingPath = String(requireEnvVar('VOICE_CHAT_TTS_THINKING_SOUND_PATH', { allowEmpty: true })).trim();
    const thinkingMp3Path = configuredThinkingPath
        ? (path.isAbsolute(configuredThinkingPath)
            ? configuredThinkingPath
            : path.resolve(process.cwd(), configuredThinkingPath))
        : path.resolve(__dirname, '../../Outputs/thinking-sounds.mp3');

    return {
        start() {
            if (thinkingPlayer) return;
            try {
                const player = createAudioPlayer();

                if (fs.existsSync(thinkingMp3Path)) {
                    ffmpegProc = spawn('ffmpeg', [
                        '-hide_banner', '-loglevel', 'error',
                        '-stream_loop', '-1',
                        '-i', thinkingMp3Path,
                        '-f', 's16le', '-ar', '48000', '-ac', '2',
                        'pipe:1'
                    ]);

                    ffmpegProc.once('error', (error) => {
                        console.error('[TurnProcessor] Thinking MP3 ffmpeg error:', error);
                    });

                    const resource = createAudioResource(ffmpegProc.stdout, { inputType: StreamType.Raw });
                    player.play(resource);
                    stopStream = () => {
                        try { ffmpegProc?.kill('SIGKILL'); } catch { }
                        ffmpegProc = null;
                    };
                } else {
                    const { stream, stop } = createThinkingPcmStream();
                    const resource = createAudioResource(stream, { inputType: StreamType.Raw });
                    player.play(resource);
                    stopStream = stop;
                }

                connection.subscribe(player);
                thinkingPlayer = player;
            } catch (error) {
                console.error('[TurnProcessor] Failed to start thinking loop:', error);
            }
        },
        stop(reason = 'stop-thinking') {
            if (!thinkingPlayer) return;
            try { thinkingPlayer.stop(true); } catch { }
            try { stopStream?.(); } catch { }
            try { ffmpegProc?.kill('SIGKILL'); } catch { }
            thinkingPlayer = null;
            stopStream = null;
            ffmpegProc = null;
            if (process.env.ADVCONF_OPENAI_VOICE_CHAT_SYSTEM_LOGGING === 'true') {
                console.log(`[TurnProcessor] Thinking loop stopped: ${reason}`);
            }
        }
    };
}

/**
 * Creates a turn processor that orchestrates transcript ingestion,
 * inference, and speech output.
 *
 * @param {Object} options
 * @param {Function} options.recordTranscript - async ({ userId, username, text }) => void
 * @param {Object} options.speech - Speech interface (speak, stop, isSpeaking)
 * @param {Object} options.config - Audio config { preventInterruptions }
 * @param {Object} options.connection - Discord voice connection
 * @param {Object} options.modeHandler - Strategy for inference behavior
 * @param {Function} options.modeHandler.shouldTrigger - (transcript, history) => false | context
 * @param {Function} options.modeHandler.runInference - async (context) => { spokenText }
 * @param {Function} [options.modeHandler.onError] - async (error, helpers) => void
 * @param {Function} [options.createThinkingLoop] - DI for thinking loop (testing)
 * @param {Function} [options.canInterruptOverride] - Override interrupt check
 * @param {number} [options.interruptAfterSpeechMs=2000] - Min ms of speech before interrupt
 * @param {number} [options.maxTranscriptHistoryEntries=120] - Max history entries
 */
function createTranscriptTurnProcessor({
    recordTranscript,
    speech,
    config,
    connection,
    modeHandler,
    createThinkingLoop = createThinkingLoopController,
    canInterruptOverride = null,
    interruptAfterSpeechMs = 2000,
    maxTranscriptHistoryEntries = 120
}) {
    const thinkingLoop = createThinkingLoop(connection);
    const turnState = {
        isRunning: false,
        pendingInference: null,
        isThinking: false,
        speechStartedAt: null,
        transcriptHistory: []
    };

    const markThinking = () => {
        turnState.isThinking = true;
        thinkingLoop.start();
    };

    const markAudioStarted = () => {
        turnState.isThinking = false;
        turnState.speechStartedAt = Date.now();
        thinkingLoop.stop('tts-audio-started');
    };

    const resetTurnAudioState = (reason = 'reset') => {
        turnState.isThinking = false;
        turnState.speechStartedAt = null;
        thinkingLoop.stop(reason);
    };

    const canInterruptForUserSpeech = () => {
        if (config.preventInterruptions) return false;
        if (turnState.isThinking) return false;
        if (!speech.isSpeaking()) return false;
        if (!turnState.speechStartedAt) return false;
        return (Date.now() - turnState.speechStartedAt) >= interruptAfterSpeechMs;
    };

    const evaluateInterrupt = () => {
        if (typeof canInterruptOverride === 'function') {
            return Boolean(canInterruptOverride({
                defaultCheck: canInterruptForUserSpeech,
                turnState
            }));
        }
        return canInterruptForUserSpeech();
    };

    const runPendingInference = async () => {
        if (turnState.isRunning) return;
        turnState.isRunning = true;

        try {
            while (turnState.pendingInference) {
                const context = turnState.pendingInference;
                turnState.pendingInference = null;

                markThinking();
                const result = await modeHandler.runInference(context);

                if (!result?.spokenText) {
                    resetTurnAudioState('no-reply');
                    continue;
                }

                await speech.speak(result.spokenText, {
                    onSynthesisStart: markThinking,
                    onAudioStart: markAudioStarted,
                    onPlaybackEnd: () => resetTurnAudioState('playback-ended')
                });
                resetTurnAudioState('speak-complete');
            }
        } catch (error) {
            resetTurnAudioState('inference-error');
            console.error('[TurnProcessor] Inference failed:', error);
            if (modeHandler.onError) {
                await modeHandler.onError(error, {
                    speech,
                    connection,
                    markThinking,
                    markAudioStarted,
                    resetTurnAudioState
                });
            }
        } finally {
            turnState.isRunning = false;
        }
    };

    return {
        async ingestTranscript({ transcript, speaker }) {
            if (!transcript) return;
            try {
                await recordTranscript({
                    userId: speaker?.userId,
                    username: speaker?.username,
                    text: transcript
                });

                turnState.transcriptHistory.push({
                    userId: speaker?.userId,
                    username: speaker?.username,
                    text: transcript,
                    timestamp: Date.now()
                });
                if (turnState.transcriptHistory.length > maxTranscriptHistoryEntries) {
                    turnState.transcriptHistory.splice(0, turnState.transcriptHistory.length - maxTranscriptHistoryEntries);
                }

                // Ask mode handler if this transcript should trigger inference
                const context = modeHandler.shouldTrigger(transcript, turnState.transcriptHistory);
                if (context === false) return;

                if (!turnState.isRunning) {
                    turnState.pendingInference = context || {};
                    await runPendingInference();
                    return;
                }

                // While current turn is still thinking (no assistant audio yet),
                // keep transcript history but do not queue immediate follow-up inference.
                if (turnState.isThinking) {
                    return;
                }

                // During assistant speech, only allow follow-up generation if
                // interruptions are currently allowed (post interrupt window).
                if (evaluateInterrupt()) {
                    turnState.pendingInference = context || {};
                    speech.stop('user-interrupt-post-window');
                }
            } catch (error) {
                console.error('[TurnProcessor] Failed to ingest transcript:', error);
            }
        },
        canInterruptForUserSpeech: evaluateInterrupt,
        isThinking() {
            return turnState.isThinking;
        },
        stopThinking(reason = 'cleanup') {
            resetTurnAudioState(reason);
        },
        getTranscriptHistory() {
            return [...turnState.transcriptHistory];
        }
    };
}

module.exports = {
    createSpeechInterface,
    createThinkingPcmStream,
    createThinkingLoopController,
    createTranscriptTurnProcessor
};
