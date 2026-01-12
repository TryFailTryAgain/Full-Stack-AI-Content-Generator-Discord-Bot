/*
* llmHandler.js
* Minimal LLM helper for the voice chat loop
*/
const { AttachmentBuilder } = require('discord.js');
const { OpenAI } = require('openai');
const { filterCheckThenFilterString } = require('../helperFunctions.js');
const { moderateContent } = require('../moderation.js');
const { toolDef_generateImage, generate_image_tool } = require('../tools/imageTool.js');
const { toolDef_disconnectVoiceChat, disconnect_voice_chat_tool } = require('../tools/voiceDisconnectTool.js');

const realtimeModerationEnabled = (() => {
    const flag = process.env.MODERATION_OPENAI_REALTIME;
    if (flag === undefined || flag === null) return false;
    return !['false', '0', 'off', 'no'].includes(String(flag).trim().toLowerCase());
})();

const toolMap = {
    generate_image: async ({ functionCall, interaction }) => {
        const imageBuffer = await generate_image_tool(functionCall, interaction);
        if (!imageBuffer?.length) {
            return 'Image generation failed.';
        }
        const attachment = new AttachmentBuilder(imageBuffer[0]);
        await interaction.channel.send({
            content: 'Generated image from voice chat.',
            files: [attachment]
        });
        return 'Image sent to channel.';
    }
};

const defaultSystemPrompt = 'You are a voice assistant. Keep replies concise for speech.';

function sanitizeRoleName(name) {
    if (!name) return undefined;
    const cleaned = name
        .replace(/\s+/g, '_')
        .replace(/[<|\\/>]/g, '')
        .normalize('NFKD')
        .replace(/[\u0000-\u001F]/g, '')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    return cleaned ? cleaned.slice(0, 64) : undefined;
}

async function ensureSafeContent(text) {
    if (!text) return '';
    const filtered = await filterCheckThenFilterString(text);
    if (realtimeModerationEnabled && await moderateContent({ text: filtered })) {
        throw new Error('Content flagged by moderation.');
    }
    return filtered;
}

async function runToolCall({ call, interaction, voiceToolMap = {} }) {
    const toolName = call.function?.name;
    const handler = toolMap[toolName] || voiceToolMap[toolName];
    if (!handler) {
        console.warn(`[LLM] Tool ${toolName} not found`);
        return `Tool ${toolName} not found.`;
    }
    try {
        return await handler({ functionCall: call.function, interaction });
    } catch (error) {
        console.error(`[LLM] Tool ${toolName} error:`, error);
        return `Tool ${toolName} failed: ${error.message}`;
    }
}

async function handleToolCalls({ toolCalls = [], interaction, state }) {
    for (const call of toolCalls) {
        const output = await runToolCall({ call, interaction, voiceToolMap: state.voiceToolMap });
        const callId = call.call_id || call.id;
        state.messages.push({
            role: 'tool',
            name: call.function?.name,
            tool_call_id: callId,
            content: output || 'Tool executed successfully.'
        });
    }
}

