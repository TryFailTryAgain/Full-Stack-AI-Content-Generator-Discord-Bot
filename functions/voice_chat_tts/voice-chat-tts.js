/*
* voice-chat-tts.js
* Lightweight orchestration for /voice-chat-tts
*/
const { VoiceConnectionStatus, entersState, EndBehaviorType } = require('@discordjs/voice');
const { OpusEncoder } = require('@discordjs/opus');
const { Readable } = require('stream');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const axios = require('axios');
const { createAudioPlayer, createAudioResource, StreamType } = require('@discordjs/voice');
const { handleJoinVoiceChannel, gracefulDisconnect } = require('../voice_chat/channelConnection.js');
const { followUpEphemeral } = require('../helperFunctions.js');
const { createLLMHandler } = require('./llmHandler.js');
const { synthesizeAndPlay, stopActivePlayback, isPlaybackActive } = require('./ttsStreamer.js');
const state = require('./voiceGlobalState.js');

function parseBooleanEnv(value, defaultValue) {
    if (value === undefined || value === null) return defaultValue;
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
    return defaultValue;
}

function numberFromEnv(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildSessionConfig({ preventInterruptions }) {
    const transcriptionMode = (process.env.VOICE_CHAT_TTS_TRANSCRIPTION_MODE || 'realtime').toLowerCase();
    const realtime = transcriptionMode === 'realtime';

    return {
        audio: {
            transcriptionMode,
            preventInterruptions,
            interruptionDelayMs: numberFromEnv(process.env.VOICE_CHAT_TTS_INTERRUPTION_DELAY, 1000),
            useVadEvents: realtime && parseBooleanEnv(process.env.VOICE_CHAT_TTS_USE_VAD_EVENTS, true),
            // Silence injection settings - helps VAD detect end of speech
            silenceStreamEnabled: parseBooleanEnv(process.env.VOICE_CHAT_TTS_SILENCE_STREAM_ENABLED, true),
            silencePaddingMs: numberFromEnv(process.env.VOICE_CHAT_TTS_SILENCE_PADDING_MS, 4000),
            silencePacketMs: numberFromEnv(process.env.VOICE_CHAT_TTS_SILENCE_PACKET_MS, 100)
        },
        speech: {
            provider: (process.env.VOICE_CHAT_TTS_PROVIDER || 'openai').toLowerCase(),
            // OpenAI TTS options
            voice: process.env.OPENAI_TTS_VOICE || 'sage',
            voiceDetails: process.env.OPENAI_TTS_INSTRUCTIONS,
            preventInterruptions,
            // Qwen3-TTS options (via Replicate)
            qwen3: {
                mode: process.env.QWEN3_TTS_MODE || 'custom_voice',
                speaker: process.env.QWEN3_TTS_SPEAKER || 'Aiden',
                language: process.env.QWEN3_TTS_LANGUAGE || 'auto',
                styleInstruction: process.env.QWEN3_TTS_STYLE_INSTRUCTION,
                voiceDescription: process.env.QWEN3_TTS_VOICE_DESCRIPTION,
                referenceAudio: process.env.QWEN3_TTS_REFERENCE_AUDIO,
                referenceText: process.env.QWEN3_TTS_REFERENCE_TEXT
            }
        },
        llm: {
            backend: (process.env.VOICE_CHAT_TTS_LLM_BACKEND).toLowerCase(),
            model: process.env.OPENAI_TTS_LLM_MODEL,
            maxTokens: process.env.VOICE_CHAT_TTS_MAX_TOKENS || '400',
            reasoningLevel: process.env.VOICE_CHAT_TTS_REASONING_LEVEL || 'none',
            systemPrompt: process.env.OPENAI_VOICE_CHAT_INSTRUCTIONS || 'You are a voice assistant. Keep replies concise for speech.',
            maxMessages: process.env.VOICE_CHAT_TTS_CONVERSATION_MAX_MESSAGES || 'inf'
        }
    };
}

async function waitForReady(connection, timeoutMs = 15000) {
    await entersState(connection, VoiceConnectionStatus.Ready, timeoutMs);
}

function resolveMember(channel, userId) {
    const member = channel.members.get(userId) || channel.guild.members.cache.get(userId);
    if (!member) return { userId, username: `User ${userId}` };
    return {
        userId,
        username: member.nickname || member.displayName || member.user?.username || `User ${userId}`
    };
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
                // Qwen3-TTS options are read from env vars by the provider
                // but we can pass overrides here if needed
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

    const configuredThinkingPath = String(process.env.VOICE_CHAT_TTS_THINKING_SOUND_PATH || '').trim();
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
                        console.error('[VoiceChatTTS] Thinking MP3 ffmpeg error:', error);
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
                console.error('[VoiceChatTTS] Failed to start thinking loop:', error);
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
                console.log(`[VoiceChatTTS] Thinking loop stopped: ${reason}`);
            }
        }
    };
}

