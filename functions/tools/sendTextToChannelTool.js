const DISCORD_MESSAGE_LIMIT = 2000;
const SAFE_CHUNK_LIMIT = 1900;

const toolDef_sendTextToChannel = {
    type: 'function',
    function: {
        name: 'send_text_to_channel',
        description: 'Send a structured text response (like code blocks, long lists, or detailed written instructions) to the Discord text channel where voice chat was started. Use this when spoken output is less useful than formatted written text, or when the user asks you to write/send it in chat.',
        parameters: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: 'The exact markdown/text content to send to the Discord channel.'
                }
            },
            required: ['content'],
            additionalProperties: false
        }
    }
};

function splitForDiscord(content) {
    const text = String(content || '').trim();
    if (!text) return [];
    if (text.length <= DISCORD_MESSAGE_LIMIT) return [text];

    const chunks = [];
    let cursor = 0;

    while (cursor < text.length) {
        const remaining = text.slice(cursor);
        if (remaining.length <= DISCORD_MESSAGE_LIMIT) {
            chunks.push(remaining);
            break;
        }

        const window = remaining.slice(0, SAFE_CHUNK_LIMIT);
        const splitAt = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf(' '));
        const nextChunkLength = splitAt > 0 ? splitAt : SAFE_CHUNK_LIMIT;

        chunks.push(remaining.slice(0, nextChunkLength).trimEnd());
        cursor += nextChunkLength;

        while (cursor < text.length && /\s/.test(text[cursor])) {
            cursor += 1;
        }
    }

    return chunks.filter(Boolean);
}

async function send_text_to_channel_tool(functionCall, interaction) {
    try {
        const args = JSON.parse(functionCall?.arguments || '{}');
        const content = args?.content;
        if (!content || !String(content).trim()) {
            return 'No content provided to send.';
        }

        const channel = interaction?.channel;
        if (!channel || typeof channel.send !== 'function') {
            return 'Unable to send message: no valid Discord channel is available.';
        }

        const chunks = splitForDiscord(content);
        if (!chunks.length) {
            return 'No content provided to send.';
        }

        for (const chunk of chunks) {
            await channel.send({ content: chunk });
        }

        return chunks.length === 1
            ? 'Message sent to channel.'
            : `Message sent to channel in ${chunks.length} parts.`;
    } catch (error) {
        console.error('[SendTextToChannelTool] Failed to send text to channel:', error);
        return 'Failed to send text message to channel.';
    }
}

module.exports = {
    toolDef_sendTextToChannel,
    send_text_to_channel_tool,
    splitForDiscord
};
