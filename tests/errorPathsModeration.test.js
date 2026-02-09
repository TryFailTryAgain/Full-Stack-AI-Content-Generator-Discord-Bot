/**
 * Error path tests for the Moderation module.
 *
 * Tests input validation, API errors, flagged category aggregation,
 * and behavior when moderation is disabled.
 */

const path = require('path');
require(path.resolve(__dirname, '..', 'tests', 'setup.js'));

const { createMockOpenAIClient } = require('./utils/testHelpers');

// ─── Mock setup ──────────────────────────────────────────────

const mockOpenAI = createMockOpenAIClient();

// Moderation.js does: const OpenAI = require('openai'); new OpenAI(...)
jest.mock('openai', () => {
  const MockOpenAI = jest.fn().mockImplementation(() => mockOpenAI);
  MockOpenAI.OpenAI = MockOpenAI;
  return MockOpenAI;
});

// Do NOT mock moderation.js - we test the real module
// Set env correctly AFTER dotenv has run (setup.js loads dotenv)
process.env.MODERATION_OPENAI_MODERATION = 'true';
process.env.API_KEY_OPENAI_CHAT = 'test-key';

// Set apiKey on the mock so moderation.js line 54 check passes
mockOpenAI.apiKey = 'test-key';

const { moderateContent } = require('../functions/moderation.js');

// ─────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Ensure moderation stays enabled between tests
  process.env.MODERATION_OPENAI_MODERATION = 'true';
  // Re-set apiKey (clearAllMocks doesn't clear plain properties, but be safe)
  mockOpenAI.apiKey = 'test-key';
  // Default: moderation API returns not-flagged
  mockOpenAI.moderations.create.mockResolvedValue({
    results: [{ flagged: false, categories: {}, category_scores: {} }],
  });
});

describe('Moderation - Error Paths', () => {

  it('should throw when no content provided (empty object)', async () => {
    await expect(moderateContent({})).rejects.toThrow('No content provided');
  });

  it('should throw when called with undefined options', async () => {
    await expect(moderateContent()).rejects.toThrow();
  });

  it('should throw for invalid image type (number)', async () => {
    await expect(
      moderateContent({ image: 12345 })
    ).rejects.toThrow('Image must be a URL string or a Buffer');
  });

  it('should throw for invalid image type (plain object)', async () => {
    await expect(
      moderateContent({ image: { url: 'test' } })
    ).rejects.toThrow('Image must be a URL string or a Buffer');
  });

  it('should propagate OpenAI API network error', async () => {
    mockOpenAI.moderations.create.mockRejectedValueOnce(
      new Error('ENOTFOUND: DNS resolution failed')
    );

    await expect(
      moderateContent({ text: 'test content' })
    ).rejects.toThrow('ENOTFOUND');
  });

  it('should propagate rate limit error from moderation API', async () => {
    const error = new Error('Rate limit exceeded');
    error.status = 429;
    mockOpenAI.moderations.create.mockRejectedValueOnce(error);

    await expect(
      moderateContent({ text: 'test content' })
    ).rejects.toThrow('Rate limit');
  });

  it('should correctly aggregate multiple flagged categories', async () => {
    mockOpenAI.moderations.create.mockResolvedValueOnce({
      results: [
        {
          flagged: true,
          categories: { flagged_category_a: true, flagged_category_b: true},
          category_scores: { flagged_category_a: 0.9, flagged_category_b: 0.8},
        },
      ],
    });

    const result = await moderateContent({ text: 'multi-flagged content' });
    expect(result.flagged).toBe(true);
    expect(result.flaggedCategories).toContain('flagged_category_a');
    expect(result.flaggedCategories).toContain('flagged_category_b');
  });

  it('should return not flagged for clean content', async () => {
    const result = await moderateContent({ text: 'hello world' });
    expect(result.flagged).toBe(false);
    expect(result.flaggedCategories).toEqual([]);
    expect(typeof result.cleanedText).toBe('string');
  });

  it('should pass image URL to moderation API input', async () => {
    await moderateContent({ image: 'https://example.com/image.png' });

    expect(mockOpenAI.moderations.create).toHaveBeenCalledTimes(1);
    const callArgs = mockOpenAI.moderations.create.mock.calls[0][0];
    expect(callArgs.input).toContain('https://example.com/image.png');
  });

  it('should convert Buffer image to base64 for moderation API', async () => {
    const imageBuffer = Buffer.from('test-image-data');
    await moderateContent({ image: imageBuffer });

    expect(mockOpenAI.moderations.create).toHaveBeenCalledTimes(1);
    const callArgs = mockOpenAI.moderations.create.mock.calls[0][0];
    expect(callArgs.input[0]).toBe(imageBuffer.toString('base64'));
  });

  it('should handle combined text and image moderation', async () => {
    await moderateContent({
      text: 'some text',
      image: 'https://example.com/img.png',
    });

    expect(mockOpenAI.moderations.create).toHaveBeenCalledTimes(1);
    const callArgs = mockOpenAI.moderations.create.mock.calls[0][0];
    expect(callArgs.input.length).toBe(2);
    expect(callArgs.input).toContain('some text');
    expect(callArgs.input).toContain('https://example.com/img.png');
  });

  it('should use omni-moderation-latest model', async () => {
    await moderateContent({ text: 'test' });

    const callArgs = mockOpenAI.moderations.create.mock.calls[0][0];
    expect(callArgs.model).toBe('omni-moderation-latest');
  });

  it('should skip API call when moderation is disabled', async () => {
    // Use isolateModules to get a fresh moderation instance with different env
    const origVal = process.env.MODERATION_OPENAI_MODERATION;
    process.env.MODERATION_OPENAI_MODERATION = 'false';

    let disabledModerate;
    jest.isolateModules(() => {
      disabledModerate = require('../functions/moderation.js').moderateContent;
    });

    const result = await disabledModerate({ text: 'some clean text' });

    expect(mockOpenAI.moderations.create).not.toHaveBeenCalled();
    expect(result.flagged).toBe(false);
    expect(typeof result.cleanedText).toBe('string');

    process.env.MODERATION_OPENAI_MODERATION = origVal;
  });
});