function createTranscriptTurnProcessor({ llm, speech, config, connection, createThinkingLoop = createThinkingLoopController, canInterruptOverride = null }) {
    const thinkingLoop = createThinkingLoop(connection);
    const interruptAfterSpeechMs = numberFromEnv(process.env.VOICE_CHAT_TTS_INTERRUPT_AFTER_SPEECH_MS, 2000);
    const turnState = {
        isRunning: false,
        pendingInference: false,
        isThinking: false,
        speechStartedAt: null
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
                turnState.pendingInference = false;
                const reply = await llm.generateReply();
                if (!reply) {
                    resetTurnAudioState('no-reply');
                    continue;
                }

                await speech.speak(reply, {
                    onSynthesisStart: markThinking,
                    onAudioStart: markAudioStarted,
                    onPlaybackEnd: () => resetTurnAudioState('playback-ended')
                });
                resetTurnAudioState('speak-complete');
            }
        } catch (error) {
            resetTurnAudioState('inference-error');
            console.error('[VoiceChatTTS] Transcript processing failed:', error);
        } finally {
            turnState.isRunning = false;
        }
    };

    return {
        async ingestTranscript({ transcript, speaker }) {
            if (!transcript) return;
            try {
                await llm.recordTranscript({
                    userId: speaker?.userId,
                    username: speaker?.username,
                    text: transcript
                });

                if (!turnState.isRunning) {
                    turnState.pendingInference = true;
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
                    turnState.pendingInference = true;
                    speech.stop('user-interrupt-post-window');
                }
            } catch (error) {
                console.error('[VoiceChatTTS] Failed to ingest transcript:', error);
            }
        },
        canInterruptForUserSpeech: evaluateInterrupt,
        isThinking() {
            return turnState.isThinking;
        },
        stopThinking(reason = 'cleanup') {
            resetTurnAudioState(reason);
        }
    };
}

async function createRealtimeTranscriber(audioConfig, handlerRef = {}) {
    const { sessionId, clientSecret } = await createTranscriptionSession(audioConfig.useVadEvents);
    const url = `wss://api.openai.com/v1/realtime?session_id=${encodeURIComponent(sessionId)}`;
    const ws = new WebSocket(url, {
        headers: {
            Authorization: `Bearer ${clientSecret}`,
            'OpenAI-Beta': 'realtime=v1'
        }
    });

    await new Promise((resolve, reject) => {
        const handleOpen = () => { cleanup(); resolve(); };
        const handleError = (err) => { cleanup(); reject(err); };
        const cleanup = () => {
            ws.off('open', handleOpen);
            ws.off('error', handleError);
        };
        ws.once('open', handleOpen);
        ws.once('error', handleError);
    });

    if (process.env.ADVCONF_OPENAI_VOICE_CHAT_SYSTEM_LOGGING === 'true') {
        setupWsMessageLogging(ws);
    }

    ws.on('message', raw => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        if (msg.type === 'input_audio_buffer.speech_started') handlerRef.onSpeechStart?.();
        if (msg.type === 'input_audio_buffer.speech_stopped') handlerRef.onSpeechStop?.();
        if ((msg.type === 'transcript.delta' || msg.type === 'conversation.item.input_audio_transcription.delta') && msg.delta) {
            handlerRef.onDelta?.(msg.delta);
        }
        if (msg.type === 'transcript.completed' || msg.type === 'conversation.item.input_audio_transcription.completed') {
            handlerRef.onComplete?.();
        }
        if (msg.type === 'conversation.item.created' && msg.item?.role === 'user' && Array.isArray(msg.item.content)) {
            const textParts = msg.item.content.map(part => {
                if (part?.text) return part.text;
                if (part?.transcript) return part.transcript;
                if (part?.type === 'input_audio_transcription' && part?.text) return part.text;
                return '';
            }).filter(Boolean);
            if (textParts.length) {
                handlerRef.onDelta?.(textParts.join(' '));
                handlerRef.onComplete?.();
            }
        }
    });

    return {
        ws,
        handlerRef,
        updateSession({ language, model, prompt, turn_detection }) {
            if (ws.readyState !== WebSocket.OPEN) return;
            const transcriptionConfig = { model: model || process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe' };
            if (prompt) transcriptionConfig.prompt = prompt;
            if (language) transcriptionConfig.language = language;
            const payload = {
                type: 'transcription_session.update',
                session: {
                    input_audio_transcription: transcriptionConfig,
                    turn_detection: turn_detection === 'none'
                        ? { type: 'none' }
                        : {
                            type: turn_detection || 'semantic_vad',
                            eagerness: process.env.OPENAI_VOICE_CHAT_RESPONSE_EAGERNESS || 'auto'
                        }
                }
            };
            ws.send(JSON.stringify(payload));
        },
        sendAudio(pcmChunk) {
            if (ws.readyState !== WebSocket.OPEN) return;
            ws.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: Buffer.from(pcmChunk).toString('base64')
            }));
        },
        commit() {
            if (ws.readyState !== WebSocket.OPEN) return;
            ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        },
        async close() {
            if (ws.readyState === WebSocket.OPEN) {
                try { ws.close(); } catch { }
            }
        }
    };
}

