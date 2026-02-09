/**
 * Error path tests for Chat Functions.
 *
 * Tests network failures, rate limits, malformed API responses,
 * and edge cases in chat settings.
 */

const path = require('path');
require(path.resolve(__dirname, '..', 'tests', 'setup.js'));

const { createMockOpenAIClient } = require('./utils/testHelpers');

// ─── Mock setup ──────────────────────────────────────────────

const mockOpenAI = createMockOpenAIClient();

jest.mock('openai', () => {
  const MockOpenAI = jest.fn().mockImplementation(() => mockOpenAI);
  MockOpenAI.OpenAI = MockOpenAI;
  return MockOpenAI;
});

// Mock image_functions so chatFunctions can load (chatFunctions imports image_functions at module level)
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

// Ensure completions backend is used (another test may set this to 'responses')
process.env.CHAT_API_BACKEND = 'completions';

// Require chat functions (these use the mocked image_functions and openai)
const chatFunctions = require('../functions/chatFunctions');

// ─────────────────────────────────────────────────────────────
// Chat Functions - Error Paths
// ─────────────────────────────────────────────────────────────
describe('Chat Functions - Error Paths', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset default mock responses
    mockOpenAI.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: 'Test response', role: 'assistant' } }],
    });
    mockOpenAI.responses.create.mockResolvedValue({
      output_text: 'Test response via responses',
    });
  });

  describe('sendChatMessageCompletions', () => {
    it('should throw on network error', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValueOnce(
        new Error('ECONNREFUSED: Connection refused')
      );

      await expect(
        chatFunctions.sendChatMessageCompletions([{ role: 'user', content: 'hi' }])
      ).rejects.toThrow('ECONNREFUSED');
    });

    it('should throw on rate limit error (429)', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      rateLimitError.status = 429;
      rateLimitError.code = 'rate_limit_exceeded';
      mockOpenAI.chat.completions.create.mockRejectedValueOnce(rateLimitError);

      await expect(
        chatFunctions.sendChatMessageCompletions([{ role: 'user', content: 'hi' }])
      ).rejects.toThrow('Rate limit');
    });

    it('should throw when response has empty choices array', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValueOnce({
        choices: [],
      });

      await expect(
        chatFunctions.sendChatMessageCompletions([{ role: 'user', content: 'hi' }])
      ).rejects.toThrow('No response');
    });

    it('should throw when response has null choices', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValueOnce({
        choices: null,
      });

      await expect(
        chatFunctions.sendChatMessageCompletions([{ role: 'user', content: 'hi' }])
      ).rejects.toThrow();
    });

    it('should throw when response is completely empty object', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValueOnce({});

      await expect(
        chatFunctions.sendChatMessageCompletions([{ role: 'user', content: 'hi' }])
      ).rejects.toThrow('No response');
    });

    it('should handle API timeout errors', async () => {
      const timeoutError = new Error('Request timed out');
      timeoutError.code = 'ETIMEDOUT';
      mockOpenAI.chat.completions.create.mockRejectedValueOnce(timeoutError);

      await expect(
        chatFunctions.sendChatMessageCompletions([{ role: 'user', content: 'hi' }])
      ).rejects.toThrow('timed out');
    });
  });

  describe('sendChatMessageResponses', () => {
    it('should throw on network error', async () => {
      mockOpenAI.responses.create.mockRejectedValueOnce(
        new Error('Network error: fetch failed')
      );

      await expect(
        chatFunctions.sendChatMessageResponses([{ role: 'user', content: 'hi' }])
      ).rejects.toThrow('Network error');
    });

    it('should throw when output_text is null and output array is empty', async () => {
      mockOpenAI.responses.create.mockResolvedValueOnce({
        output_text: null,
        output: [],
      });

      await expect(
        chatFunctions.sendChatMessageResponses([{ role: 'user', content: 'hi' }])
      ).rejects.toThrow('No response');
    });

    it('should throw when output has items but no message type', async () => {
      mockOpenAI.responses.create.mockResolvedValueOnce({
        output_text: null,
        output: [
          { type: 'function_call', content: [] },
        ],
      });

      await expect(
        chatFunctions.sendChatMessageResponses([{ role: 'user', content: 'hi' }])
      ).rejects.toThrow('No response');
    });

    it('should throw when message item has no text content', async () => {
      mockOpenAI.responses.create.mockResolvedValueOnce({
        output_text: null,
        output: [
          { type: 'message', content: [{ type: 'image', url: 'http://example.com' }] },
        ],
      });

      await expect(
        chatFunctions.sendChatMessageResponses([{ role: 'user', content: 'hi' }])
      ).rejects.toThrow('No response');
    });

    it('should fallback to output array when output_text is undefined', async () => {
      mockOpenAI.responses.create.mockResolvedValueOnce({
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'fallback response' }],
          },
        ],
      });

      const result = await chatFunctions.sendChatMessageResponses([
        { role: 'user', content: 'hi' },
      ]);
      expect(result).toBe('fallback response');
    });
  });

  describe('sendChatMessage (router)', () => {
    it('should propagate error from completions backend', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValueOnce(
        new Error('backend failure')
      );

      await expect(
        chatFunctions.sendChatMessage([{ role: 'user', content: 'hi' }])
      ).rejects.toThrow('backend failure');
    });
  });

  describe('getChatSettings edge cases', () => {
    it('should return undefined temperature when env var is empty string', () => {
      const originalTemp = process.env.CHAT_TEMPERATURE;
      process.env.CHAT_TEMPERATURE = '';

      const settings = chatFunctions.getChatSettings();
      expect(settings.chatTemperature).toBeUndefined();

      process.env.CHAT_TEMPERATURE = originalTemp;
    });

    it('should return NaN temperature for non-numeric string', () => {
      const originalTemp = process.env.CHAT_TEMPERATURE;
      process.env.CHAT_TEMPERATURE = 'not-a-number';

      const settings = chatFunctions.getChatSettings();
      expect(settings.chatTemperature).toBeNaN();

      process.env.CHAT_TEMPERATURE = originalTemp;
    });

    it('should return NaN maxTokens for non-numeric string', () => {
      const original = process.env.CHAT_MAX_TOKENS;
      process.env.CHAT_MAX_TOKENS = 'invalid';

      const settings = chatFunctions.getChatSettings();
      expect(settings.maxTokens).toBeNaN();

      process.env.CHAT_MAX_TOKENS = original;
    });

    it('should return undefined reasoningEffort when env var is empty', () => {
      const original = process.env.CHAT_REASONING_EFFORT;
      process.env.CHAT_REASONING_EFFORT = '';

      const settings = chatFunctions.getChatSettings();
      expect(settings.reasoningEffort).toBeUndefined();

      process.env.CHAT_REASONING_EFFORT = original;
    });
  });
});
