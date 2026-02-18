/**
 * Tests for voice_chat modules:
 *   - voiceGlobalState.js
 *   - channelConnection.js
 *   - openaiControl.js
 *   - audioStreaming.js
 *   - sessionManagement.js
 */
require('./setup');
const { measureTime, formatMetrics, createMockInteraction, liveDescribe, liveIt } = require('./utils/testHelpers');

// ── Mocks ──────────────────────────────────────────────────────────────────

// Mock @discordjs/voice
jest.mock('@discordjs/voice', () => ({
    joinVoiceChannel: jest.fn().mockReturnValue({
        on: jest.fn(),
        destroy: jest.fn(),
        subscribe: jest.fn(),
        receiver: {
            speaking: { on: jest.fn(), off: jest.fn() },
            subscribe: jest.fn().mockReturnValue({
                on: jest.fn(),
                pipe: jest.fn().mockReturnValue({ on: jest.fn(), destroy: jest.fn() }),
                destroy: jest.fn(),
            }),
        },
        state: { status: 'ready', subscription: null },
    }),
    VoiceConnectionStatus: {
        Ready: 'ready',
        Connecting: 'connecting',
        Destroyed: 'destroyed',
        Disconnected: 'disconnected',
        Signalling: 'signalling',
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
    StreamType: { Raw: 'raw', Opus: 'opus' },
    EndBehaviorType: { Manual: 'manual', AfterSilence: 'afterSilence' },
}));

// Mock @discordjs/opus
jest.mock('@discordjs/opus', () => ({
    OpusEncoder: jest.fn().mockImplementation(() => ({
        decode: jest.fn((chunk) => Buffer.alloc(960)),
        encode: jest.fn((chunk) => Buffer.alloc(80)),
    })),
}));

// Mock ws
jest.mock('ws', () => {
    const MockWebSocket = jest.fn().mockImplementation((url, opts) => {
        const instance = {
            readyState: 1, // OPEN
            send: jest.fn(),
            close: jest.fn(),
            on: jest.fn((event, cb) => {
                if (event === 'open') setTimeout(() => cb(), 0);
                instance._listeners = instance._listeners || {};
                instance._listeners[event] = instance._listeners[event] || [];
                instance._listeners[event].push(cb);
            }),
            once: jest.fn((event, cb) => {
                instance._listeners = instance._listeners || {};
                instance._listeners[event] = instance._listeners[event] || [];
                instance._listeners[event].push(cb);
            }),
            removeListener: jest.fn(),
            off: jest.fn(),
            _listeners: {},
        };
        return instance;
    });
    MockWebSocket.OPEN = 1;
    MockWebSocket.CLOSED = 3;
    MockWebSocket.CONNECTING = 0;
    return MockWebSocket;
});

// Mock child_process (spawn for ffmpeg)
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
            pid: 12345,
        };
    }),
}));

// Mock discord.js for tools
jest.mock('discord.js', () => ({
    AttachmentBuilder: jest.fn(buf => ({ attachment: buf })),
}));

// Mock imageTool and voiceDisconnectTool (used by toolCallListener)
jest.mock('../functions/tools/imageTool.js', () => ({
    toolDef_generateImage: { type: 'function', function: { name: 'generate_image', parameters: {} } },
    generate_image_tool: jest.fn().mockResolvedValue([Buffer.from('fake-image')]),
}));

