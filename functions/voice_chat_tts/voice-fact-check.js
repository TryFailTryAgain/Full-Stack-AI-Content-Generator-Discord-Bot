const { startVoiceChatTTS } = require('./voice-chat-tts.js');

function requireEnvVar(name, { allowEmpty = false } = {}) {
    const value = process.env[name];
    if (value === undefined || value === null) {
        throw new Error(`[VoiceFactCheck] Missing required environment variable: ${name}`);
    }

    if (!allowEmpty && String(value).trim() === '') {
        throw new Error(`[VoiceFactCheck] Environment variable ${name} cannot be empty`);
    }

    return value;
}

async function startVoiceFactCheck({ interaction, channel, preventInterruptions = false }) {
    const startupAnnouncement = requireEnvVar('OPENAI_VOICE_TTS_FACT_CHECK_GREETING');

    return startVoiceChatTTS({
        interaction,
        channel,
        preventInterruptions,
        mode: 'fact_check',
        startupAnnouncement
    });
}

module.exports = {
    startVoiceFactCheck
};
