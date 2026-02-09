/**
 * Tests for functions/chatFunctions.js
 *
 * getChatSettings is tested directly (reads env vars).
 * sendChatMessage / sendChatMessageCompletions / sendChatMessageResponses
 * are tested by mocking the OpenAI SDK so no real API call is made in mock mode.
 * In live mode (LIVE_API=true), real calls are made and response quality is measured.
 *
 * Metrics tracked: execution time, token usage (live mode).
 */

const path = require('path');
require(path.resolve(__dirname, '..', 'tests', 'setup.js'));

const { measureTime, formatMetrics, isLiveMode, liveDescribe, createMockOpenAIClient } = require('./utils/testHelpers');

// We need to mock OpenAI before requiring chatFunctions
// because chatFunctions creates OpenAI clients at module level
const mockOpenAIInstance = createMockOpenAIClient();

jest.mock('openai', () => {
  return {
    OpenAI: jest.fn().mockImplementation(() => mockOpenAIInstance),
  };
});

// Also mock image_functions since chatFunctions imports it at module level
// and image_functions imports many providers that may fail in test
jest.mock('../functions/image_functions.js', () => ({
  generateImage: jest.fn(),
  upscaleImage: jest.fn(),
  promptOptimizer: jest.fn(),
  adaptImagePrompt: jest.fn(),
  saveToDiskCheck: jest.fn().mockReturnValue(false),
  validateApiKeys: jest.fn(),
  genSeed: jest.fn().mockResolvedValue(12345),
  getDimensions: jest.fn().mockReturnValue('1:1'),
  generateImageToImage: jest.fn(),
  autoDisableUnneededPromptOptimization: jest.fn().mockReturnValue(false),
  searchAndReplace: jest.fn(),
  generateImageEdit: jest.fn(),
}));

// Mock the image command module that image_functions imports
jest.mock('../commands/CoreFunctions/image.js', () => ({
  data: { name: 'image' },
  execute: jest.fn(),
}));

const { getChatSettings, sendChatMessage, sendChatMessageCompletions, sendChatMessageResponses } = require('../functions/chatFunctions');

// ─────────────────────────────────────────────────────────────
// getChatSettings
// ─────────────────────────────────────────────────────────────
describe('getChatSettings', () => {
  it('should return chat configuration from env vars', () => {
    const settings = getChatSettings();

    expect(settings).toHaveProperty('chatModel');
    expect(settings).toHaveProperty('maxTokens');
    expect(settings).toHaveProperty('systemMessage');
    expect(typeof settings.chatModel).toBe('string');
    expect(typeof settings.maxTokens).toBe('number');
    expect(typeof settings.systemMessage).toBe('string');
    expect(settings.chatModel.length).toBeGreaterThan(0);
    expect(settings.systemMessage.length).toBeGreaterThan(0);
  });

  it('should handle empty temperature gracefully', () => {
    const origTemp = process.env.CHAT_TEMPERATURE;
    process.env.CHAT_TEMPERATURE = '';
    
    const settings = getChatSettings();
    // Empty string → parseFloat('') → NaN, but the function checks with ternary
    // '' is falsy, so chatTemperature should be undefined
    expect(settings.chatTemperature).toBeUndefined();
    
    process.env.CHAT_TEMPERATURE = origTemp;
  });

  it('should return numeric temperature when set', () => {
    const origTemp = process.env.CHAT_TEMPERATURE;
    process.env.CHAT_TEMPERATURE = '0.7';
    
    const settings = getChatSettings();
    expect(settings.chatTemperature).toBe(0.7);
    
    process.env.CHAT_TEMPERATURE = origTemp;
  });

  it('should return reasoningEffort when set', () => {
    const origEffort = process.env.CHAT_REASONING_EFFORT;
    process.env.CHAT_REASONING_EFFORT = 'high';
    
    const settings = getChatSettings();
    expect(settings.reasoningEffort).toBe('high');
    
    process.env.CHAT_REASONING_EFFORT = origEffort;
  });
});

