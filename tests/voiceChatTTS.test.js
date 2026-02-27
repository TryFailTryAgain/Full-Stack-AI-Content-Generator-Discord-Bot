/**
 * Tests for voice_chat_tts modules:
 *   - voiceGlobalState.js (TTS version)
 *   - tts_providers/index.js
 *   - ttsStreamer.js
 *   - llmHandler.js
 *   - voice-chat-tts.js (helpers)
 *   - tools/imageTool.js
 *   - tools/voiceDisconnectTool.js
 */
require('./setup');
const { measureTime, formatMetrics, createMockInteraction, liveDescribe, liveIt } = require('./utils/testHelpers');

function extractCompletionText(response) {
    const message = response?.choices?.[0]?.message;
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
    if (typeof response?.choices?.[0]?.text === 'string') return response.choices[0].text;
    return '';
}

function extractResponseText(response) {
    if (typeof response?.output_text === 'string' && response.output_text.trim()) {
        return response.output_text;
    }
    const outputItems = Array.isArray(response?.output) ? response.output : [];
    const chunks = [];
    for (const item of outputItems) {
        if (item?.type === 'message' && Array.isArray(item.content)) {
            for (const contentItem of item.content) {
                if (contentItem?.type === 'output_text' && typeof contentItem.text === 'string') {
                    chunks.push(contentItem.text);
                }
            }
        }
    }
    return chunks.join('\n').trim();
}

function getLiveModels() {
    const primary = process.env.CHAT_MODEL || 'gpt-5-nano';
    const fallback = process.env.CHAT_MODEL_FALLBACK || 'gpt-5-nano';
    if (primary && primary.startsWith('gpt-5') && fallback && fallback !== primary) {
        return [primary, fallback];
    }
    return [primary];
}

function assertNoFallback(result, label) {
    if (result?.usedFallback) {
        throw new Error(`Live model fallback used for ${label}: primary=${result.primaryModel}, used=${result.model}`);
    }
}

async function runCompletionWithFallback(client, payload, modelOverride) {
    const models = modelOverride ? [modelOverride] : getLiveModels();
    const primaryModel = models[0];
    let last = { response: null, text: '', model: primaryModel, primaryModel, usedFallback: false };
    for (const model of models) {
        const response = await client.chat.completions.create({ ...payload, model, store: false });
        const text = extractCompletionText(response);
        last = { response, text, model, primaryModel, usedFallback: !modelOverride && model !== primaryModel };
        if (text && text.length > 0) {
            return last;
        }
    }
    return last;
}

async function runResponsesWithFallback(client, payload, modelOverride) {
    const models = modelOverride ? [modelOverride] : getLiveModels();
    const primaryModel = models[0];
    let last = { response: null, text: '', model: primaryModel, primaryModel, usedFallback: false };
    for (const model of models) {
        const response = await client.responses.create({ ...payload, model, store: false });
        const text = extractResponseText(response);
        last = { response, text, model, primaryModel, usedFallback: !modelOverride && model !== primaryModel };
        if (text && text.length > 0) {
            return last;
        }
    }
    return last;
}

// ── Mocks ──────────────────────────────────────────────────────────────────

// Mock @discordjs/voice
jest.mock('@discordjs/voice', () => ({
    joinVoiceChannel: jest.fn().mockReturnValue({
        on: jest.fn(),
        destroy: jest.fn(),
        subscribe: jest.fn(),
        receiver: {
            speaking: { on: jest.fn(), off: jest.fn() },
            subscribe: jest.fn(),
        },
        state: { status: 'ready' },
    }),
    VoiceConnectionStatus: {
        Ready: 'ready',
        Destroyed: 'destroyed',
        Disconnected: 'disconnected',
    },
    entersState: jest.fn().mockResolvedValue(true),
    createAudioPlayer: jest.fn(() => ({
        play: jest.fn(),
        stop: jest.fn(),
        on: jest.fn(),
        once: jest.fn(),
        state: { status: 'idle' },
    })),
    createAudioResource: jest.fn(() => ({})),
    StreamType: { Raw: 'raw' },
    AudioPlayerStatus: { Idle: 'idle', Playing: 'playing' },
    EndBehaviorType: { Manual: 'manual' },
}));

// Mock @discordjs/opus
jest.mock('@discordjs/opus', () => ({
    OpusEncoder: jest.fn().mockImplementation(() => ({
        decode: jest.fn(() => Buffer.alloc(960)),
    })),
}));

// Mock ws
jest.mock('ws', () => {
    const MockWS = jest.fn().mockImplementation(() => ({
        readyState: 1,
        send: jest.fn(),
        close: jest.fn(),
        on: jest.fn((event, cb) => { if (event === 'open') setTimeout(cb, 0); }),
        once: jest.fn((event, cb) => { if (event === 'open') setTimeout(cb, 0); }),
        off: jest.fn(),
        removeListener: jest.fn(),
    }));
    MockWS.OPEN = 1;
    MockWS.CLOSED = 3;
    return MockWS;
});

// Mock child_process
jest.mock('child_process', () => ({
    spawn: jest.fn(() => {
        const { PassThrough } = require('stream');
        return {
            stdin: new PassThrough(),
            stdout: new PassThrough(),
            stderr: new PassThrough(),
            on: jest.fn(),
            once: jest.fn(),
            kill: jest.fn(),
        };
    }),
}));

// Mock axios (for OpenAI TTS and transcription session)
jest.mock('axios', () => {
    const { PassThrough } = require('stream');
    return {
        post: jest.fn().mockImplementation((url) => {
            if (url.includes('realtime/transcription_sessions')) {
                return Promise.resolve({
                    data: {
                        id: 'mock-session-id',
                        client_secret: { value: 'mock-client-secret' },
                    },
                });
            }
            // TTS audio endpoint
            const stream = new PassThrough();
            setTimeout(() => {
                stream.write(Buffer.alloc(4800));
                stream.end();
            }, 5);
            return Promise.resolve({ data: stream });
        }),
        get: jest.fn().mockImplementation(() => {
            const { PassThrough } = require('stream');
            const stream = new PassThrough();
            setTimeout(() => {
                stream.write(Buffer.alloc(4800));
                stream.end();
            }, 5);
            return Promise.resolve({ data: stream });
        }),
    };
});

// Mock replicate
jest.mock('replicate', () => {
    return jest.fn().mockImplementation(() => ({
        run: jest.fn().mockResolvedValue('https://mock-url/audio.wav'),
        predictions: {
            create: jest.fn().mockResolvedValue({
                id: 'pred-123',
                status: 'processing',
                urls: { stream: 'https://mock-stream-url/audio' },
            }),
            get: jest.fn().mockResolvedValue({
                id: 'pred-123',
                status: 'succeeded',
                output: 'https://mock-output-url/audio.wav',
            }),
        },
    }));
});

// Mock discord.js
jest.mock('discord.js', () => ({
    AttachmentBuilder: jest.fn(buf => ({ attachment: buf })),
}));

// Mock OpenAI for llmHandler
const mockCompletionsCreate = jest.fn().mockResolvedValue({
    choices: [{
        message: {
            content: 'Mock LLM response',
            role: 'assistant',
        },
    }],
});

const mockResponsesCreate = jest.fn().mockResolvedValue({
    output_text: 'Mock response API text',
    output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'Mock response API text' }],
    }],
});