jest.mock('../functions/tools/voiceDisconnectTool.js', () => ({
    toolDef_disconnectVoiceChat: { type: 'function', function: { name: 'disconnect_voice_chat', parameters: {} } },
    disconnect_voice_chat_tool: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../functions/tools/sendTextToChannelTool.js', () => ({
    toolDef_sendTextToChannel: { type: 'function', function: { name: 'send_text_to_channel', parameters: {} } },
    send_text_to_channel_tool: jest.fn().mockResolvedValue('Message sent to channel.'),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

const state = require('../functions/voice_chat/voiceGlobalState.js');
const { handleJoinVoiceChannel, gracefulDisconnect } = require('../functions/voice_chat/channelConnection.js');
const {
    setupRealtimeVoiceWS,
    updateSessionParams,
    injectMessageGetResponse,
    injectMessage,
    cancelResponse,
    startSilenceStream,
    stopSilenceStream,
} = require('../functions/voice_chat/openaiControl.js');
const { truncateAudio, streamUserAudioToOpenAI } = require('../functions/voice_chat/audioStreaming.js');
const { setupVoiceChatTimeLimit } = require('../functions/voice_chat/sessionManagement.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const WebSocket = require('ws');
const { send_text_to_channel_tool } = require('../functions/tools/sendTextToChannelTool.js');

// ── voiceGlobalState ───────────────────────────────────────────────────────

describe('voiceGlobalState', () => {
    beforeEach(() => {
        // NOTE: isVoiceChatShuttingDown is exported as a primitive (by value).
        // setVoiceChatShutdownStatus changes the internal let variable,
        // but state.isVoiceChatShuttingDown on the exports object is a separate property.
        // The codebase writes directly: state.isVoiceChatShuttingDown = true/false.
        state.isVoiceChatShuttingDown = false;
        Object.assign(state.currentAudioState, {
            responseItemId: null,
            startTimestamp: null,
            isPlaying: false,
            player: null,
            audioStream: null,
            ffmpeg: null,
        });
    });

    test('direct property write sets isVoiceChatShuttingDown to true', async () => {
        const { durationMs } = await measureTime(async () => {
            state.isVoiceChatShuttingDown = true;
        });
        expect(state.isVoiceChatShuttingDown).toBe(true);
        console.log(formatMetrics('isVoiceChatShuttingDown = true', durationMs));
    });

    test('setVoiceChatShutdownStatus is callable (modifies internal variable)', () => {
        // setVoiceChatShutdownStatus updates the module-level let variable
        // but NOT the exported property (primitive export). The codebase
        // also uses direct property writes, so both patterns coexist.
        expect(() => state.setVoiceChatShutdownStatus(true)).not.toThrow();
        expect(() => state.setVoiceChatShutdownStatus(false)).not.toThrow();
    });

    test('direct property write toggles flag correctly', () => {
        state.isVoiceChatShuttingDown = true;
        expect(state.isVoiceChatShuttingDown).toBe(true);
        state.isVoiceChatShuttingDown = false;
        expect(state.isVoiceChatShuttingDown).toBe(false);
    });

    test('currentAudioState defaults are correct', () => {
        expect(state.currentAudioState).toBeDefined();
        expect(state.currentAudioState.isPlaying).toBe(false);
        expect(state.currentAudioState.responseItemId).toBeNull();
        expect(state.currentAudioState.player).toBeNull();
    });

    test('currentAudioState is mutable', () => {
        state.currentAudioState.isPlaying = true;
        state.currentAudioState.responseItemId = 'test-item-123';
        expect(state.currentAudioState.isPlaying).toBe(true);
        expect(state.currentAudioState.responseItemId).toBe('test-item-123');
    });
});

// ── channelConnection ──────────────────────────────────────────────────────

describe('channelConnection', () => {
    let interaction;
    let mockChannel;

    beforeEach(() => {
        jest.clearAllMocks();
        state.isVoiceChatShuttingDown = false;
        mockChannel = { id: 'ch-001', name: 'General' };
        interaction = createMockInteraction({
            guild: {
                id: '111222333',
                name: 'Test Guild',
                voiceAdapterCreator: jest.fn(),
                members: { me: { voice: { channel: null } } },
            },
        });
    });

    test('handleJoinVoiceChannel calls joinVoiceChannel and returns connection', async () => {
        const { result: connection, durationMs } = await measureTime(() =>
            handleJoinVoiceChannel(interaction, mockChannel)
        );

        expect(joinVoiceChannel).toHaveBeenCalledWith(
            expect.objectContaining({
                channelId: 'ch-001',
                guildId: '111222333',
                selfDeaf: false,
                selfMute: false,
            })
        );
        expect(connection).toBeDefined();
        expect(connection.on).toBeDefined();
        expect(interaction.reply).toHaveBeenCalledWith(expect.stringContaining('General'));
        console.log(formatMetrics('handleJoinVoiceChannel', durationMs));
    });

    test('handleJoinVoiceChannel notifies when already in a channel', async () => {
        interaction.guild.members.me.voice.channel = { name: 'Old Room' };
        await handleJoinVoiceChannel(interaction, mockChannel);
        expect(interaction.reply).toHaveBeenCalledWith(expect.stringContaining('Old Room'));
    });

    test('gracefulDisconnect destroys connection and closes ws', async () => {
        const mockConn = {
            state: {
                status: 'ready',
                subscription: { player: { state: { status: 'idle' } } },
            },
            destroy: jest.fn(),
        };
        const mockWs = { readyState: WebSocket.OPEN, close: jest.fn() };

        const { durationMs } = await measureTime(() => gracefulDisconnect(mockWs, mockConn));

        expect(mockConn.destroy).toHaveBeenCalled();
        expect(mockWs.close).toHaveBeenCalled();
        console.log(formatMetrics('gracefulDisconnect', durationMs));
    });

    test('gracefulDisconnect handles null connection and ws', async () => {
        await expect(gracefulDisconnect(null, null)).resolves.toBeUndefined();
    });

    test('gracefulDisconnect handles destroyed connection', async () => {
        const mockConn = {
            state: { status: 'destroyed' },
            destroy: jest.fn(),
        };
        await gracefulDisconnect(null, mockConn);
        expect(mockConn.destroy).not.toHaveBeenCalled();
    });

    test('gracefulDisconnect sets shutdown flag', async () => {
        state.isVoiceChatShuttingDown = false;
        await gracefulDisconnect(null, null);
        expect(state.isVoiceChatShuttingDown).toBe(true);
    });
});

// ── openaiControl ──────────────────────────────────────────────────────────

describe('openaiControl', () => {
    let mockWs;

    beforeEach(() => {
        jest.clearAllMocks();
        mockWs = {
            readyState: WebSocket.OPEN,
            send: jest.fn(),
            close: jest.fn(),
            on: jest.fn(),
            once: jest.fn(),
        };
    });

    describe('updateSessionParams', () => {
        test('sends session.update event with correct params', async () => {
            const params = {
                instructions: 'Be helpful',
                temperature: '0.7',
                voice: 'alloy',
                max_response_output_tokens: 500,
                tools: { type: 'function', function: { name: 'test' } },
            };

            const { durationMs } = await measureTime(async () => {
                updateSessionParams(mockWs, params);
            });

            expect(mockWs.send).toHaveBeenCalledTimes(1);
            const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(sent.type).toBe('session.update');
            expect(sent.session.instructions).toBe('Be helpful');
            expect(sent.session.temperature).toBe(0.7);
            expect(sent.session.voice).toBe('alloy');
            expect(sent.session.turn_detection.type).toBe('semantic_vad');
            console.log(formatMetrics('updateSessionParams', durationMs));
        });

        test('includes input_audio_transcription when logging enabled', () => {
            const origEnv = process.env.ADVCONF_OPENAI_VOICE_CHAT_SYSTEM_LOGGING;
            process.env.ADVCONF_OPENAI_VOICE_CHAT_SYSTEM_LOGGING = 'true';
            const params = {
                instructions: 'test',
                temperature: '0.5',
                voice: 'echo',
                max_response_output_tokens: 100,
                tools: {},
            };
            updateSessionParams(mockWs, params);
            const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(sent.session.input_audio_transcription).toEqual({ model: 'whisper-1' });
            process.env.ADVCONF_OPENAI_VOICE_CHAT_SYSTEM_LOGGING = origEnv;
        });

        test('accepts an array of tools without nesting', () => {
            const params = {
                instructions: 'Be helpful',
                temperature: '0.7',
                voice: 'alloy',
                max_response_output_tokens: 500,
                tools: [
                    { type: 'function', function: { name: 'generate_image', parameters: { type: 'object', properties: {} } } },
                    { type: 'function', function: { name: 'send_text_to_channel', parameters: { type: 'object', properties: {} } } },
                ],
            };

            updateSessionParams(mockWs, params);
            const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(Array.isArray(sent.session.tools)).toBe(true);
            expect(Array.isArray(sent.session.tools[0])).toBe(false);
            expect(sent.session.tools).toHaveLength(2);
            expect(sent.session.tools[0].name).toBe('generate_image');
            expect(sent.session.tools[1].name).toBe('send_text_to_channel');
        });
    });

    describe('setupRealtimeVoiceWS tool calls', () => {
        test('routes send_text_to_channel function calls to the tool', async () => {
            const interaction = createMockInteraction({
                channel: {
                    id: '987654321',
                    send: jest.fn().mockResolvedValue(undefined),
                    awaitMessages: jest.fn().mockResolvedValue({ size: 0, first: () => null }),
                },
            });

            const ws = await setupRealtimeVoiceWS(interaction);

            const handlers = ws._listeners?.message || [];
            expect(handlers.length).toBeGreaterThan(0);

            const payload = JSON.stringify({
                type: 'response.done',
                response: {
                    output: [{
                        type: 'function_call',
                        name: 'send_text_to_channel',
                        arguments: JSON.stringify({ content: '## Notes\n- one\n- two' }),
                    }],
                },
            });
            handlers.forEach((handler) => handler(payload));

            await new Promise((resolve) => setImmediate(resolve));

            expect(send_text_to_channel_tool).toHaveBeenCalledTimes(1);
            expect(send_text_to_channel_tool).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'send_text_to_channel' }),
                interaction
            );
            expect(ws.send).toHaveBeenCalled();
        });

        test('handles response.output_item.done function call events', async () => {
            const interaction = createMockInteraction({
                channel: {
                    id: '987654321',
                    send: jest.fn().mockResolvedValue(undefined),
                    awaitMessages: jest.fn().mockResolvedValue({ size: 0, first: () => null }),
                },
            });

            const ws = await setupRealtimeVoiceWS(interaction);
            const handlers = ws._listeners?.message || [];
            expect(handlers.length).toBeGreaterThan(0);

            const payload = JSON.stringify({
                type: 'response.output_item.done',
                item: {
                    type: 'function_call',
                    name: 'send_text_to_channel',
                    call_id: 'call_abc123',
                    arguments: JSON.stringify({ content: 'A structured note' }),
                },
            });

            handlers.forEach((handler) => handler(payload));
            await new Promise((resolve) => setImmediate(resolve));

            expect(send_text_to_channel_tool).toHaveBeenCalledTimes(1);

            const sentEvents = ws.send.mock.calls.map(([raw]) => JSON.parse(raw));
            expect(sentEvents.some((event) => event.type === 'conversation.item.create' && event.item?.type === 'function_call_output' && event.item?.call_id === 'call_abc123')).toBe(true);
            expect(sentEvents.some((event) => event.type === 'response.create')).toBe(true);
        });

        test('deduplicates same tool call when both output_item.done and response.done arrive', async () => {
            const interaction = createMockInteraction({
                channel: {
                    id: '987654321',
                    send: jest.fn().mockResolvedValue(undefined),
                    awaitMessages: jest.fn().mockResolvedValue({ size: 0, first: () => null }),
                },
            });

            const ws = await setupRealtimeVoiceWS(interaction);
            const handlers = ws._listeners?.message || [];
            expect(handlers.length).toBeGreaterThan(0);

            const firstPayload = JSON.stringify({
                type: 'response.output_item.done',
                item: {
                    type: 'function_call',
                    name: 'send_text_to_channel',
                    call_id: 'call_dupe_123',
                    arguments: JSON.stringify({ content: 'A structured note' }),
                },
            });

            const secondPayload = JSON.stringify({
                type: 'response.done',
                response: {
                    output: [{
                        type: 'function_call',
                        name: 'send_text_to_channel',
                        call_id: 'call_dupe_123',
                        arguments: JSON.stringify({ content: 'A structured note' }),
                    }],
                },
            });

            handlers.forEach((handler) => handler(firstPayload));
            handlers.forEach((handler) => handler(secondPayload));
            await new Promise((resolve) => setImmediate(resolve));

            expect(send_text_to_channel_tool).toHaveBeenCalledTimes(1);
        });
    });

    describe('injectMessageGetResponse', () => {
        test('sends response.create event with instruction', async () => {
            const { durationMs } = await measureTime(async () => {
                injectMessageGetResponse(mockWs, 'Tell a joke');
            });

            expect(mockWs.send).toHaveBeenCalledTimes(1);
            const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(sent.type).toBe('response.create');
            expect(sent.response.modalities).toEqual(['audio', 'text']);
            expect(sent.response.instructions).toBe('Tell a joke');
            console.log(formatMetrics('injectMessageGetResponse', durationMs));
        });
    });

    describe('injectMessage', () => {
        test('sends conversation.item.create with default user role', () => {
            injectMessage(mockWs, 'Hello there');
            const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(sent.type).toBe('conversation.item.create');
            expect(sent.item.role).toBe('user');
            expect(sent.item.content[0].type).toBe('input_text');
            expect(sent.item.content[0].text).toBe('Hello there');
        });

        test('sends conversation.item.create with custom role', () => {
            injectMessage(mockWs, 'System message', 'system');
            const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(sent.item.role).toBe('system');
        });
    });

    describe('cancelResponse', () => {
        test('sends response.cancel event', () => {
            cancelResponse(mockWs);
            const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(sent.type).toBe('response.cancel');
        });
    });

    describe('startSilenceStream', () => {
        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        test('returns control object with intervalId and timeoutId', () => {
            const control = startSilenceStream(mockWs, 100);
            expect(control).toHaveProperty('intervalId');
            expect(control).toHaveProperty('timeoutId');
            stopSilenceStream(control);
        });

        test('sends silence packets at specified interval', () => {
            const control = startSilenceStream(mockWs, 50);
            jest.advanceTimersByTime(150);
            // At 50ms intervals for 150ms, at least 2-3 packets should be sent
            expect(mockWs.send.mock.calls.length).toBeGreaterThanOrEqual(2);
            const packet = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(packet.type).toBe('input_audio_buffer.append');
            expect(packet.audio).toBeDefined();
            stopSilenceStream(control);
        });

        test('auto-stops after 10 seconds', () => {
            const control = startSilenceStream(mockWs, 100);
            const callsBefore = mockWs.send.mock.calls.length;
            jest.advanceTimersByTime(10500);
            const callsAfterTimeout = mockWs.send.mock.calls.length;
            // After another 5s no more packets should arrive
            jest.advanceTimersByTime(5000);
            expect(mockWs.send.mock.calls.length).toBe(callsAfterTimeout);
            stopSilenceStream(control);
        });
    });

    describe('stopSilenceStream', () => {
        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        test('clears interval and timeout', () => {
            const control = startSilenceStream(mockWs, 50);
            jest.advanceTimersByTime(100);
            const callsBeforeStop = mockWs.send.mock.calls.length;
            stopSilenceStream(control);
            jest.advanceTimersByTime(5000);
            // No additional packets after stop
            expect(mockWs.send.mock.calls.length).toBe(callsBeforeStop);
        });

        test('handles null control gracefully', () => {
            expect(() => stopSilenceStream(null)).not.toThrow();
        });
    });
});

// ── audioStreaming (truncateAudio) ─────────────────────────────────────────

describe('audioStreaming', () => {
    let mockWs;

    beforeEach(() => {
        jest.clearAllMocks();
        state.isVoiceChatShuttingDown = false;
        mockWs = {
            readyState: WebSocket.OPEN,
            send: jest.fn(),
            on: jest.fn(),
        };
        // Reset audio state
        Object.assign(state.currentAudioState, {
            responseItemId: null,
            startTimestamp: null,
            isPlaying: false,
            player: null,
            audioStream: null,
            ffmpeg: null,
        });
    });

    describe('truncateAudio', () => {
        test('does nothing when no active audio', () => {
            truncateAudio(mockWs, 'item-1');
            expect(mockWs.send).not.toHaveBeenCalled();
        });

        test('does nothing when itemId is null', () => {
            state.currentAudioState.isPlaying = true;
            state.currentAudioState.startTimestamp = Date.now();
            truncateAudio(mockWs, null);
            expect(mockWs.send).not.toHaveBeenCalled();
        });

        test('truncates active audio and sends truncation event', async () => {
            const { PassThrough } = require('stream');
            state.currentAudioState.isPlaying = true;
            state.currentAudioState.startTimestamp = Date.now() - 2000; // 2s ago
            state.currentAudioState.player = { stop: jest.fn() };
            state.currentAudioState.audioStream = new PassThrough();
            state.currentAudioState.ffmpeg = {
                stdin: { end: jest.fn() },
                kill: jest.fn(),
            };

            const { durationMs } = await measureTime(async () => {
                truncateAudio(mockWs, 'item-123');
            });

            // Player stopped, isPlaying set to false
            // NOTE: truncateAudio calls player.stop() but doesn't null the player reference
            expect(state.currentAudioState.isPlaying).toBe(false);

            // Truncation event sent to OpenAI
            expect(mockWs.send).toHaveBeenCalledTimes(1);
            const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(sent.type).toBe('conversation.item.truncate');
            expect(sent.item_id).toBe('item-123');
            expect(sent.audio_end_ms).toBeGreaterThanOrEqual(1900);
            console.log(formatMetrics('truncateAudio', durationMs));
        });

        test('handles missing ffmpeg gracefully', () => {
            state.currentAudioState.isPlaying = true;
            state.currentAudioState.startTimestamp = Date.now() - 500;
            state.currentAudioState.player = { stop: jest.fn() };
            state.currentAudioState.ffmpeg = null;
            state.currentAudioState.audioStream = null;

            expect(() => truncateAudio(mockWs, 'item-x')).not.toThrow();
        });

        test('handles closed WebSocket when truncating', () => {
            const closedWs = { readyState: 3, send: jest.fn() }; // CLOSED
            state.currentAudioState.isPlaying = true;
            state.currentAudioState.startTimestamp = Date.now() - 100;
            state.currentAudioState.player = { stop: jest.fn() };

            truncateAudio(closedWs, 'item-y');
            expect(closedWs.send).not.toHaveBeenCalled();
        });
    });

    describe('streamUserAudioToOpenAI', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        function createStreamingHarness() {
            const { PassThrough } = require('stream');
            const speakingHandlers = {};
            const userStreams = new Map();

            const connection = {
                receiver: {
                    speaking: {
                        on: jest.fn((event, handler) => {
                            speakingHandlers[event] = handler;
                        })
                    },
                    subscribe: jest.fn((userId) => {
                        const opusStream = new PassThrough();
                        userStreams.set(userId, opusStream);
                        return opusStream;
                    })
                }
            };

            const ws = {
                readyState: WebSocket.OPEN,
                send: jest.fn(),
                on: jest.fn(),
            };

            return { connection, ws, speakingHandlers, userStreams };
        }

        test('mixes and forwards audio from multiple simultaneous speakers', () => {
            const { connection, ws, speakingHandlers, userStreams } = createStreamingHarness();

            streamUserAudioToOpenAI(connection, ws, false);

            expect(speakingHandlers.start).toBeDefined();
            speakingHandlers.start('user-1');
            speakingHandlers.start('user-2');

            userStreams.get('user-1').write(Buffer.from([0x00, 0x01, 0x02, 0x03]));
            userStreams.get('user-2').write(Buffer.from([0x03, 0x02, 0x01, 0x00]));
            jest.advanceTimersByTime(25);

            const audioAppends = ws.send.mock.calls
                .map(([payload]) => JSON.parse(payload))
                .filter(event => event.type === 'input_audio_buffer.append');

            expect(audioAppends.length).toBeGreaterThan(0);
            expect(audioAppends.some(event => typeof event.audio === 'string' && event.audio.length > 0)).toBe(true);
        });

        test('debounces speaker end so quick resume does not resubscribe stream', () => {
            const { connection, ws, speakingHandlers, userStreams } = createStreamingHarness();

            streamUserAudioToOpenAI(connection, ws, false);

            speakingHandlers.start('user-rapid');
            const firstStream = userStreams.get('user-rapid');

            speakingHandlers.end('user-rapid');
            jest.advanceTimersByTime(100);
            speakingHandlers.start('user-rapid');

            // Quick resume should keep prior speaker pipeline alive.
            expect(connection.receiver.subscribe).toHaveBeenCalledTimes(1);

            firstStream.write(Buffer.from([0x01, 0x00, 0x01, 0x00]));
            jest.advanceTimersByTime(25);

            const audioAppends = ws.send.mock.calls
                .map(([payload]) => JSON.parse(payload))
                .filter(event => event.type === 'input_audio_buffer.append');
            expect(audioAppends.length).toBeGreaterThan(0);
        });
    });
});