/**
 * Injects silence into the transcription stream to help VAD detect end of speech
 * @param {Object} transcription - The transcription interface with sendAudio method
 * @param {Object} config - Audio config with silence settings
 * @returns {Promise<void>}
 */
function injectSilence(transcription, config) {
    return new Promise((resolve) => {
        if (!transcription || !config.silenceStreamEnabled) {
            resolve();
            return;
        }

        const packetMs = config.silencePacketMs || 100;
        const totalMs = config.silencePaddingMs || 4000;
        const packets = Math.ceil(totalMs / packetMs);
        
        // 24kHz mono 16-bit PCM: samples = sampleRate * seconds * bytesPerSample
        // For 100ms: 24000 * 0.1 * 2 = 4800 bytes
        const silenceBuffer = Buffer.alloc(Math.floor(24000 * (packetMs / 1000) * 2), 0);
        
        let sent = 0;
        console.log(`[AudioBridge] Injecting ${totalMs}ms of silence (${packets} packets)`);
        
        const intervalId = setInterval(() => {
            if (sent >= packets) {
                clearInterval(intervalId);
                console.log(`[AudioBridge] Silence injection complete`);
                resolve();
                return;
            }
            
            transcription.sendAudio(silenceBuffer);
            sent++;
        }, packetMs);
    });
}

function attachDiscordAudio({ connection, channel, config, speech, transcription, audioState, onTranscript, onBatchAudio, canInterrupt }) {
    const activeSpeakers = audioState.activeSpeakers;

    const handleSpeakingStart = (userId) => {
        if (state.isVoiceChatShuttingDown || activeSpeakers.has(userId)) return;
        const metadata = { ...resolveMember(channel, userId), userId, startedAt: Date.now() };
        audioState.lastSpeaker = metadata;

        const opusStream = connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } });
        const decoder = new OpusEncoder(24000, 1);
        const bufferList = [];

        opusStream.on('data', (packet) => {
            try {
                const pcm = decoder.decode(packet);
                if (config.transcriptionMode === 'realtime' && transcription) {
                    let offset = 0;
                    const chunkSize = 5000;
                    while (offset < pcm.length) {
                        transcription.sendAudio(pcm.subarray(offset, offset + chunkSize));
                        offset += chunkSize;
                    }
                } else {
                    bufferList.push(Buffer.from(pcm));
                }
            } catch (error) {
                console.error('[AudioBridge] Opus decode error:', error);
            }
        });

        opusStream.on('error', (error) => console.error('[AudioBridge] Opus stream error:', error));

        activeSpeakers.set(userId, {
            opusStream,
            decoder,
            bufferList,
            timer: scheduleInterruption({
                userId,
                config,
                speech,
                canInterrupt,
                isSpeakerActive: () => activeSpeakers.has(userId)
            }),
            metadata
        });
    };

    const handleSpeakingEnd = (userId) => {
        const speaker = activeSpeakers.get(userId);
        if (!speaker) return;
        if (speaker.timer?.cancel) speaker.timer.cancel();
        try { speaker.opusStream.destroy(); } catch { }
        activeSpeakers.delete(userId);

        if (config.transcriptionMode === 'batch') {
            if (onBatchAudio) {
                const buffer = speaker.bufferList.length ? Buffer.concat(speaker.bufferList) : null;
                onBatchAudio({ buffer, speaker: speaker.metadata });
            }
        } else if (transcription) {
            // When using VAD events, inject silence to help detect end of speech
            // When not using VAD, we still inject silence before committing
            if (config.silenceStreamEnabled) {
                injectSilence(transcription, config).then(() => {
                    if (!config.useVadEvents) {
                        flushTranscript(audioState, onTranscript);
                    }
                    // VAD events will trigger onComplete automatically after silence
                });
            } else if (!config.useVadEvents) {
                transcription.commit();
                flushTranscript(audioState, onTranscript);
            }
        }
    };

    connection.receiver.speaking.on('start', handleSpeakingStart);
    connection.receiver.speaking.on('end', handleSpeakingEnd);

    return () => {
        connection.receiver.speaking.off('start', handleSpeakingStart);
        connection.receiver.speaking.off('end', handleSpeakingEnd);
        for (const speaker of activeSpeakers.values()) {
            try { speaker.opusStream.destroy(); } catch { }
            if (speaker.timer?.cancel) speaker.timer.cancel();
        }
        activeSpeakers.clear();
    };
}