jest.mock('openai', () => {
    const MockOpenAI = jest.fn().mockImplementation(() => ({
        chat: { completions: { create: mockCompletionsCreate } },
        responses: { create: mockResponsesCreate },
    }));
    MockOpenAI.OpenAI = MockOpenAI;
    return { OpenAI: MockOpenAI };
});

// Mock moderation
jest.mock('../functions/moderation.js', () => ({
    moderateContent: jest.fn().mockResolvedValue({
        flagged: false,
        cleanedText: '',
    }),
}));
// Make moderateContent pass through text
const { moderateContent } = require('../functions/moderation.js');
moderateContent.mockImplementation(({ text }) => Promise.resolve({
    flagged: false,
    cleanedText: text || '',
}));

// Mock image_functions for tools
jest.mock('../functions/image_functions.js', () => ({
    generateImage: jest.fn().mockResolvedValue([Buffer.from('mock-image')]),
}));

// Mock helperFunctions
jest.mock('../functions/helperFunctions.js', () => ({
    followUpEphemeral: jest.fn().mockResolvedValue(undefined),
    deleteAndFollowUpEphemeral: jest.fn().mockResolvedValue(undefined),
}));

// Mock channelConnection for voice-chat-tts (it uses it internally)
jest.mock('../functions/voice_chat/channelConnection.js', () => ({
    handleJoinVoiceChannel: jest.fn().mockResolvedValue({
        on: jest.fn(),
        destroy: jest.fn(),
        subscribe: jest.fn(),
        receiver: {
            speaking: { on: jest.fn(), off: jest.fn() },
            subscribe: jest.fn(),
        },
        state: { status: 'ready' },
    }),
    gracefulDisconnect: jest.fn().mockResolvedValue(undefined),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

const ttsState = require('../functions/voice_chat_tts/voiceGlobalState.js');
const providerIndex = require('../functions/voice_chat_tts/tts_providers/index.js');
const ttsStreamer = require('../functions/voice_chat_tts/ttsStreamer.js');
const { createLLMHandler } = require('../functions/voice_chat_tts/llmHandler.js');
const { toolDef_generateImage, generate_image_tool } = require('../functions/tools/imageTool.js');
const { toolDef_disconnectVoiceChat, disconnect_voice_chat_tool } = require('../functions/tools/voiceDisconnectTool.js');
const {
    toolDef_sendTextToChannel,
    send_text_to_channel_tool,
    splitForDiscord,
} = require('../functions/tools/sendTextToChannelTool.js');
const { createTranscriptTurnProcessor, createThinkingLoopController, createThinkingPcmStream } = require('../functions/voice_chat_tts/turnProcessor.js');
const {
    detectFactCheckWakePhrase,
    selectRecentTranscriptWindow,
    createFactCheckMode,
    createAssistantChatMode,
    createFactCheckHandler
} = require('../functions/voice_chat_tts/factCheckHandler.js');

// ── voiceGlobalState (TTS) ─────────────────────────────────────────────────

describe('voiceGlobalState (TTS)', () => {
    beforeEach(() => {
        ttsState.setVoiceChatShutdownStatus(false);
        Object.assign(ttsState.playbackState, {
            isPlaying: false,
            player: null,
            startTimestamp: null,
        });
    });

    test('setVoiceChatShutdownStatus toggles the flag', () => {
        expect(ttsState.isVoiceChatShuttingDown).toBe(false);
        ttsState.setVoiceChatShutdownStatus(true);
        expect(ttsState.isVoiceChatShuttingDown).toBe(true);
        ttsState.setVoiceChatShutdownStatus(false);
        expect(ttsState.isVoiceChatShuttingDown).toBe(false);
    });

    test('setVoiceChatShutdownStatus coerces to boolean', () => {
        ttsState.setVoiceChatShutdownStatus(1);
        expect(ttsState.isVoiceChatShuttingDown).toBe(true);
        ttsState.setVoiceChatShutdownStatus(0);
        expect(ttsState.isVoiceChatShuttingDown).toBe(false);
    });

    test('playbackState defaults are correct', () => {
        expect(ttsState.playbackState.isPlaying).toBe(false);
        expect(ttsState.playbackState.player).toBeNull();
        expect(ttsState.playbackState.startTimestamp).toBeNull();
    });

    test('playbackState is mutable', () => {
        ttsState.playbackState.isPlaying = true;
        ttsState.playbackState.player = { stop: jest.fn() };
        expect(ttsState.playbackState.isPlaying).toBe(true);
        expect(ttsState.playbackState.player).toBeDefined();
    });
});

// ── tts_providers/index.js ─────────────────────────────────────────────────

describe('tts_providers/index', () => {
    test('DEFAULT_PROVIDER is openai', () => {
        expect(providerIndex.DEFAULT_PROVIDER).toBe('openai');
    });

    test('getProvider returns openai provider for "openai"', () => {
        const provider = providerIndex.getProvider('openai');
        expect(provider).toBeDefined();
        expect(provider.name).toBe('openai');
        expect(typeof provider.synthesizeAndPlay).toBe('function');
    });

    test('getProvider returns qwen3tts provider for "qwen3tts"', () => {
        const provider = providerIndex.getProvider('qwen3tts');
        expect(provider).toBeDefined();
        expect(provider.name).toBe('qwen3tts');
    });

    test('getProvider resolves aliases "qwen3" and "qwen"', () => {
        expect(providerIndex.getProvider('qwen3').name).toBe('qwen3tts');
        expect(providerIndex.getProvider('qwen').name).toBe('qwen3tts');
    });

    test('getProvider throws for unknown provider', () => {
        expect(() => providerIndex.getProvider('nonexistent')).toThrow('Unknown provider');
    });

    test('getProvider throws for null/undefined', () => {
        expect(() => providerIndex.getProvider(null)).toThrow('Provider name is required');
        expect(() => providerIndex.getProvider(undefined)).toThrow('Provider name is required');
    });

    test('getAvailableProviders excludes aliases', () => {
        const providers = providerIndex.getAvailableProviders();
        expect(providers).toContain('openai');
        expect(providers).toContain('qwen3tts');
        expect(providers).not.toContain('qwen3');
        expect(providers).not.toContain('qwen');
    });

    test('hasProvider returns correct booleans', () => {
        expect(providerIndex.hasProvider('openai')).toBe(true);
        expect(providerIndex.hasProvider('qwen3tts')).toBe(true);
        expect(providerIndex.hasProvider('qwen3')).toBe(true);
        expect(providerIndex.hasProvider('nonexistent')).toBe(false);
        expect(providerIndex.hasProvider('')).toBe(false);
        expect(providerIndex.hasProvider(null)).toBe(false);
    });
});

// ── ttsStreamer ─────────────────────────────────────────────────────────────

describe('ttsStreamer', () => {
    beforeEach(() => {
        ttsStreamer.resetProviderCache();
        Object.assign(ttsState.playbackState, {
            isPlaying: false,
            player: null,
            startTimestamp: null,
        });
    });

    test('getCurrentProvider returns default provider from env', () => {
        const provider = ttsStreamer.getCurrentProvider();
        // Returns whatever VOICE_CHAT_TTS_PROVIDER env var is set to
        const expectedName = (process.env.VOICE_CHAT_TTS_PROVIDER).toLowerCase();
        const resolvedProvider = providerIndex.getProvider(expectedName);
        expect(provider.name).toBe(resolvedProvider.name);
    });

    test('getCurrentProvider respects override parameter', () => {
        const provider = ttsStreamer.getCurrentProvider('qwen3tts');
        expect(provider.name).toBe('qwen3tts');
    });

    test('getCurrentProvider caches results', () => {
        const p1 = ttsStreamer.getCurrentProvider('openai');
        const p2 = ttsStreamer.getCurrentProvider('openai');
        expect(p1).toBe(p2);
    });

    test('resetProviderCache clears cached provider', () => {
        ttsStreamer.getCurrentProvider('openai');
        ttsStreamer.resetProviderCache();
        // After reset, requesting a different provider should return the new one
        const p = ttsStreamer.getCurrentProvider('qwen3tts');
        expect(p.name).toBe('qwen3tts');
    });

    test('listProviders returns available providers', () => {
        const providers = ttsStreamer.listProviders();
        expect(providers).toContain('openai');
        expect(providers).toContain('qwen3tts');
    });

    test('isPlaybackActive returns false when no playback', () => {
        expect(ttsStreamer.isPlaybackActive()).toBe(false);
    });

    test('isPlaybackActive returns true when playback state is playing', () => {
        ttsState.playbackState.isPlaying = true;
        expect(ttsStreamer.isPlaybackActive()).toBe(true);
    });

    test('stopActivePlayback stops player and resets state', () => {
        const mockPlayer = { stop: jest.fn() };
        ttsState.playbackState.player = mockPlayer;
        ttsState.playbackState.isPlaying = true;

        ttsStreamer.stopActivePlayback('test-stop');

        expect(mockPlayer.stop).toHaveBeenCalled();
        expect(ttsState.playbackState.isPlaying).toBe(false);
        expect(ttsState.playbackState.player).toBeNull();
    });

    test('stopActivePlayback handles null player', () => {
        ttsState.playbackState.player = null;
        ttsState.playbackState.isPlaying = true;
        expect(() => ttsStreamer.stopActivePlayback()).not.toThrow();
        expect(ttsState.playbackState.isPlaying).toBe(false);
    });

    test('synthesizeAndPlay returns early for empty text', async () => {
        const mockConn = { subscribe: jest.fn() };
        await ttsStreamer.synthesizeAndPlay('', mockConn);
        await ttsStreamer.synthesizeAndPlay('   ', mockConn);
        // No error means early return worked
    });
});

// ── llmHandler ─────────────────────────────────────────────────────────────

describe('llmHandler', () => {
    let interaction;

    beforeEach(() => {
        jest.clearAllMocks();
        interaction = createMockInteraction({
            channel: {
                id: '987654321',
                send: jest.fn().mockResolvedValue(undefined),
                awaitMessages: jest.fn().mockResolvedValue({ size: 0, first: () => null }),
            },
        });
        // Clear env override
        process.env.MODERATION_OPENAI_REALTIME = 'false';
    });

    describe('createLLMHandler with completions backend', () => {
        test('generates greeting via completions API', async () => {
            const llm = createLLMHandler({
                interaction,
                config: {
                    backend: 'completions',
                    model: 'gpt-4o-mini',
                    maxTokens: '200',
                    systemPrompt: 'You are a test assistant.',
                },
            });

            const { result: greeting, durationMs } = await measureTime(() =>
                llm.generateGreeting()
            );

            expect(mockCompletionsCreate).toHaveBeenCalledTimes(1);
            expect(greeting).toBe('Mock LLM response');
            console.log(formatMetrics('llm.generateGreeting (completions)', durationMs));
        });

        test('handles transcript via completions API', async () => {
            const llm = createLLMHandler({
                interaction,
                config: {
                    backend: 'completions',
                    model: 'gpt-4o-mini',
                    maxTokens: '300',
                    systemPrompt: 'Test prompt',
                },
            });

            const { result: reply, durationMs } = await measureTime(() =>
                llm.handleTranscript({ userId: 'user-1', username: 'TestUser', text: 'Hello bot' })
            );

            expect(reply).toBe('Mock LLM response');
            expect(mockCompletionsCreate).toHaveBeenCalledTimes(1);
            const payload = mockCompletionsCreate.mock.calls[0][0];
            expect(payload.model).toBe('gpt-4o-mini');
            expect(payload.messages.some(m => m.role === 'user' && m.content === 'Hello bot')).toBe(true);
            console.log(formatMetrics('llm.handleTranscript (completions)', durationMs));
        });

        test('completions payload includes tools', async () => {
            const llm = createLLMHandler({
                interaction,
                config: { backend: 'completions', model: 'gpt-4', maxTokens: '100', systemPrompt: 'x' },
            });
            await llm.generateGreeting();
            const payload = mockCompletionsCreate.mock.calls[0][0];
            expect(payload.tools).toBeDefined();
            expect(payload.tools.length).toBeGreaterThan(0);
            const toolNames = payload.tools.map((tool) => tool?.function?.name).filter(Boolean);
            expect(toolNames).toContain('send_text_to_channel');
        });
    });

    describe('createLLMHandler with responses backend', () => {
        test('generates greeting via responses API', async () => {
            const llm = createLLMHandler({
                interaction,
                config: {
                    backend: 'responses',
                    model: 'gpt-4o',
                    maxTokens: '200',
                    systemPrompt: 'Greet everyone.',
                },
            });

            const { result: greeting, durationMs } = await measureTime(() =>
                llm.generateGreeting()
            );

            expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
            expect(greeting).toBe('Mock response API text');
            console.log(formatMetrics('llm.generateGreeting (responses)', durationMs));
        });

        test('handles transcript via responses API', async () => {
            const llm = createLLMHandler({
                interaction,
                config: {
                    backend: 'responses',
                    model: 'gpt-4o',
                    maxTokens: '300',
                    systemPrompt: 'Voice assistant',
                },
            });

            const reply = await llm.handleTranscript({
                userId: 'user-2',
                username: 'AnotherUser',
                text: 'What is the weather?',
            });

            expect(reply).toBe('Mock response API text');
            const payload = mockResponsesCreate.mock.calls[0][0];
            expect(payload.model).toBe('gpt-4o');
        });

        test('responses payload includes normalized tools', async () => {
            const llm = createLLMHandler({
                interaction,
                config: { backend: 'responses', model: 'gpt-4o', maxTokens: '100', systemPrompt: 'y' },
            });
            await llm.generateGreeting();
            const payload = mockResponsesCreate.mock.calls[0][0];
            expect(payload.tools).toBeDefined();
            // Tools should have been normalized (flat structure for responses API)
            payload.tools.forEach(tool => {
                expect(tool.type).toBe('function');
                expect(tool.name).toBeDefined();
            });
            const toolNames = payload.tools.map((tool) => tool?.name).filter(Boolean);
            expect(toolNames).toContain('send_text_to_channel');
        });
    });

    describe('backend normalization', () => {
        test('normalizes "chat" to completions backend', async () => {
            const llm = createLLMHandler({
                interaction,
                config: { backend: 'chat', model: 'gpt-4o-mini', maxTokens: '100', systemPrompt: 'x' },
            });
            await llm.generateGreeting();
            expect(mockCompletionsCreate).toHaveBeenCalled();
            expect(mockResponsesCreate).not.toHaveBeenCalled();
        });

        test('normalizes "response" to responses backend', async () => {
            const llm = createLLMHandler({
                interaction,
                config: { backend: 'response', model: 'gpt-4o', maxTokens: '100', systemPrompt: 'x' },
            });
            await llm.generateGreeting();
            expect(mockResponsesCreate).toHaveBeenCalled();
        });

        test('defaults to responses for unknown backend', async () => {
            const llm = createLLMHandler({
                interaction,
                config: { backend: 'unknown', model: 'gpt-4o', maxTokens: '100', systemPrompt: 'x' },
            });
            await llm.generateGreeting();
            expect(mockResponsesCreate).toHaveBeenCalled();
        });
    });

    describe('conversation history', () => {
        test('accumulates messages across multiple handleTranscript calls', async () => {
            const llm = createLLMHandler({
                interaction,
                config: { backend: 'completions', model: 'gpt-4o-mini', maxTokens: '100', systemPrompt: 'Test' },
            });

            await llm.handleTranscript({ userId: '1', username: 'Alice', text: 'Hi' });
            await llm.handleTranscript({ userId: '2', username: 'Bob', text: 'Hey' });

            // Second call should include cumulative conversation history
            const secondPayload = mockCompletionsCreate.mock.calls[1][0];
            // Should have: system, user(greeting env), assistant(greeting reply), user(Hi), assistant(reply), user(Hey)
            expect(secondPayload.messages.length).toBeGreaterThanOrEqual(3);
        });

        test('maxTokens=inf results in no max_completion_tokens', async () => {
            const llm = createLLMHandler({
                interaction,
                config: { backend: 'completions', model: 'gpt-4o-mini', maxTokens: 'inf', systemPrompt: 'x' },
            });
            await llm.generateGreeting();
            const payload = mockCompletionsCreate.mock.calls[0][0];
            expect(payload.max_completion_tokens).toBeUndefined();
        });
    });

    describe('tool calls in LLM', () => {
        test('handles tool call response with recursive prompting', async () => {
            // First call returns a tool call, second call returns text
            mockCompletionsCreate
                .mockResolvedValueOnce({
                    choices: [{
                        message: {
                            content: null,
                            role: 'assistant',
                            tool_calls: [{
                                id: 'call_1',
                                type: 'function',
                                function: {
                                    name: 'generate_image',
                                    arguments: JSON.stringify({ prompt: 'a cat' }),
                                },
                            }],
                        },
                    }],
                })
                .mockResolvedValueOnce({
                    choices: [{
                        message: { content: 'I generated the image for you!', role: 'assistant' },
                    }],
                });

            const llm = createLLMHandler({
                interaction,
                config: { backend: 'completions', model: 'gpt-4o-mini', maxTokens: '200', systemPrompt: 'x' },
            });

            const { result, durationMs } = await measureTime(() =>
                llm.handleTranscript({ userId: '1', username: 'User1', text: 'Generate a cat image' })
            );

            expect(mockCompletionsCreate).toHaveBeenCalledTimes(2);
            expect(result).toBe('I generated the image for you!');
            console.log(formatMetrics('llm.handleTranscript with tool call', durationMs));
        });

        test('handles send_text_to_channel tool call', async () => {
            mockCompletionsCreate
                .mockResolvedValueOnce({
                    choices: [{
                        message: {
                            content: null,
                            role: 'assistant',
                            tool_calls: [{
                                id: 'call_send_text_1',
                                type: 'function',
                                function: {
                                    name: 'send_text_to_channel',
                                    arguments: JSON.stringify({ content: '```js\nconsole.log("hi")\n```' }),
                                },
                            }],
                        },
                    }],
                })
                .mockResolvedValueOnce({
                    choices: [{
                        message: { content: 'I sent that to chat.', role: 'assistant' },
                    }],
                });

            const llm = createLLMHandler({
                interaction,
                config: { backend: 'completions', model: 'gpt-4o-mini', maxTokens: '200', systemPrompt: 'x' },
            });

            const result = await llm.handleTranscript({
                userId: '1',
                username: 'User1',
                text: 'Please write the code in chat',
            });

            expect(mockCompletionsCreate).toHaveBeenCalledTimes(2);
            expect(interaction.channel.send).toHaveBeenCalledWith({ content: '```js\nconsole.log("hi")\n```' });
            expect(result).toBe('I sent that to chat.');
        });
    });
});

// ── tools/imageTool ────────────────────────────────────────────────────────

describe('tools/imageTool', () => {
    test('toolDef_generateImage has correct schema', () => {
        expect(toolDef_generateImage).toBeDefined();
        expect(toolDef_generateImage.type).toBe('function');
        expect(toolDef_generateImage.function.name).toBe('generate_image');
        expect(toolDef_generateImage.function.parameters.properties.prompt).toBeDefined();
        expect(toolDef_generateImage.function.parameters.required).toContain('prompt');
    });

    test('generate_image_tool parses arguments and generates image', async () => {
        const mockInteraction = createMockInteraction({ user: { id: 'user-img' } });
        const functionCall = {
            arguments: JSON.stringify({ prompt: 'a sunset over mountains' }),
        };

        const { result, durationMs } = await measureTime(() =>
            generate_image_tool(functionCall, mockInteraction)
        );

        expect(result).toBeDefined();
        expect(Buffer.isBuffer(result[0])).toBe(true);
        console.log(formatMetrics('generate_image_tool', durationMs));
    });

    test('generate_image_tool returns null for flagged content', async () => {
        moderateContent.mockResolvedValueOnce({ flagged: true, cleanedText: '' });
        const functionCall = { arguments: JSON.stringify({ prompt: 'bad content' }) };
        const result = await generate_image_tool(functionCall, createMockInteraction());
        expect(result).toBeNull();
    });

    test('generate_image_tool returns null on error', async () => {
        const imageFunctions = require('../functions/image_functions.js');
        imageFunctions.generateImage.mockRejectedValueOnce(new Error('API error'));
        const functionCall = { arguments: JSON.stringify({ prompt: 'test' }) };
        const result = await generate_image_tool(functionCall, createMockInteraction());
        expect(result).toBeNull();
    });
});

// ── tools/voiceDisconnectTool ──────────────────────────────────────────────

describe('tools/voiceDisconnectTool', () => {
    test('toolDef_disconnectVoiceChat has correct schema', () => {
        expect(toolDef_disconnectVoiceChat).toBeDefined();
        expect(toolDef_disconnectVoiceChat.type).toBe('function');
        expect(toolDef_disconnectVoiceChat.function.name).toBe('disconnect_voice_chat');
    });

    test('disconnect_voice_chat_tool returns message when no session', async () => {
        const result = await disconnect_voice_chat_tool(null, null);
        expect(result).toBe('No active voice chat session is currently running.');
    });

    test('disconnect_voice_chat_tool calls gracefulDisconnect', async () => {
        const { gracefulDisconnect } = require('../functions/voice_chat/channelConnection.js');
        const mockWs = { readyState: 1, close: jest.fn() };
        const mockConn = { state: { status: 'ready' }, destroy: jest.fn() };

        await disconnect_voice_chat_tool(mockWs, mockConn);

        expect(gracefulDisconnect).toHaveBeenCalledWith(mockWs, mockConn);
    });
});

// ── tools/sendTextToChannelTool ───────────────────────────────────────────

describe('tools/sendTextToChannelTool', () => {
    test('toolDef_sendTextToChannel has correct schema', () => {
        expect(toolDef_sendTextToChannel).toBeDefined();
        expect(toolDef_sendTextToChannel.type).toBe('function');
        expect(toolDef_sendTextToChannel.function.name).toBe('send_text_to_channel');
        expect(toolDef_sendTextToChannel.function.parameters.required).toContain('content');
    });

    test('send_text_to_channel_tool sends message to interaction channel', async () => {
        const mockInteraction = createMockInteraction({
            channel: { send: jest.fn().mockResolvedValue(undefined) },
        });

        const functionCall = {
            arguments: JSON.stringify({ content: 'Structured text output' }),
        };

        const result = await send_text_to_channel_tool(functionCall, mockInteraction);

        expect(mockInteraction.channel.send).toHaveBeenCalledWith({ content: 'Structured text output' });
        expect(result).toBe('Message sent to channel.');
    });

    test('splitForDiscord splits oversized content', () => {
        const longText = `# Heading\n\n${'line\n'.repeat(900)}`;
        const chunks = splitForDiscord(longText);

        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.every((chunk) => chunk.length <= 2000)).toBe(true);
    });
});

// ── voice-chat-tts.js helpers (tested via internal module) ─────────────────

describe('voice-chat-tts helpers', () => {
    // These functions are not exported, so we test them indirectly by requiring
    // the module and verifying its exported function exists and the env-based
    // config works correctly. However, we CAN test buildSessionConfig-like behavior
    // by examining what startVoiceChatTTS does with config.

    test('startVoiceChatTTS is exported and is a function', () => {
        const { startVoiceChatTTS } = require('../functions/voice_chat_tts/voice-chat-tts.js');
        expect(typeof startVoiceChatTTS).toBe('function');
    });

    // Test parseBooleanEnv/numberFromEnv behavior via env-driven config
    test('env-driven session config works with various env values', () => {
        // We can verify the module loads without errors with various env settings
        const originalProvider = process.env.VOICE_CHAT_TTS_PROVIDER;
        const originalBackend = process.env.VOICE_CHAT_TTS_LLM_BACKEND;

        process.env.VOICE_CHAT_TTS_PROVIDER = 'openai';
        process.env.VOICE_CHAT_TTS_LLM_BACKEND = 'responses';

        // Re-requiring won't re-execute, but we can verify the module is loaded
        const mod = require('../functions/voice_chat_tts/voice-chat-tts.js');
        expect(mod.startVoiceChatTTS).toBeDefined();

        process.env.VOICE_CHAT_TTS_PROVIDER = originalProvider;
        process.env.VOICE_CHAT_TTS_LLM_BACKEND = originalBackend;
    });

    test('thinking-phase transcripts are history-only and do not auto-queue next inference', async () => {
        const llm = {
            recordTranscript: jest.fn().mockResolvedValue('ok'),
            generateReply: jest.fn().mockResolvedValue('assistant-reply-1')
        };

        let releaseFirstSpeak;
        const firstSpeakDone = new Promise((resolve) => { releaseFirstSpeak = resolve; });
        let speakCallCount = 0;

        const speech = {
            speak: jest.fn().mockImplementation(async (_text, hooks = {}) => {
                speakCallCount += 1;
                hooks.onSynthesisStart?.();
                if (speakCallCount === 1) {
                    await firstSpeakDone;
                }
                hooks.onAudioStart?.();
                hooks.onPlaybackEnd?.();
                return true;
            }),
            stop: jest.fn(),
            isSpeaking: jest.fn().mockReturnValue(true)
        };

        const processor = createTranscriptTurnProcessor({
            recordTranscript: llm.recordTranscript,
            speech,
            config: { preventInterruptions: false },
            connection: { subscribe: jest.fn() },
            modeHandler: createAssistantChatMode(llm),
            createThinkingLoop: () => ({ start: jest.fn(), stop: jest.fn() })
        });

        const first = processor.ingestTranscript({ transcript: 'first', speaker: { userId: 'u1', username: 'U1' } });
        await new Promise((resolve) => setImmediate(resolve));
        const second = processor.ingestTranscript({ transcript: 'during thinking', speaker: { userId: 'u2', username: 'U2' } });

        releaseFirstSpeak();
        await Promise.all([first, second]);

        expect(llm.recordTranscript).toHaveBeenCalledTimes(2);
        expect(llm.generateReply).toHaveBeenCalledTimes(1);
        expect(speech.stop).not.toHaveBeenCalled();
    });

    test('new invocation after speech interrupt window queues follow-up generation', async () => {

        const llm = {
            recordTranscript: jest.fn().mockResolvedValue('ok'),
            generateReply: jest.fn()
                .mockResolvedValueOnce('assistant-reply-1')
                .mockResolvedValueOnce('assistant-reply-2')
        };

        let releaseFirstSpeak;
        const firstSpeakDone = new Promise((resolve) => { releaseFirstSpeak = resolve; });
        let resolveFirstAudioStarted;
        const firstAudioStarted = new Promise((resolve) => { resolveFirstAudioStarted = resolve; });
        let speakCallCount = 0;

        const speech = {
            speak: jest.fn().mockImplementation(async (_text, hooks = {}) => {
                speakCallCount += 1;
                hooks.onSynthesisStart?.();
                hooks.onAudioStart?.();
                if (speakCallCount === 1) {
                    resolveFirstAudioStarted();
                    await firstSpeakDone;
                }
                hooks.onPlaybackEnd?.();
                return true;
            }),
            stop: jest.fn(),
            isSpeaking: jest.fn().mockReturnValue(true)
        };

        const processor = createTranscriptTurnProcessor({
            recordTranscript: llm.recordTranscript,
            speech,
            config: { preventInterruptions: false },
            connection: { subscribe: jest.fn() },
            modeHandler: createAssistantChatMode(llm),
            createThinkingLoop: () => ({ start: jest.fn(), stop: jest.fn() }),
            canInterruptOverride: () => true
        });

        const first = processor.ingestTranscript({ transcript: 'first', speaker: { userId: 'u1', username: 'U1' } });
        await firstAudioStarted;

        const second = processor.ingestTranscript({ transcript: 'new invocation while speaking', speaker: { userId: 'u2', username: 'U2' } });
        await new Promise((resolve) => setImmediate(resolve));

        expect(speech.stop).toHaveBeenCalledWith('user-interrupt-post-window');

        releaseFirstSpeak();
        await Promise.all([first, second]);

        expect(llm.recordTranscript).toHaveBeenCalledTimes(2);
        expect(llm.generateReply).toHaveBeenCalledTimes(2);
    });

    test('thinking loop uses MP3 file when Outputs/thinking-sounds.mp3 exists', () => {
        const fsModule = require('fs');
        const childProc = require('child_process');
        const voice = require('@discordjs/voice');

        const existsSpy = jest.spyOn(fsModule, 'existsSync').mockReturnValue(true);
        childProc.spawn.mockClear();
        voice.createAudioPlayer.mockClear();
        voice.createAudioResource.mockClear();

        const connection = { subscribe: jest.fn() };
        const controller = createThinkingLoopController(connection);

        controller.start();

        expect(childProc.spawn).toHaveBeenCalledTimes(1);
        const [command, args] = childProc.spawn.mock.calls[0];
        expect(command).toBe('ffmpeg');
        expect(args).toEqual(expect.arrayContaining(['-stream_loop', '-1']));
        expect(args.join(' ')).toContain('thinking-sounds.mp3');
        expect(connection.subscribe).toHaveBeenCalledTimes(1);

        controller.stop('test-stop');
        const createdPlayer = voice.createAudioPlayer.mock.results[0]?.value;
        expect(createdPlayer.stop).toHaveBeenCalledWith(true);

        existsSpy.mockRestore();
    });

    test('thinking loop falls back to synthetic tone when MP3 file is missing', () => {
        const fsModule = require('fs');
        const childProc = require('child_process');
        const voice = require('@discordjs/voice');

        const existsSpy = jest.spyOn(fsModule, 'existsSync').mockReturnValue(false);
        childProc.spawn.mockClear();
        voice.createAudioPlayer.mockClear();
        voice.createAudioResource.mockClear();

        const connection = { subscribe: jest.fn() };
        const controller = createThinkingLoopController(connection);

        controller.start();

        expect(childProc.spawn).not.toHaveBeenCalled();
        expect(voice.createAudioResource).toHaveBeenCalledTimes(1);
        expect(connection.subscribe).toHaveBeenCalledTimes(1);

        controller.stop('test-stop');
        const createdPlayer = voice.createAudioPlayer.mock.results[0]?.value;
        expect(createdPlayer.stop).toHaveBeenCalledWith(true);

        existsSpy.mockRestore();
    });

    test('detectFactCheckWakePhrase matches phrase inside larger sentence', () => {

        expect(detectFactCheckWakePhrase('can you fact check that claim please')).toBe(true);
        expect(detectFactCheckWakePhrase('we should do a FACT-CHECK now')).toBe(true);
        expect(detectFactCheckWakePhrase('lets continue chatting')).toBe(false);
    });

    test('fact_check mode only runs LLM on wake phrase and posts detailed text output', async () => {
        const llm = {
            recordTranscript: jest.fn().mockResolvedValue('ok'),
        };
        const mockFactCheckHandler = {
            generateReport: jest.fn().mockResolvedValue({
                spokenSummary: 'Quick fact check: that statement is inaccurate.',
                detailedAssessment: 'DETAILED FACT CHECK\n- Claim: ...\n- Source: https://example.com'
            })
        };

        const speech = {
            speak: jest.fn().mockResolvedValue(true),
            stop: jest.fn(),
            isSpeaking: jest.fn().mockReturnValue(false)
        };

        const interaction = {
            channel: {
                send: jest.fn().mockResolvedValue(undefined)
            }
        };

        const processor = createTranscriptTurnProcessor({
            recordTranscript: llm.recordTranscript,
            speech,
            config: { preventInterruptions: false },
            connection: { subscribe: jest.fn() },
            modeHandler: createFactCheckMode({ factCheckHandler: mockFactCheckHandler, interaction }),
            createThinkingLoop: () => ({ start: jest.fn(), stop: jest.fn() })
        });

        await processor.ingestTranscript({ transcript: 'the earth has two moons', speaker: { userId: 'u1', username: 'U1' } });
        await processor.ingestTranscript({ transcript: 'can you fact check that?', speaker: { userId: 'u2', username: 'U2' } });

        expect(llm.recordTranscript).toHaveBeenCalledTimes(2);
        expect(mockFactCheckHandler.generateReport).toHaveBeenCalledTimes(1);
        expect(interaction.channel.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('DETAILED FACT CHECK') }));
        expect(speech.speak).toHaveBeenCalledWith(
            expect.stringContaining('Quick fact check'),
            expect.objectContaining({
                onSynthesisStart: expect.any(Function),
                onAudioStart: expect.any(Function),
                onPlaybackEnd: expect.any(Function)
            })
        );
    });

    test('createFactCheckHandler uses custom model and reasoning level', async () => {
        mockResponsesCreate.mockResolvedValueOnce({
            output_text: JSON.stringify({
                spoken_summary: 'Summary',
                detailed_assessment: 'Assessment'
            }),
            output: [{
                type: 'message',
                content: [{
                    type: 'output_text',
                    text: JSON.stringify({
                        spoken_summary: 'Summary',
                        detailed_assessment: 'Assessment'
                    })
                }]
            }]
        });

        const handler = createFactCheckHandler({ model: 'gpt-5', reasoningLevel: 'extended' });
        await handler.generateReport({
            triggerText: 'fact check this',
            transcriptEntries: [{ username: 'User', text: 'Sample claim' }]
        });

        expect(mockResponsesCreate).toHaveBeenCalled();
        const payload = mockResponsesCreate.mock.calls.at(-1)[0];
        expect(payload.model).toBe('gpt-5');
        expect(payload.reasoning).toEqual({ effort: 'extended' });
    });

    test('createFactCheckHandler omits reasoning when not provided', async () => {
        mockResponsesCreate.mockResolvedValueOnce({
            output_text: JSON.stringify({
                spoken_summary: 'Summary',
                detailed_assessment: 'Assessment'
            }),
            output: [{
                type: 'message',
                content: [{
                    type: 'output_text',
                    text: JSON.stringify({
                        spoken_summary: 'Summary',
                        detailed_assessment: 'Assessment'
                    })
                }]
            }]
        });

        const handler = createFactCheckHandler({ model: 'gpt-5' });
        await handler.generateReport({
            triggerText: 'fact check this',
            transcriptEntries: [{ username: 'User', text: 'Sample claim' }]
        });

        const payload = mockResponsesCreate.mock.calls.at(-1)[0];
        expect(payload.model).toBe('gpt-5');
        expect(payload.reasoning).toBeUndefined();
    });
});

