const { startVoiceChatTTS } = require('./voice-chat-tts.js');

async function startVoiceFactCheck({ interaction, channel, preventInterruptions = false }) {
    const startupAnnouncement = process.env.OPENAI_VOICE_FACT_CHECK_GREETING
        || 'Fact-check mode is now active. I am transcribing this conversation. Say fact check at any time and I will verify recent spoken claims and post detailed sources in text chat.';

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