// ─────────────────────────────────────────────────────────────
// sendChatMessageCompletions (mocked)
// ─────────────────────────────────────────────────────────────
describe('sendChatMessageCompletions (mocked)', () => {
  const metrics = [];

  afterAll(() => {
    console.log('\n📊 sendChatMessageCompletions Metrics:');
    metrics.forEach(m => console.log(`   ${m}`));
  });

  beforeEach(() => {
    mockOpenAIInstance.chat.completions.create.mockClear();
  });

  it('should send conversation history and return AI response', async () => {
    const conversationHistory = [
      { role: 'user', content: 'Hello, how are you?' },
    ];

    const { result, durationMs } = await measureTime(() =>
      sendChatMessageCompletions(conversationHistory)
    );
    metrics.push(formatMetrics('basic call', durationMs));

    expect(result).toBe('Mock AI response');
    expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledTimes(1);
    
    // Verify the request shape
    const callArgs = mockOpenAIInstance.chat.completions.create.mock.calls[0][0];
    expect(callArgs).toHaveProperty('messages');
    expect(callArgs).toHaveProperty('model');
    expect(callArgs).toHaveProperty('max_completion_tokens');
    // First message should be system
    expect(callArgs.messages[0].role).toBe('system');
    // User message should be included
    expect(callArgs.messages[1].role).toBe('user');
    expect(callArgs.messages[1].content).toBe('Hello, how are you?');
  });

  it('should include multi-turn history', async () => {
    const conversationHistory = [
      { role: 'user', content: 'First message' },
      { role: 'assistant', content: 'First reply' },
      { role: 'user', content: 'Second message' },
    ];

    const { result, durationMs } = await measureTime(() =>
      sendChatMessageCompletions(conversationHistory)
    );
    metrics.push(formatMetrics('multi-turn (3 messages)', durationMs));

    expect(result).toBe('Mock AI response');
    const callArgs = mockOpenAIInstance.chat.completions.create.mock.calls[0][0];
    // system + 3 history messages = 4 total
    expect(callArgs.messages).toHaveLength(4);
  });

  it('should throw on empty response', async () => {
    mockOpenAIInstance.chat.completions.create.mockResolvedValueOnce({
      choices: [],
    });

    await expect(
      sendChatMessageCompletions([{ role: 'user', content: 'test' }])
    ).rejects.toThrow('No response from OpenAI Chat Completions API');
  });
});

// ─────────────────────────────────────────────────────────────
// sendChatMessageResponses (mocked)
// ─────────────────────────────────────────────────────────────
describe('sendChatMessageResponses (mocked)', () => {
  const metrics = [];

  afterAll(() => {
    console.log('\n📊 sendChatMessageResponses Metrics:');
    metrics.forEach(m => console.log(`   ${m}`));
  });

  beforeEach(() => {
    mockOpenAIInstance.responses.create.mockClear();
  });

  it('should send conversation and return response via Responses API', async () => {
    const conversationHistory = [
      { role: 'user', content: 'What is 2 + 2?' },
    ];

    const { result, durationMs } = await measureTime(() =>
      sendChatMessageResponses(conversationHistory)
    );
    metrics.push(formatMetrics('basic call', durationMs));

    expect(result).toBe('Mock AI response via responses API');
    expect(mockOpenAIInstance.responses.create).toHaveBeenCalledTimes(1);
    
    const callArgs = mockOpenAIInstance.responses.create.mock.calls[0][0];
    expect(callArgs).toHaveProperty('model');
    expect(callArgs).toHaveProperty('instructions');
    expect(callArgs).toHaveProperty('input');
    expect(callArgs.store).toBe(false);
  });

  it('should fall back to output array when output_text is missing', async () => {
    mockOpenAIInstance.responses.create.mockResolvedValueOnce({
      output_text: null,
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'Fallback response text' }],
        },
      ],
    });

    const { result, durationMs } = await measureTime(() =>
      sendChatMessageResponses([{ role: 'user', content: 'test' }])
    );
    metrics.push(formatMetrics('fallback path', durationMs));

    expect(result).toBe('Fallback response text');
  });

  it('should throw when no response content available', async () => {
    mockOpenAIInstance.responses.create.mockResolvedValueOnce({
      output_text: null,
      output: [],
    });

    await expect(
      sendChatMessageResponses([{ role: 'user', content: 'test' }])
    ).rejects.toThrow('No response from OpenAI Responses API');
  });
});