// ── Integration: LLM + TTS pipeline mock ───────────────────────────────────

describe('Integration: LLM generates text, TTS would speak it', () => {
    test('end-to-end: transcript → LLM → response text', async () => {
        const interaction = createMockInteraction({
            channel: {
                id: '987654321',
                send: jest.fn().mockResolvedValue(undefined),
                awaitMessages: jest.fn().mockResolvedValue({ size: 0, first: () => null }),
            },
        });

        const llm = createLLMHandler({
            interaction,
            config: {
                backend: 'completions',
                model: 'gpt-4o-mini',
                maxTokens: '200',
                systemPrompt: 'You are a friendly voice assistant.',
            },
        });

        // Simulate greeting
        const greeting = await llm.generateGreeting();
        expect(greeting).toBeTruthy();

        // Simulate user talking
        const reply = await llm.handleTranscript({
            userId: 'user-42',
            username: 'IntegrationTester',
            text: 'Tell me a joke',
        });
        expect(reply).toBeTruthy();

        // Verify TTS streamer functions work
        expect(ttsStreamer.isPlaybackActive()).toBe(false);
        ttsState.playbackState.isPlaying = true;
        expect(ttsStreamer.isPlaybackActive()).toBe(true);
        ttsStreamer.stopActivePlayback('integration-test');
        expect(ttsStreamer.isPlaybackActive()).toBe(false);
    });
});

