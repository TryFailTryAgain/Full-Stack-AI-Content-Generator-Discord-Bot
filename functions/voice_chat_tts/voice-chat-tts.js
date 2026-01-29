/*
* voice-chat-tts.js
* Lightweight orchestration for /voice-chat-tts
*/
const { VoiceConnectionStatus, entersState, EndBehaviorType } = require('@discordjs/voice');
const { OpusEncoder } = require('@discordjs/opus');
const WebSocket = require('ws');
const axios = require('axios');
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
            useVadEvents: realtime && parseBooleanEnv(process.env.VOICE_CHAT_TTS_USE_VAD_EVENTS, true)
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
            backend: (process.env.VOICE_CHAT_TTS_LLM_BACKEND || 'chat').toLowerCase(),
            model: process.env.OPENAI_TTS_LLM_MODEL || 'gpt-4.1-nano',
            temperature: process.env.VOICE_CHAT_TTS_TEMPERATURE ? parseFloat(process.env.VOICE_CHAT_TTS_TEMPERATURE) : 0.85,
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
        async speak(text, { forceNoInterruptions } = {}) {
            if (!text || !text.trim()) return null;
            
            const noInterruptions = typeof forceNoInterruptions === 'boolean'
                ? forceNoInterruptions
                : speechConfig.preventInterruptions;
            
            // Build options based on provider
            const options = {
                provider: speechConfig.provider,
                noInterruptions
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

function attachDiscordAudio({ connection, channel, config, speech, transcription, audioState, onTranscript, onBatchAudio }) {
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
            timer: scheduleInterruption({ userId, config, speech }),
            metadata
        });
    };

    const handleSpeakingEnd = (userId) => {
        const speaker = activeSpeakers.get(userId);
        if (!speaker) return;
        if (speaker.timer) clearTimeout(speaker.timer);
        try { speaker.opusStream.destroy(); } catch { }
        activeSpeakers.delete(userId);

        if (config.transcriptionMode === 'batch') {
            if (onBatchAudio) {
                const buffer = speaker.bufferList.length ? Buffer.concat(speaker.bufferList) : null;
                onBatchAudio({ buffer, speaker: speaker.metadata });
            }
        } else if (transcription && !config.useVadEvents) {
            transcription.commit();
            flushTranscript(audioState, onTranscript);
        }
    };

    connection.receiver.speaking.on('start', handleSpeakingStart);
    connection.receiver.speaking.on('end', handleSpeakingEnd);

    return () => {
        connection.receiver.speaking.off('start', handleSpeakingStart);
        connection.receiver.speaking.off('end', handleSpeakingEnd);
        for (const speaker of activeSpeakers.values()) {
            try { speaker.opusStream.destroy(); } catch { }
            if (speaker.timer) clearTimeout(speaker.timer);
        }
        activeSpeakers.clear();
    };
}

function scheduleInterruption({ userId, config, speech }) {
    if (config.preventInterruptions) return null;
    return setTimeout(() => {
        if (!speech.isSpeaking()) return;
        console.log(`[AudioBridge] Interrupting TTS due to user ${userId} speaking.`);
        speech.stop('user-interrupt');
    }, config.interruptionDelayMs || 1000);
}

function flushTranscript(audioState, onTranscript) {
    const transcript = audioState.partialTranscript.trim();
    audioState.partialTranscript = '';
    if (!transcript) return;
    onTranscript?.({ transcript, speaker: audioState.lastSpeaker });
}

async function handleTranscriptTurn({ llm, speech, transcript, speaker }) {
    if (!transcript) return;
    try {
        const reply = await llm.handleTranscript({
            userId: speaker?.userId,
            username: speaker?.username,
            text: transcript
        });
        if (reply) {
            await speech.speak(reply);
        }
    } catch (error) {
        console.error('[VoiceChatTTS] Transcript processing failed:', error);
    }
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

    const transcriptFlush = () => flushTranscript(audioState, payload => handleTranscriptTurn({ llm, speech, ...payload }));

    transcriptionHandlers.onSpeechStart = () => {
        if (!config.audio.preventInterruptions && speech.isSpeaking()) {
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
        onTranscript: (payload) => handleTranscriptTurn({ llm, speech, ...payload }),
        onBatchAudio: ({ buffer, speaker }) => {
            if (!buffer?.length) return;
            console.log('[VoiceChatTTS] Batch mode placeholder for', speaker?.username || speaker?.userId);
        }
    });

    const cleanup = createCleanup(async () => {
        state.setVoiceChatShutdownStatus(true);
        try { session.detachAudio?.(); } catch (error) { console.error('[VoiceChatTTS] Failed to detach audio:', error); }
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

module.exports = { startVoiceChatTTS };