// ── sessionManagement ──────────────────────────────────────────────────────

describe('sessionManagement', () => {
    let mockWs;
    let mockConnection;
    let interaction;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        state.isVoiceChatShuttingDown = false;

        mockWs = {
            readyState: WebSocket.OPEN,
            send: jest.fn(),
            close: jest.fn(),
            on: jest.fn(),
            removeListener: jest.fn(),
        };
        mockConnection = {
            state: { status: 'ready', subscription: null },
            destroy: jest.fn(),
            on: jest.fn(),
        };
        interaction = createMockInteraction();
    });

    afterEach(() => jest.useRealTimers());

    test('setupVoiceChatTimeLimit returns true for valid time limit', () => {
        const result = setupVoiceChatTimeLimit(mockWs, mockConnection, interaction, 60);
        expect(result).toBe(true);
    });

    test('setupVoiceChatTimeLimit returns false for invalid time limit', () => {
        const result = setupVoiceChatTimeLimit(mockWs, mockConnection, interaction, 'not-a-number');
        expect(result).toBe(false);
    });

    test('setupVoiceChatTimeLimit returns true for string number', () => {
        const result = setupVoiceChatTimeLimit(mockWs, mockConnection, interaction, '120');
        expect(result).toBe(true);
    });

    test('setupVoiceChatTimeLimit sets shutdown flag on timeout', () => {
        state.isVoiceChatShuttingDown = false;
        setupVoiceChatTimeLimit(mockWs, mockConnection, interaction, 5);

        // Before timeout, flag should still be false
        // (sessionManagement writes state.isVoiceChatShuttingDown = true directly)
        expect(state.isVoiceChatShuttingDown).toBe(false);

        // Advance past the 5-second time limit
        jest.advanceTimersByTime(5001);

        expect(state.isVoiceChatShuttingDown).toBe(true);
    });

    test('setupVoiceChatTimeLimit registers Destroyed listener for cleanup', () => {
        setupVoiceChatTimeLimit(mockWs, mockConnection, interaction, 30);
        expect(mockConnection.on).toHaveBeenCalledWith('destroyed', expect.any(Function));
    });

    test('Destroyed event clears the timeout', () => {
        state.isVoiceChatShuttingDown = false;
        setupVoiceChatTimeLimit(mockWs, mockConnection, interaction, 10);

        // Simulate Destroyed event firing
        const destroyedHandler = mockConnection.on.mock.calls.find(c => c[0] === 'destroyed');
        expect(destroyedHandler).toBeTruthy();
        destroyedHandler[1]();

        // Now advance past timeout - shutdown flag should NOT have been set
        jest.advanceTimersByTime(15000);
        // Since we cleared the timeout, isVoiceChatShuttingDown should still be false
        // (the timeout callback never fires)
        expect(state.isVoiceChatShuttingDown).toBe(false);
    });
});