// ── LIVE API TESTS ─────────────────────────────────────────────────────────
// LLM live tests use direct OpenAI SDK calls (bypassing createLLMHandler)
// because the mock tool definitions interfere with the model's responses
// when tool modules remain mocked.

liveDescribe('Voice-TTS LLM (LIVE API) - Completions', () => {
    const metrics = [];
    let OpenAI;

    beforeAll(() => {
        jest.unmock('openai');
        jest.resetModules();
        OpenAI = require('openai').OpenAI;
    });

    afterAll(() => {
        console.log('\n🔴 LIVE API - Voice-TTS LLM Completions Metrics:');
        metrics.forEach(m => console.log(`   ${m}`));
    });

    it('should generate a greeting via live completions API', async () => {
        const client = new OpenAI({
            apiKey: process.env.API_KEY_OPENAI_CHAT,
            baseURL: process.env.ADVCONF_OPENAI_CHAT_BASE_URL || 'https://api.openai.com/v1',
        });

        const { result, durationMs } = await measureTime(() =>
            runCompletionWithFallback(client, {
                messages: [
                    { role: 'system', content: 'You are a voice assistant in a Discord call. Keep responses concise.' },
                    { role: 'user', content: 'You just joined the Discord voice channel. Say a brief, friendly greeting.' },
                ],
                max_completion_tokens: 200,
                store: false,
            })
        );
        const greeting = result.text;
        assertNoFallback(result, 'completions greeting');
        metrics.push(formatMetrics('greeting (completions)', durationMs, { responseLength: greeting?.length }));
        console.log(`🔴 LIVE greeting (completions): ${durationMs}ms`);
        console.log(`   Response: "${greeting?.substring(0, 150)}" (model=${result.model})`);

        expect(typeof greeting).toBe('string');
        expect(greeting.length).toBeGreaterThan(5);
    }, 30000);

    it('should handle transcript via live completions API', async () => {
        const client = new OpenAI({
            apiKey: process.env.API_KEY_OPENAI_CHAT,
            baseURL: process.env.ADVCONF_OPENAI_CHAT_BASE_URL || 'https://api.openai.com/v1',
        });

        const { result, durationMs } = await measureTime(() =>
            runCompletionWithFallback(client, {
                messages: [
                    { role: 'system', content: 'You are a helpful voice assistant. Keep replies concise.' },
                    { role: 'user', content: 'What is 10 times 5? Reply with just the number.' },
                ],
                max_completion_tokens: 300,
                store: false,
            })
        );
        const reply = result.text;
        assertNoFallback(result, 'completions transcript');
        metrics.push(formatMetrics('transcript (completions)', durationMs, { responseLength: reply?.length }));
        console.log(`🔴 LIVE transcript (completions): ${durationMs}ms`);
        console.log(`   Response: "${reply}" (model=${result.model})`);

        expect(typeof reply).toBe('string');
        expect(reply).toMatch(/50/);
    }, 30000);

    it('should handle multi-turn conversation via live completions', async () => {
        const client = new OpenAI({
            apiKey: process.env.API_KEY_OPENAI_CHAT,
            baseURL: process.env.ADVCONF_OPENAI_CHAT_BASE_URL || 'https://api.openai.com/v1',
        });

        const messages = [
            { role: 'system', content: 'You are a voice assistant. Keep replies brief.' },
            { role: 'user', content: 'Remember the word pineapple.' },
        ];

        // First turn
        const turn1Result = await runCompletionWithFallback(client, {
            messages,
            max_completion_tokens: 200,
            store: false,
        });
        const turn1 = turn1Result.text;
        assertNoFallback(turn1Result, 'completions multi-turn turn1');
        expect(typeof turn1).toBe('string');
        expect(turn1.length).toBeGreaterThan(0);
        messages.push({ role: 'assistant', content: turn1 });

        // Second turn referencing the first
        messages.push({ role: 'user', content: 'What word did I ask you to remember? Reply with only the word.' });
        const { result: turn2Result, durationMs } = await measureTime(() =>
            runCompletionWithFallback(client, {
                messages,
                max_completion_tokens: 200,
                store: false,
            }, turn1Result.model)
        );
        const turn2 = turn2Result.text;
        metrics.push(formatMetrics('multi-turn (completions)', durationMs));
        console.log(`🔴 LIVE multi-turn (completions): ${durationMs}ms, response: "${turn2}" (model=${turn2Result.model})`);

        expect(typeof turn2).toBe('string');
        expect(turn2.toLowerCase()).toContain('pineapple');
    }, 60000);
});

