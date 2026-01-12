const { gracefulDisconnect } = require('../voice_chat/channelConnection.js');

const toolDef_disconnectVoiceChat = {
    type: 'function',
    function: {
        name: 'disconnect_voice_chat',
        description: 'Disconnects the assistant from the voice chat. ONLY use this tool when the user explicitly asks to leave, disconnect, stop the voice chat, or says goodbye/farewell indicating they want the bot to leave the voice channel.',
        parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false
        }
    }
};

async function disconnect_voice_chat_tool(ws, discordConnection) {
    try {
        if (!ws || !discordConnection) {
            console.warn('[VoiceDisconnectTool] No active session found to disconnect.');
            return 'No active voice chat session is currently running.';
        }

        await gracefulDisconnect(ws, discordConnection);

    } catch (error) {
        console.error('[VoiceDisconnectTool] Failed to process disconnect request:', error);
        return 'Failed to disconnect the voice chat session.';
    }
}

module.exports = {
    toolDef_disconnectVoiceChat,
    disconnect_voice_chat_tool
};