// ── Integration-style: message format verification ─────────────────────────

describe('WebSocket message format validation', () => {
    let mockWs;

    beforeEach(() => {
        mockWs = { readyState: 1, send: jest.fn(), on: jest.fn() };
    });

    test('all OpenAI control messages are valid JSON with type field', () => {
        updateSessionParams(mockWs, {
            instructions: 'test', temperature: '1', voice: 'alloy',
            max_response_output_tokens: 100, tools: {},
        });
        injectMessageGetResponse(mockWs, 'speak');
        injectMessage(mockWs, 'hello');
        cancelResponse(mockWs);

        expect(mockWs.send).toHaveBeenCalledTimes(4);
        mockWs.send.mock.calls.forEach(([payload]) => {
            const parsed = JSON.parse(payload);
            expect(parsed).toHaveProperty('type');
            expect(typeof parsed.type).toBe('string');
        });
    });

    test('silence stream packets contain valid base64 audio', () => {
        jest.useFakeTimers();
        const control = startSilenceStream(mockWs, 50);
        jest.advanceTimersByTime(50);

        const packet = JSON.parse(mockWs.send.mock.calls[0][0]);
        expect(packet.type).toBe('input_audio_buffer.append');
        // Verify it's valid base64
        const buf = Buffer.from(packet.audio, 'base64');
        expect(buf.length).toBe(4800); // 24000 * 0.1 * 2 bytes
        stopSilenceStream(control);
        jest.useRealTimers();
    });
});