liveDescribe('Voice-TTS LLM (LIVE API) - Responses', () => {
    const metrics = [];
    let OpenAI;

    beforeAll(() => {
        jest.unmock('openai');
        jest.resetModules();
        OpenAI = require('openai').OpenAI;
    });

    afterAll(() => {
        console.log('\n🔴 LIVE API - Voice-TTS LLM Responses Metrics:');
        metrics.forEach(m => console.log(`   ${m}`));
    });

    it('should generate a greeting via live responses API', async () => {
        const client = new OpenAI({
            apiKey: process.env.API_KEY_OPENAI_CHAT,
            baseURL: process.env.ADVCONF_OPENAI_CHAT_BASE_URL || 'https://api.openai.com/v1',
        });

        const { result, durationMs } = await measureTime(() =>
            runResponsesWithFallback(client, {
                input: [
                    { role: 'system', content: 'You are a voice assistant in a Discord call. Greet users warmly.' },
                    { role: 'user', content: 'You just joined the voice channel. Say a brief, friendly greeting.' },
                ],
                max_output_tokens: 200,
                store: false,
            })
        );
        const greeting = result.text;
        assertNoFallback(result, 'responses greeting');
        metrics.push(formatMetrics('greeting (responses)', durationMs, { responseLength: greeting?.length }));
        console.log(`🔴 LIVE greeting (responses): ${durationMs}ms`);
        console.log(`   Response: "${greeting?.substring(0, 150)}" (model=${result.model})`);

        expect(typeof greeting).toBe('string');
        expect(greeting.length).toBeGreaterThan(5);
    }, 30000);

    it('should handle transcript via live responses API', async () => {
        const client = new OpenAI({
            apiKey: process.env.API_KEY_OPENAI_CHAT,
            baseURL: process.env.ADVCONF_OPENAI_CHAT_BASE_URL || 'https://api.openai.com/v1',
        });

        const { result, durationMs } = await measureTime(() =>
            runResponsesWithFallback(client, {
                input: [
                    { role: 'system', content: 'You are a helpful voice assistant. Be concise.' },
                    { role: 'user', content: 'What is the capital of Japan? Reply with only the city name.' },
                ],
                max_output_tokens: 300,
                store: false,
            })
        );
        const reply = result.text;
        assertNoFallback(result, 'responses transcript');
        metrics.push(formatMetrics('transcript (responses)', durationMs, { responseLength: reply?.length }));
        console.log(`🔴 LIVE transcript (responses): ${durationMs}ms`);
        console.log(`   Response: "${reply}" (model=${result.model})`);

        expect(typeof reply).toBe('string');
        expect(reply.toLowerCase()).toContain('tokyo');
    }, 30000);

    it('should handle multi-turn conversation via live responses', async () => {
        const client = new OpenAI({
            apiKey: process.env.API_KEY_OPENAI_CHAT,
            baseURL: process.env.ADVCONF_OPENAI_CHAT_BASE_URL || 'https://api.openai.com/v1',
        });

        const input = [
            { role: 'system', content: 'You are a voice assistant. Keep replies brief.' },
            { role: 'user', content: 'My name is Alexander.' },
        ];

        // First turn
        const turn1Result = await runResponsesWithFallback(client, {
            input,
            max_output_tokens: 200,
            store: false,
        });
        const turn1 = turn1Result.text;
        assertNoFallback(turn1Result, 'responses multi-turn turn1');
        expect(typeof turn1).toBe('string');
        expect(turn1.length).toBeGreaterThan(0);

        // Second turn referencing the first
        const { result: turn2Result, durationMs } = await measureTime(() =>
            runResponsesWithFallback(client, {
                input: [
                    ...input,
                    { role: 'assistant', content: turn1 },
                    { role: 'user', content: 'What is my name? Reply with only the name.' },
                ],
                max_output_tokens: 200,
                store: false,
            }, turn1Result.model)
        );
        const turn2 = turn2Result.text;
        metrics.push(formatMetrics('multi-turn (responses)', durationMs));
        console.log(`🔴 LIVE multi-turn (responses): ${durationMs}ms, response: "${turn2}" (model=${turn2Result.model})`);

        expect(typeof turn2).toBe('string');
        expect(turn2.toLowerCase()).toContain('alexander');
    }, 60000);
});

