/*
* voice-chat-tts.js
* Session orchestrator for /voice-chat-tts.
* Wires together the modular pipeline: audio bridge, STT, LLM, turn processor, and TTS.
*/
const { VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const { handleJoinVoiceChannel, gracefulDisconnect } = require('../voice_chat/channelConnection.js');
const { followUpEphemeral } = require('../helperFunctions.js');
const { createLLMHandler } = require('./llmHandler.js');
const { createSpeechInterface, createTranscriptTurnProcessor, createThinkingPcmStream, createThinkingLoopController } = require('./turnProcessor.js');
const { createRealtimeTranscriber } = require('./sttHandler.js');
const { attachDiscordAudio, flushTranscript, scheduleInterruption } = require('./audioBridge.js');
const { createFactCheckHandler, createFactCheckMode, createAssistantChatMode, detectFactCheckWakePhrase, selectRecentTranscriptWindow } = require('./factCheckHandler.js');
const state = require('./voiceGlobalState.js');

function requireEnvVar(name, { allowEmpty = false } = {}) {
    const value = process.env[name];
    if (value === undefined || value === null) {
        throw new Error(`[VoiceChatTTS] Missing required environment variable: ${name}`);
    }

    if (!allowEmpty && String(value).trim() === '') {
        throw new Error(`[VoiceChatTTS] Environment variable ${name} cannot be empty`);
    }

    return value;
}

function parseBooleanEnv(value, envName) {
    if (value === undefined || value === null || String(value).trim() === '') {
        throw new Error(`[VoiceChatTTS] Missing required boolean environment variable: ${envName}`);
    }

    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;

    throw new Error(`[VoiceChatTTS] Invalid boolean environment variable ${envName}: ${value}`);
}

function numberFromEnv(value, envName) {
    if (value === undefined || value === null || String(value).trim() === '') {
        throw new Error(`[VoiceChatTTS] Missing required numeric environment variable: ${envName}`);
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`[VoiceChatTTS] Invalid numeric environment variable ${envName}: ${value}`);
    }

    return parsed;
}

function buildSessionConfig({ preventInterruptions }) {
    const transcriptionMode = requireEnvVar('VOICE_CHAT_TTS_TRANSCRIPTION_MODE').toLowerCase();
    const realtime = transcriptionMode === 'realtime';
    const provider = requireEnvVar('VOICE_CHAT_TTS_PROVIDER').toLowerCase();

    return {
        audio: {
            transcriptionMode,
            preventInterruptions,
            interruptionDelayMs: numberFromEnv(process.env.VOICE_CHAT_TTS_INTERRUPTION_DELAY, 'VOICE_CHAT_TTS_INTERRUPTION_DELAY'),
            useVadEvents: realtime && parseBooleanEnv(process.env.VOICE_CHAT_TTS_USE_VAD_EVENTS, 'VOICE_CHAT_TTS_USE_VAD_EVENTS'),
            // Silence injection settings - helps VAD detect end of speech
            silenceStreamEnabled: parseBooleanEnv(process.env.VOICE_CHAT_TTS_SILENCE_STREAM_ENABLED, 'VOICE_CHAT_TTS_SILENCE_STREAM_ENABLED'),
            silencePaddingMs: numberFromEnv(process.env.VOICE_CHAT_TTS_SILENCE_PADDING_MS, 'VOICE_CHAT_TTS_SILENCE_PADDING_MS'),
            silencePacketMs: numberFromEnv(process.env.VOICE_CHAT_TTS_SILENCE_PACKET_MS, 'VOICE_CHAT_TTS_SILENCE_PACKET_MS')
        },
        speech: {
            provider,
            // OpenAI TTS options
            voice: requireEnvVar('OPENAI_TTS_VOICE'),
            voiceDetails: process.env.OPENAI_TTS_INSTRUCTIONS,
            preventInterruptions,
            // Qwen3-TTS options (via Replicate)
            qwen3: {
                mode: provider === 'qwen3tts' ? requireEnvVar('QWEN3_TTS_MODE') : process.env.QWEN3_TTS_MODE,
                speaker: provider === 'qwen3tts' ? requireEnvVar('QWEN3_TTS_SPEAKER') : process.env.QWEN3_TTS_SPEAKER,
                language: provider === 'qwen3tts' ? requireEnvVar('QWEN3_TTS_LANGUAGE') : process.env.QWEN3_TTS_LANGUAGE,
                styleInstruction: process.env.QWEN3_TTS_STYLE_INSTRUCTION,
                voiceDescription: process.env.QWEN3_TTS_VOICE_DESCRIPTION,
                referenceAudio: process.env.QWEN3_TTS_REFERENCE_AUDIO,
                referenceText: process.env.QWEN3_TTS_REFERENCE_TEXT
            }
        },
        llm: {
            backend: requireEnvVar('VOICE_CHAT_TTS_LLM_BACKEND').toLowerCase(),
            model: requireEnvVar('OPENAI_TTS_LLM_MODEL'),
            maxTokens: requireEnvVar('VOICE_CHAT_TTS_MAX_TOKENS'),
            reasoningLevel: requireEnvVar('VOICE_CHAT_TTS_REASONING_LEVEL'),
            systemPrompt: requireEnvVar('OPENAI_VOICE_CHAT_TTS_INSTRUCTIONS'),
            maxMessages: requireEnvVar('VOICE_CHAT_TTS_CONVERSATION_MAX_MESSAGES'),
            factCheck: {
                model: String(process.env.OPENAI_VOICE_TTS_FACT_CHECK_LLM_MODEL || '').trim() || requireEnvVar('OPENAI_TTS_LLM_MODEL'),
                reasoningLevel: String(process.env.VOICE_FACT_CHECK_REASONING_LEVEL || '').trim() || requireEnvVar('VOICE_CHAT_TTS_REASONING_LEVEL')
            }
        }
    };
}

