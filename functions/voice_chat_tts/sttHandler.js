/*
* sttHandler.js
* Speech-to-text handler using OpenAI's realtime transcription API.
* Manages WebSocket connection for streaming audio transcription.
*/
const WebSocket = require('ws');
const axios = require('axios');

function requireEnvVar(name, { allowEmpty = false } = {}) {
    const value = process.env[name];
    if (value === undefined || value === null) {
        throw new Error(`[STT] Missing required environment variable: ${name}`);
    }

    if (!allowEmpty && String(value).trim() === '') {
        throw new Error(`[STT] Environment variable ${name} cannot be empty`);
    }

    return value;
}

async function createTranscriptionSession(useVadEvents) {
    const model = requireEnvVar('OPENAI_TRANSCRIPTION_MODEL');
    const language = requireEnvVar('OPENAI_STT_TRANSCRIPTION_LANGUAGE');
    const prompt = requireEnvVar('OPENAI_STT_TRANSCRIPTION_PROMPT', { allowEmpty: true });
    const transcriptionCfg = {'model': model};
    if (language) transcriptionCfg.language = language;
    if (prompt) transcriptionCfg.prompt = prompt;

    const turnDetection = useVadEvents
        ? {
            type: 'semantic_vad',
            eagerness: requireEnvVar('OPENAI_VOICE_CHAT_RESPONSE_EAGERNESS')
        }
        : { type: 'none' };

    const base = requireEnvVar('ADVCONF_OPENAI_CHAT_BASE_URL').replace(/\/$/, '');

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
                    Authorization: `Bearer ${requireEnvVar('API_KEY_OPENAI_CHAT')}`,
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
            const transcriptionConfig = { model: model || requireEnvVar('OPENAI_TRANSCRIPTION_MODEL') };
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
                            eagerness: requireEnvVar('OPENAI_VOICE_CHAT_RESPONSE_EAGERNESS')
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

module.exports = {
    createRealtimeTranscriber,
    createTranscriptionSession,
    setupWsMessageLogging
};