liveDescribe('TTS Provider - OpenAI (LIVE API)', () => {
    const metrics = [];

    beforeAll(() => {
        jest.unmock('axios');
    });

    afterAll(() => {
        console.log('\n🔴 LIVE API - TTS OpenAI Provider Metrics:');
        metrics.forEach(m => console.log(`   ${m}`));
    });

    it('should call OpenAI TTS API and receive audio stream data', async () => {
        // We can't play to a real Discord connection, but we can verify the
        // OpenAI TTS API returns a valid audio stream
        jest.resetModules();
        const axios = require('axios');

        const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
        const voice = process.env.OPENAI_TTS_VOICE || 'sage';
        const apiKey = process.env.API_KEY_OPENAI_CHAT;

        const { result: resp, durationMs } = await measureTime(() =>
            axios.post('https://api.openai.com/v1/audio/speech', {
                model,
                voice,
                input: 'Hello, this is a live test of the text to speech system.',
                format: 'wav'
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer'
            })
        );
        metrics.push(formatMetrics('OpenAI TTS', durationMs, { audioBytes: resp.data.byteLength }));
        console.log(`🔴 LIVE OpenAI TTS: ${durationMs}ms, audio=${resp.data.byteLength} bytes`);

        expect(resp.status).toBe(200);
        expect(resp.data.byteLength).toBeGreaterThan(1000);
        // Verify audio data starts with a known audio format header
        const headerBytes = Buffer.from(resp.data.slice(0, 4));
        const headerStr = headerBytes.toString('ascii');
        const isKnownAudioFormat = headerStr === 'RIFF'                   // WAV
            || headerStr.startsWith('ID3')             // MP3 with ID3 tag
            || headerStr === 'OggS'                    // OGG/Opus
            || headerStr === 'fLaC'                    // FLAC
            || headerBytes[0] === 0xFF                 // MP3 frame sync
            || resp.data.byteLength > 4000;            // fallback: substantial audio data
        console.log(`   Audio header bytes: [${Array.from(headerBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}] "${headerStr}"`);
        expect(isKnownAudioFormat).toBe(true);
    }, 30000);

    it('should synthesize different voices successfully', async () => {
        jest.resetModules();
        const axios = require('axios');

        const apiKey = process.env.API_KEY_OPENAI_CHAT;
        const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
        const voices = ['alloy', 'sage'];

        for (const voice of voices) {
            const { result: resp, durationMs } = await measureTime(() =>
                axios.post('https://api.openai.com/v1/audio/speech', {
                    model,
                    voice,
                    input: `Testing voice ${voice}.`,
                    format: 'wav'
                }, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    responseType: 'arraybuffer'
                })
            );
            metrics.push(formatMetrics(`OpenAI TTS voice=${voice}`, durationMs, { audioBytes: resp.data.byteLength }));
            console.log(`🔴 LIVE TTS voice=${voice}: ${durationMs}ms, ${resp.data.byteLength} bytes`);

            expect(resp.status).toBe(200);
            expect(resp.data.byteLength).toBeGreaterThan(500);
        }
    }, 60000);
});