function scheduleInterruption({ userId, config, speech, canInterrupt, isSpeakerActive }) {
    if (config.preventInterruptions) return null;
    let timer = null;

    const attemptInterrupt = () => {
        if (!isSpeakerActive?.()) return;
        if (!speech.isSpeaking()) return;

        if (typeof canInterrupt === 'function' && !canInterrupt()) {
            timer = setTimeout(attemptInterrupt, 250);
            return;
        }

        console.log(`[AudioBridge] Interrupting TTS due to user ${userId} speaking.`);
        speech.stop('user-interrupt');
    };

    timer = setTimeout(attemptInterrupt, config.interruptionDelayMs || 1000);

    return {
        cancel() {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        }
    };
}

function flushTranscript(audioState, onTranscript) {
    const transcript = audioState.partialTranscript.trim();
    audioState.partialTranscript = '';
    if (!transcript) return;
    onTranscript?.({ transcript, speaker: audioState.lastSpeaker });
}

async function startVoiceChatTTS({ interaction, channel, preventInterruptions = false }) {
    const config = buildSessionConfig({ preventInterruptions });
    const audioState = { activeSpeakers: new Map(), partialTranscript: '', lastSpeaker: null };
    const session = { connection: null, transcription: null, detachAudio: null };

    try {
        session.connection = await handleJoinVoiceChannel(interaction, channel);
        await waitForReady(session.connection);
    } catch (error) {
        await followUpEphemeral(interaction, 'Failed to join voice channel.');
        throw error;
    }

    const speech = createSpeechInterface(session.connection, config.speech);

    const transcriptionHandlers = {};
    if (config.audio.transcriptionMode === 'realtime') {
        session.transcription = await createRealtimeTranscriber(config.audio, transcriptionHandlers);
        session.transcription.updateSession({
            language: process.env.OPENAI_STT_TRANSCRIPTION_LANGUAGE || 'en',
            model: process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
            prompt: process.env.OPENAI_STT_TRANSCRIPTION_PROMPT || '',
            turn_detection: config.audio.useVadEvents ? 'semantic_vad' : 'none'
        });
    }

    const llm = createLLMHandler({
        interaction,
        config: config.llm,
        ws: session.transcription?.ws,
        discordConnection: session.connection
    });
    const turnProcessor = createTranscriptTurnProcessor({
        llm,
        speech,
        config: config.audio,
        connection: session.connection
    });

    const transcriptFlush = () => flushTranscript(audioState, payload => turnProcessor.ingestTranscript(payload));

    transcriptionHandlers.onSpeechStart = () => {
        if (!config.audio.preventInterruptions && turnProcessor.canInterruptForUserSpeech()) {
            speech.stop('vad-interrupt');
        }
    };
    transcriptionHandlers.onDelta = (delta = '') => {
        audioState.partialTranscript += delta;
    };
    transcriptionHandlers.onComplete = transcriptFlush;

    session.detachAudio = attachDiscordAudio({
        connection: session.connection,
        channel,
        config: config.audio,
        speech,
        transcription: session.transcription,
        audioState,
        onTranscript: (payload) => turnProcessor.ingestTranscript(payload),
        onBatchAudio: ({ buffer, speaker }) => {
            if (!buffer?.length) return;
            console.log('[VoiceChatTTS] Batch mode placeholder for', speaker?.username || speaker?.userId);
        },
        canInterrupt: () => turnProcessor.canInterruptForUserSpeech()
    });

    const cleanup = createCleanup(async () => {
        state.setVoiceChatShutdownStatus(true);
        try { session.detachAudio?.(); } catch (error) { console.error('[VoiceChatTTS] Failed to detach audio:', error); }
        try { turnProcessor.stopThinking('cleanup'); } catch (error) { console.error('[VoiceChatTTS] Failed to stop thinking loop:', error); }
        try { speech.stop('shutdown'); } catch (error) { console.error('[VoiceChatTTS] Failed to stop speech:', error); }
        try { await session.transcription?.close(); } catch (error) { console.error('[VoiceChatTTS] Failed to close transcription:', error); }
        await gracefulDisconnect(session.transcription?.ws, session.connection);
    });

    session.connection.on(VoiceConnectionStatus.Disconnected, () => cleanup('connection-disconnected'));
    session.connection.on(VoiceConnectionStatus.Destroyed, () => cleanup('connection-destroyed'));
    session.connection.on('error', (error) => {
        console.error('[VoiceChatTTS] Voice connection error:', error);
        cleanup('connection-error');
    });

    try {
        state.setVoiceChatShutdownStatus(false);
        const greeting = await llm.generateGreeting();
        if (greeting) {
            await speech.speak(greeting, { forceNoInterruptions: true });
        }
    } catch (error) {
        console.error('[VoiceChatTTS] Failed to deliver greeting:', error);
    }

    return cleanup;
}