function createLLMHandler({ interaction, config = {}, ws = null, discordConnection = null }) {
    const llmConfig = {
        model: config.model || 'gpt-4.1-nano',
        temperature: Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.85,
        maxTokens: config.maxTokens === 'inf' ? undefined : parseInt(config.maxTokens || '400', 10),
        systemPrompt: config.systemPrompt || defaultSystemPrompt
    };
    const client = new OpenAI({
        apiKey: process.env.API_KEY_OPENAI_CHAT,
        baseURL: process.env.ADVCONF_OPENAI_CHAT_BASE_URL || 'https://api.openai.com/v1'
    });

    const voiceToolMap = {
        disconnect_voice_chat: async () => {
            const result = await disconnect_voice_chat_tool(ws, discordConnection);
            return result || 'Voice chat disconnected successfully.';
        }
    };

    const state = {
        interaction,
        client,
        config: llmConfig,
        messages: [{ role: 'system', content: llmConfig.systemPrompt }],
        voiceToolMap
    };

    function getTools() {
        return [toolDef_generateImage, toolDef_disconnectVoiceChat].filter(Boolean);
    }

    function pushUserTurn({ username, text }) {
        if (!text) return;
        const entry = { role: 'user', content: text };
        const safeName = sanitizeRoleName(username);
        if (safeName) entry.name = safeName;
        state.messages.push(entry);
    }

    function pushAssistantTurn(text, extras = {}) {
        if (!text && !extras.tool_calls) return;
        state.messages.push({ role: 'assistant', content: text, ...extras });
    }

    async function promptModel() {
        const rawTools = getTools();
        const tools = normalizeToolsForResponses(rawTools);
        const payload = {
            model: llmConfig.model,
            temperature: llmConfig.temperature,
            input: convertMessagesToResponseInput(state.messages),
            tools: tools.length ? tools : undefined,
            tool_choice: tools.length ? 'auto' : undefined
        };
        if (llmConfig.maxTokens) {
            payload.max_output_tokens = llmConfig.maxTokens;
        }

        const response = await state.client.responses.create(payload);
        if (!response) return null;

        const { text, toolCalls } = parseResponseOutput(response);

        if (toolCalls.length) {
            pushAssistantTurn(text || '', { tool_calls: toolCalls });
            await handleToolCalls({ toolCalls, interaction: state.interaction, state });
            return promptModel();
        }

        return text;
    }

    async function generateGreeting() {
        const greetingPrompt = 'You just joined the Discord voice channel. Say a brief, friendly greeting to everyone present.';
        pushUserTurn({ username: 'system-injected', text: greetingPrompt });
        const reply = await promptModel();
        if (reply) pushAssistantTurn(reply);
        return reply;
    }

    async function handleTranscript({ userId, username, text }) {
        const safeText = await ensureSafeContent(text);
        pushUserTurn({ username: username || userId, text: safeText });
        console.log(`[LLM] Transcript from ${username || userId}: ${safeText.substring(0, 100)}...`);
        const reply = await promptModel();
        if (reply) {
            pushAssistantTurn(reply);
            console.log(`[LLM] Response: ${reply.substring(0, 100)}...`);
        }
        return reply;
    }

    return {
        generateGreeting,
        handleTranscript
    };
}

function normalizeToolsForResponses(tools = []) {
    return tools
        .map((tool) => {
            if (!tool) return null;
            if (tool.type === 'function') {
                if (tool.name) return tool;
                if (tool.function && tool.function.name) {
                    const { name, description, parameters, strict } = tool.function;
                    return {
                        type: 'function',
                        name,
                        description,
                        parameters,
                        strict
                    };
                }
            }
            return tool;
        })
        .filter(Boolean);
}

function convertMessagesToResponseInput(messages = []) {
    const inputItems = [];

    for (const message of messages) {
        if (!message) continue;

        if (message.role === 'tool') {
            if (!message.tool_call_id) continue;
            inputItems.push({
                type: 'function_call_output',
                call_id: message.tool_call_id,
                output: typeof message.content === 'string' ? message.content : String(message.content || '')
            });
            continue;
        }

        if (isSupportedMessageRole(message.role) && hasText(message.content)) {
            inputItems.push({
                type: 'message',
                role: message.role,
                content: createTextContent(message.content, message.role)
            });
        }

        if (Array.isArray(message.tool_calls)) {
            for (const toolCall of message.tool_calls) {
                if (!toolCall?.function?.name) continue;
                const callId = toolCall.call_id || toolCall.id;
                inputItems.push({
                    type: 'function_call',
                    call_id: callId,
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments || '{}'
                });
            }
        }
    }

    return inputItems;
}

function createTextContent(text, role) {
    // Assistant messages use 'output_text', all other roles use 'input_text'
    const contentType = role === 'assistant' ? 'output_text' : 'input_text';
    return [{ type: contentType, text: String(text) }];
}

function hasText(value) {
    return typeof value === 'string' && value.length > 0;
}

function isSupportedMessageRole(role) {
    return ['system', 'user', 'assistant', 'developer'].includes(role);
}

function parseResponseOutput(response) {
    const outputItems = Array.isArray(response?.output) ? response.output : [];
    const toolCalls = [];
    const textChunks = [];

    for (const item of outputItems) {
        if (item?.type === 'message' && Array.isArray(item.content)) {
            for (const contentItem of item.content) {
                if (contentItem?.type === 'output_text' && typeof contentItem.text === 'string') {
                    textChunks.push(contentItem.text);
                }
            }
        } else if (item?.type === 'function_call' && item.name) {
            toolCalls.push({
                id: item.id,
                call_id: item.call_id || item.id,
                function: {
                    name: item.name,
                    arguments: item.arguments || '{}'
                }
            });
        }
    }

    const combinedText = textChunks.join('\n');
    const text = combinedText || response?.output_text || null;
    return { text, toolCalls };
}

module.exports = { createLLMHandler };