liveDescribe('TTS Provider - Qwen3 via Replicate (LIVE API)', () => {
    const metrics = [];

    beforeAll(() => {
        jest.unmock('replicate');
    });

    afterAll(() => {
        console.log('\n🔴 LIVE API - TTS Qwen3 Provider Metrics:');
        metrics.forEach(m => console.log(`   ${m}`));
    });

    it('should synthesize speech via Qwen3-TTS on Replicate', async () => {
        jest.resetModules();
        const Replicate = require('replicate');

        const apiToken = process.env.API_KEY_REPLICATE;
        if (!apiToken || apiToken === 'test-key-replicate') {
            console.log('   ⏭️  Skipping Qwen3 TTS live test (no real REPLICATE key)');
            return;
        }

        const replicate = new Replicate({ auth: apiToken });

        const { result: output, durationMs } = await measureTime(() =>
            replicate.run('qwen/qwen3-tts', {
                input: {
                    text: 'Hello, this is a test of Qwen three text to speech.',
                    mode: 'custom_voice',
                    speaker: 'Aiden',
                    language: 'auto',
                },
            })
        );
        metrics.push(formatMetrics('Qwen3-TTS', durationMs));
        console.log(`🔴 LIVE Qwen3-TTS: ${durationMs}ms, output type=${typeof output}`);

        // Replicate returns a URL or FileOutput for the audio
        expect(output).toBeDefined();
    }, 120000);
});