function createCleanup(executor) {
    let finished = false;
    return async (reason = 'manual-stop') => {
        if (finished) return;
        finished = true;
        try {
            await executor(reason);
        } catch (error) {
            console.error('[VoiceChatTTS] Cleanup failed:', error);
        }
    };
}

async function createTranscriptionSession(useVadEvents) {
    const model = process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe';
    const language = process.env.OPENAI_STT_TRANSCRIPTION_LANGUAGE;
    const prompt = process.env.OPENAI_STT_TRANSCRIPTION_PROMPT;
    const transcriptionCfg = {'model': model};
    if (language) transcriptionCfg.language = language;
    if (prompt) transcriptionCfg.prompt = prompt;

    const turnDetection = useVadEvents
        ? {
            type: 'semantic_vad',
            eagerness: process.env.OPENAI_VOICE_CHAT_RESPONSE_EAGERNESS || 'auto'
        }
        : { type: 'none' };

    const base = (process.env.ADVCONF_OPENAI_CHAT_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');

    try {
        const response = await axios.post(
            `${base}/realtime/transcription_sessions`,
            {
                input_audio_format: 'pcm16',
                input_audio_transcription: transcriptionCfg,
                turn_detection: turnDetection
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.API_KEY_OPENAI_CHAT}`,
                    'Content-Type': 'application/json',
                    'OpenAI-Beta': 'realtime=v1'
                }
            }
        );
        const sessionId = response.data?.id;
        const clientSecret = response.data?.client_secret?.value;
        if (!sessionId || !clientSecret) {
            throw new Error('Transcription session missing id or client_secret.');
        }
        return { sessionId, clientSecret };
    } catch (error) {
        console.error('[STT] Failed to create transcription session:', error.response?.data || error.message);
        throw error;
    }
}

function setupWsMessageLogging(ws) {
    console.log('[STT] Verbose logging enabled');
    ws.on('message', raw => {
        try {
            const msg = JSON.parse(raw);
            const exclude = ['response.audio.delta', 'transcript.delta', 'conversation.item.input_audio_transcription.delta'];
            if (!exclude.includes(msg.type)) {
                console.log('[STT]', msg);
            }
        } catch { }
    });
}

module.exports = {
    startVoiceChatTTS,
    __testables: {
        parseBooleanEnv,
        numberFromEnv,
        createThinkingPcmStream,
        createThinkingLoopController,
        createTranscriptTurnProcessor,
        scheduleInterruption
    }
};
