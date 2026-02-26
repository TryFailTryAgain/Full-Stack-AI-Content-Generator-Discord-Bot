/*
* llmHandler.js
* Pure LLM conversation inference for the voice chat loop.
* Handles prompt/reply cycles, tool calling, and message conversion.
* Fact-check logic lives in factCheckHandler.js.
*/
const { AttachmentBuilder } = require('discord.js');
const { OpenAI } = require('openai');
const { moderateContent } = require('../moderation.js');
const { toolDef_generateImage, generate_image_tool } = require('../tools/imageTool.js');
const { toolDef_disconnectVoiceChat, disconnect_voice_chat_tool } = require('../tools/voiceDisconnectTool.js');
const { toolDef_sendTextToChannel, send_text_to_channel_tool } = require('../tools/sendTextToChannelTool.js');

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
    },
    send_text_to_channel: async ({ functionCall, interaction }) => {
        return send_text_to_channel_tool(functionCall, interaction);
    }
};

const defaultSystemPrompt = 'You are a voice assistant. Keep replies concise for speech.';

function requireEnvVar(name, { allowEmpty = false } = {}) {
    const value = process.env[name];
    if (value === undefined || value === null) {
        throw new Error(`[LLM] Missing required environment variable: ${name}`);
    }

    if (!allowEmpty && String(value).trim() === '') {
        throw new Error(`[LLM] Environment variable ${name} cannot be empty`);
    }

    return value;
}