// ── LIVE API TESTS ─────────────────────────────────────────────────────────

liveDescribe('Realtime tool calling (LIVE API)', () => {
    test('realtime model can emit send_text_to_channel function call', async () => {
        const apiKey = process.env.API_KEY_OPENAI_CHAT;
        const wsUrl = process.env.VOICE_CHAT_MODEL_URL;

        expect(typeof apiKey).toBe('string');
        expect(apiKey.length).toBeGreaterThan(10);
        expect(typeof wsUrl).toBe('string');
        expect(wsUrl.startsWith('wss://')).toBe(true);

        const RealWebSocket = jest.requireActual('ws');
        const ws = new RealWebSocket(wsUrl, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'OpenAI-Beta': 'realtime=v1',
            },
        });

        const cleanup = () => {
            try {
                if (ws.readyState === RealWebSocket.OPEN || ws.readyState === RealWebSocket.CONNECTING) {
                    ws.close();
                }
            } catch { }
        };

        await new Promise((resolve, reject) => {
            ws.once('open', resolve);
            ws.once('error', reject);
        });

        const seenEvents = [];

        try {
            ws.send(JSON.stringify({
                type: 'session.update',
                session: {
                    instructions: 'You are a concise assistant. Use tools when appropriate.',
                    modalities: ['text'],
                    tools: [
                        {
                            type: 'function',
                            name: 'send_text_to_channel',
                            description: 'Send markdown/text output to the Discord text channel.',
                            parameters: {
                                type: 'object',
                                properties: {
                                    content: {
                                        type: 'string',
                                    },
                                },
                                required: ['content'],
                                additionalProperties: false,
                            },
                        },
                    ],
                },
            }));

            ws.send(JSON.stringify({
                type: 'response.create',
                response: {
                    modalities: ['text'],
                    instructions: 'Call send_text_to_channel with content exactly "LIVE_TOOL_TEST_OK" and do not answer normally first.',
                },
            }));

            const functionCall = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error(`Timed out waiting for function call. Seen events: ${seenEvents.slice(-20).join(', ')}`));
                }, 30000);

                const onMessage = (raw) => {
                    try {
                        const msg = JSON.parse(raw);
                        if (msg?.type) seenEvents.push(msg.type);

                        const fromOutputItemDone =
                            msg?.type === 'response.output_item.done' &&
                            msg?.item?.type === 'function_call' &&
                            msg?.item?.name === 'send_text_to_channel';

                        const fromResponseDone =
                            msg?.type === 'response.done' &&
                            Array.isArray(msg?.response?.output) &&
                            msg.response.output.some((item) => item?.type === 'function_call' && item?.name === 'send_text_to_channel');

                        if (!fromOutputItemDone && !fromResponseDone) return;

                        clearTimeout(timeout);
                        ws.off('message', onMessage);

                        if (fromOutputItemDone) {
                            resolve(msg.item);
                            return;
                        }

                        const item = msg.response.output.find((entry) => entry?.type === 'function_call' && entry?.name === 'send_text_to_channel');
                        resolve(item);
                    } catch {
                        // Ignore non-JSON frames
                    }
                };

                ws.on('message', onMessage);
            });

            expect(functionCall).toBeDefined();
            expect(functionCall.name).toBe('send_text_to_channel');

            const args = JSON.parse(functionCall.arguments || '{}');
            expect(typeof args.content).toBe('string');
            expect(args.content).toContain('LIVE_TOOL_TEST_OK');
        } finally {
            cleanup();
        }
    }, 60000);
});