// ─────────────────────────────────────────────────────────────
// sendChatMessage (router - mocked)
// ─────────────────────────────────────────────────────────────
describe('sendChatMessage (routing)', () => {
  beforeEach(() => {
    mockOpenAIInstance.chat.completions.create.mockClear();
    mockOpenAIInstance.responses.create.mockClear();
  });

  it('should route to the correct backend based on env', async () => {
    const conversationHistory = [{ role: 'user', content: 'test routing' }];

    const { result, durationMs } = await measureTime(() =>
      sendChatMessage(conversationHistory)
    );
    console.log(`📊 sendChatMessage routing: ${durationMs}ms`);

    // The result should come from whichever backend is configured
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// LIVE API TESTS
// ─────────────────────────────────────────────────────────────
liveDescribe('sendChatMessage (LIVE API)', () => {
  const metrics = [];
  let liveChatFunctions;

  beforeAll(() => {
    jest.unmock('openai');
    jest.resetModules();
    liveChatFunctions = require('../functions/chatFunctions');
  });

  afterAll(() => {
    console.log('\n🔴 LIVE API - sendChatMessage Metrics:');
    metrics.forEach(m => console.log(`   ${m}`));
  });

  it('should get a real response from OpenAI', async () => {
    const conversationHistory = [
      { role: 'user', content: 'Reply with exactly: TEST_OK' },
    ];

    const { result, durationMs } = await measureTime(() =>
      liveChatFunctions.sendChatMessage(conversationHistory)
    );
    metrics.push(formatMetrics('live chat call', durationMs, { responseLength: result.length }));

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    console.log(`   Live response: "${result.substring(0, 100)}..."`);
  });
});

liveDescribe('sendChatMessageCompletions (LIVE API)', () => {
  const metrics = [];
  let liveChatFunctions;

  beforeAll(() => {
    jest.unmock('openai');
    jest.resetModules();
    liveChatFunctions = require('../functions/chatFunctions');
  });

  afterAll(() => {
    console.log('\n🔴 LIVE API - sendChatMessageCompletions Metrics:');
    metrics.forEach(m => console.log(`   ${m}`));
  });

  it('should complete a basic chat via completions API', async () => {
    const conversationHistory = [
      { role: 'user', content: 'What is 2 + 2? Reply with only the number.' },
    ];

    const { result, durationMs } = await measureTime(() =>
      liveChatFunctions.sendChatMessageCompletions(conversationHistory)
    );
    metrics.push(formatMetrics('completions basic', durationMs, { responseLength: result.length }));

    expect(typeof result).toBe('string');
    expect(result).toMatch(/4/);
    console.log(`   Live completions response: "${result}"`);
  });

  it('should handle multi-turn conversation via completions', async () => {
    const conversationHistory = [
      { role: 'user', content: 'Remember this number: 42' },
      { role: 'assistant', content: 'I have noted the number 42.' },
      { role: 'user', content: 'What number did I ask you to remember? Reply with only the number.' },
    ];

    const { result, durationMs } = await measureTime(() =>
      liveChatFunctions.sendChatMessageCompletions(conversationHistory)
    );
    metrics.push(formatMetrics('completions multi-turn', durationMs, { responseLength: result.length }));

    expect(typeof result).toBe('string');
    expect(result).toMatch(/42/);
    console.log(`   Live multi-turn response: "${result}"`);
  });

  it('should handle long-form response via completions', async () => {
    const conversationHistory = [
      { role: 'user', content: 'List exactly 3 primary colors, one per line.' },
    ];

    const { result, durationMs } = await measureTime(() =>
      liveChatFunctions.sendChatMessageCompletions(conversationHistory)
    );
    metrics.push(formatMetrics('completions long-form', durationMs, { responseLength: result.length }));

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(5);
    // Should mention at least one primary color
    expect(result.toLowerCase()).toMatch(/red|blue|yellow/);
    console.log(`   Live long-form response: "${result.substring(0, 200)}"`);
  });
});

liveDescribe('sendChatMessageResponses (LIVE API)', () => {
  const metrics = [];
  let liveChatFunctions;

  beforeAll(() => {
    jest.unmock('openai');
    jest.resetModules();
    liveChatFunctions = require('../functions/chatFunctions');
  });

  afterAll(() => {
    console.log('\n🔴 LIVE API - sendChatMessageResponses Metrics:');
    metrics.forEach(m => console.log(`   ${m}`));
  });

  it('should complete a basic chat via responses API', async () => {
    const conversationHistory = [
      { role: 'user', content: 'What is the capital of France? Reply with only the city name.' },
    ];

    const { result, durationMs } = await measureTime(() =>
      liveChatFunctions.sendChatMessageResponses(conversationHistory)
    );
    metrics.push(formatMetrics('responses basic', durationMs, { responseLength: result.length }));

    expect(typeof result).toBe('string');
    expect(result.toLowerCase()).toContain('paris');
    console.log(`   Live responses API response: "${result}"`);
  });

  it('should handle multi-turn conversation via responses', async () => {
    const conversationHistory = [
      { role: 'user', content: 'My favorite color is green.' },
      { role: 'assistant', content: 'Great, I\'ll remember that your favorite color is green!' },
      { role: 'user', content: 'What is my favorite color? Reply with only the color.' },
    ];

    const { result, durationMs } = await measureTime(() =>
      liveChatFunctions.sendChatMessageResponses(conversationHistory)
    );
    metrics.push(formatMetrics('responses multi-turn', durationMs, { responseLength: result.length }));

    expect(typeof result).toBe('string');
    expect(result.toLowerCase()).toContain('green');
    console.log(`   Live responses multi-turn: "${result}"`);
  });

  it('should return a non-trivial response for open-ended question', async () => {
    const conversationHistory = [
      { role: 'user', content: 'Explain in one sentence what JavaScript is.' },
    ];

    const { result, durationMs } = await measureTime(() =>
      liveChatFunctions.sendChatMessageResponses(conversationHistory)
    );
    metrics.push(formatMetrics('responses open-ended', durationMs, { responseLength: result.length }));

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(20);
    console.log(`   Live open-ended response: "${result.substring(0, 200)}"`);
  });
});