function normalizeBackend(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['chat', 'completion', 'completions'].includes(normalized)) return 'completions';
    if (['responses', 'response'].includes(normalized)) return 'responses';
    return 'responses';
}

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
    // Check content with OpenAI moderation if realtime moderation is enabled
    if (realtimeModerationEnabled) {
        const modResult = await moderateContent({ text });
        if (modResult.flagged) {
            throw new Error('Content flagged by moderation.');
        }
        // Use cleaned text from moderation (bad-words filter applied)
        return modResult.cleanedText;
    }
    return text;
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
    const maxTokens = config.maxTokens === 'inf'
        ? undefined
        : Number.parseInt(String(config.maxTokens), 10);

    if (config.maxTokens !== 'inf' && !Number.isFinite(maxTokens)) {
        throw new Error(`[LLM] Invalid maxTokens config value: ${config.maxTokens}`);
    }

    const llmConfig = {
        backend: normalizeBackend(config.backend),
        model: config.model,
        maxTokens,
        reasoningLevel: config.reasoningLevel || null,
        systemPrompt: config.systemPrompt || defaultSystemPrompt
    };
    const client = new OpenAI({
        apiKey: requireEnvVar('API_KEY_OPENAI_CHAT'),
        baseURL: requireEnvVar('ADVCONF_OPENAI_CHAT_BASE_URL')
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
        return [toolDef_generateImage, toolDef_disconnectVoiceChat, toolDef_sendTextToChannel].filter(Boolean);
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
        if (llmConfig.backend === 'completions') {
            const payload = {
                model: llmConfig.model,
                messages: convertMessagesToChatInput(state.messages),
                response_format: { type: 'text' },
                tools: rawTools.length ? rawTools : undefined,
                tool_choice: rawTools.length ? 'auto' : undefined,
                store: false
            };
            if (llmConfig.maxTokens) {
                payload.max_completion_tokens = llmConfig.maxTokens;
            }
            if (llmConfig.reasoningLevel) {
                payload.reasoning_effort = llmConfig.reasoningLevel;
            }

            try {
                const response = await state.client.chat.completions.create(payload);
                const message = response?.choices?.[0]?.message;
                if (!message) return null;

                const text = extractChatCompletionText(message, response) || null;
                const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

                if (toolCalls.length) {
                    pushAssistantTurn(text || '', { tool_calls: toolCalls });
                    await handleToolCalls({ toolCalls, interaction: state.interaction, state });
                    return promptModel();
                }

                return text;
            } catch (error) {
                console.error('[LLM] Chat completion failed:', error);
                return null;
            }
        }

        // Responses API
        const tools = normalizeToolsForResponses(rawTools);
        const payload = {
            model: llmConfig.model,
            input: convertMessagesToResponseInput(state.messages),
            text: {
                format: { type: 'text' }
            },
            tools: tools.length ? tools : undefined,
            tool_choice: tools.length ? 'auto' : undefined,
            store: false,
            include: ['reasoning.encrypted_content']
        };
        if (llmConfig.maxTokens) {
            payload.max_output_tokens = llmConfig.maxTokens;
        }
        if (llmConfig.reasoningLevel) {
            payload.reasoning = { effort: llmConfig.reasoningLevel };
        }

        try {
            const response = await state.client.responses.create(payload);
            if (!response) return null;

            const { text, toolCalls } = parseResponseOutput(response);

            if (toolCalls.length) {
                pushAssistantTurn(text || '', { tool_calls: toolCalls });
                await handleToolCalls({ toolCalls, interaction: state.interaction, state });
                return promptModel();
            }

            return text;
        } catch (error) {
            console.error('[LLM] Responses API failed:', error);
            return null;
        }
    }

    async function generateGreeting() {
        const envGreeting = process.env.OPENAI_VOICE_CHAT_TTS_GREETING;
        const greetingPrompt = (typeof envGreeting === 'string' && envGreeting.trim().length > 0)
            ? envGreeting.trim()
            : 'You just joined the Discord voice channel. Say a brief, friendly greeting to everyone present.';
        return handleTranscript({ userId: 'system-injected', username: 'system-injected', text: greetingPrompt });
    }

    async function recordTranscript({ userId, username, text }) {
        const safeText = await ensureSafeContent(text);
        pushUserTurn({ username: username || userId, text: safeText });
        console.log(`[LLM] Transcript from ${username || userId}: ${safeText.substring(0, 100)}...`);
        return safeText;
    }

    async function generateReply() {
        const reply = await promptModel();
        if (reply) {
            pushAssistantTurn(reply);
            console.log(`[LLM] Response: ${reply.substring(0, 100)}...`);
        }
        return reply;
    }

    async function handleTranscript({ userId, username, text }) {
        await recordTranscript({ userId, username, text });
        return generateReply();
    }

    return {
        generateGreeting,
        handleTranscript,
        recordTranscript,
        generateReply
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

function convertMessagesToChatInput(messages = []) {
    const chatMessages = [];

    for (const message of messages) {
        if (!message) continue;

        if (message.role === 'tool') {
            if (!message.tool_call_id) continue;
            chatMessages.push({
                role: 'tool',
                tool_call_id: message.tool_call_id,
                name: message.name,
                content: typeof message.content === 'string' ? message.content : String(message.content || '')
            });
            continue;
        }

        if (!isSupportedMessageRole(message.role)) continue;

        const entry = {
            role: message.role,
            content: hasText(message.content) ? String(message.content) : null
        };

        if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
            entry.tool_calls = message.tool_calls
                .map((toolCall) => {
                    const id = toolCall.id || toolCall.call_id;
                    const name = toolCall.function?.name;
                    if (!id || !name) return null;
                    return {
                        id,
                        type: 'function',
                        function: {
                            name,
                            arguments: toolCall.function?.arguments || '{}'
                        }
                    };
                })
                .filter(Boolean);
        }

        chatMessages.push(entry);
    }

    return chatMessages;
}

function createTextContent(text, role) {
    // Assistant messages use 'output_text', all other roles use 'input_text'
    const contentType = role === 'assistant' ? 'output_text' : 'input_text';
    return [{ type: contentType, text: String(text) }];
}

function extractChatCompletionText(message, response) {
    if (!message) return '';
    if (typeof message.content === 'string') return message.content;
    if (message.content && typeof message.content === 'object' && typeof message.content.text === 'string') {
        return message.content.text;
    }
    if (Array.isArray(message.content)) {
        return message.content
            .map((item) => {
                if (!item) return '';
                if (typeof item === 'string') return item;
                if (typeof item.text === 'string') return item.text;
                if (typeof item.output_text === 'string') return item.output_text;
                if (typeof item.content === 'string') return item.content;
                return '';
            })
            .join('')
            .trim();
    }
    if (typeof message.refusal === 'string' && message.refusal.trim()) return message.refusal;
    if (typeof response?.output_text === 'string' && response.output_text.trim()) return response.output_text;
    if (typeof response?.choices?.[0]?.text === 'string' && response.choices[0].text.trim()) {
        return response.choices[0].text;
    }
    const altContent = response?.choices?.[0]?.message?.content;
    if (typeof altContent === 'string') return altContent;
    return '';
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