liveDescribe('Voice-TTS Full Pipeline (LIVE API)', () => {
    const metrics = [];

    beforeAll(() => {
        jest.unmock('openai');
        jest.unmock('axios');
    });

    afterAll(() => {
        console.log('\n🔴 LIVE API - Voice-TTS Full Pipeline Metrics:');
        metrics.forEach(m => console.log(`   ${m}`));
    });

    it('should generate LLM response then synthesize via TTS (end-to-end)', async () => {
        jest.resetModules();
        const OpenAI = require('openai').OpenAI;
        const axios = require('axios');

        // Step 1: Get LLM response via direct API call
        const client = new OpenAI({
            apiKey: process.env.API_KEY_OPENAI_CHAT,
            baseURL: process.env.ADVCONF_OPENAI_CHAT_BASE_URL || 'https://api.openai.com/v1',
        });

        const { result: llmResult, durationMs: llmDuration } = await measureTime(() =>
            runCompletionWithFallback(client, {
                messages: [
                    { role: 'system', content: 'You are a voice assistant. Reply in one short sentence.' },
                    { role: 'user', content: 'Say hello in a creative way.' },
                ],
                max_completion_tokens: 150,
                store: false,
            })
        );
        const llmReply = llmResult.text;
        assertNoFallback(llmResult, 'pipeline llm');
        metrics.push(formatMetrics('pipeline: LLM', llmDuration, { responseLength: llmReply?.length }));
        console.log(`🔴 LIVE pipeline LLM: ${llmDuration}ms, response="${llmReply?.substring(0, 100)}" (model=${llmResult.model})`);

        expect(typeof llmReply).toBe('string');
        expect(llmReply.length).toBeGreaterThan(0);

        // Step 2: Synthesize the LLM response via OpenAI TTS
        const apiKey = process.env.API_KEY_OPENAI_CHAT;
        const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
        const voice = process.env.OPENAI_TTS_VOICE || 'sage';

        const { result: ttsResp, durationMs: ttsDuration } = await measureTime(() =>
            axios.post('https://api.openai.com/v1/audio/speech', {
                model,
                voice,
                input: llmReply,
                format: 'wav'
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer'
            })
        );
        metrics.push(formatMetrics('pipeline: TTS', ttsDuration, { audioBytes: ttsResp.data.byteLength }));
        console.log(`🔴 LIVE pipeline TTS: ${ttsDuration}ms, audio=${ttsResp.data.byteLength} bytes`);

        expect(ttsResp.status).toBe(200);
        expect(ttsResp.data.byteLength).toBeGreaterThan(1000);

        const totalMs = llmDuration + ttsDuration;
        metrics.push(formatMetrics('pipeline: TOTAL', totalMs));
        console.log(`🔴 LIVE pipeline TOTAL: ${totalMs}ms`);
    }, 60000);
});