async function waitForReady(connection, timeoutMs = 15000) {
    await entersState(connection, VoiceConnectionStatus.Ready, timeoutMs);
}

// ── Main orchestrator ──────────────────────────────────────────────────────

async function startVoiceChatTTS({ interaction, channel, preventInterruptions = false, mode = 'assistant_chat', startupAnnouncement = null }) {
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

    // Set up STT transcription handlers (realtime mode)
    const transcriptionHandlers = {};
    if (config.audio.transcriptionMode === 'realtime') {
        session.transcription = await createRealtimeTranscriber(config.audio, transcriptionHandlers);
        session.transcription.updateSession({
            language: requireEnvVar('OPENAI_STT_TRANSCRIPTION_LANGUAGE'),
            model: requireEnvVar('OPENAI_TRANSCRIPTION_MODEL'),
            prompt: requireEnvVar('OPENAI_STT_TRANSCRIPTION_PROMPT', { allowEmpty: true }),
            turn_detection: config.audio.useVadEvents ? 'semantic_vad' : 'none'
        });
    }

    // Create LLM handler for conversation inference
    const llm = createLLMHandler({
        interaction,
        config: config.llm,
        ws: session.transcription?.ws,
        discordConnection: session.connection
    });

    // Create mode-specific handler for the turn processor
    let modeHandler;
    if (mode === 'fact_check') {
        const factCheck = createFactCheckHandler({
            model: config.llm.factCheck.model,
            reasoningLevel: config.llm.factCheck.reasoningLevel
        });
        modeHandler = createFactCheckMode({
            factCheckHandler: factCheck,
            interaction,
            ws: session.transcription?.ws,
            discordConnection: session.connection,
            recentMaxEntries: numberFromEnv(process.env.VOICE_FACT_CHECK_RECENT_MAX_ENTRIES, 'VOICE_FACT_CHECK_RECENT_MAX_ENTRIES'),
            recentMaxChars: numberFromEnv(process.env.VOICE_FACT_CHECK_RECENT_MAX_CHARS, 'VOICE_FACT_CHECK_RECENT_MAX_CHARS')
        });
    } else {
        modeHandler = createAssistantChatMode(llm);
    }

    // Wire turn processor: STT transcript -> LLM inference -> TTS speech
    const turnProcessor = createTranscriptTurnProcessor({
        recordTranscript: (payload) => llm.recordTranscript(payload),
        speech,
        config: config.audio,
        connection: session.connection,
        modeHandler,
        interruptAfterSpeechMs: numberFromEnv(process.env.VOICE_CHAT_TTS_INTERRUPT_AFTER_SPEECH_MS, 'VOICE_CHAT_TTS_INTERRUPT_AFTER_SPEECH_MS'),
        maxTranscriptHistoryEntries: numberFromEnv(process.env.VOICE_FACT_CHECK_HISTORY_MAX_ENTRIES, 'VOICE_FACT_CHECK_HISTORY_MAX_ENTRIES')
    });

    // Connect STT events to turn processor
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

    // Attach Discord audio bridge: voice connection <-> STT
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

    // Cleanup handler
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

    // Deliver greeting or startup announcement
    try {
        state.setVoiceChatShutdownStatus(false);
        if (startupAnnouncement && String(startupAnnouncement).trim()) {
            await speech.speak(String(startupAnnouncement).trim(), { forceNoInterruptions: true });
        } else {
            const greeting = await llm.generateGreeting();
            if (greeting) {
                await speech.speak(greeting, { forceNoInterruptions: true });
            }
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

module.exports = {
    startVoiceChatTTS,
    __testables: {
        requireEnvVar,
        parseBooleanEnv,
        numberFromEnv,
        // Re-exported from submodules for backward compatibility
        createThinkingPcmStream,
        createThinkingLoopController,
        createTranscriptTurnProcessor,
        detectFactCheckWakePhrase,
        selectRecentTranscriptWindow,
        scheduleInterruption
    }
};
