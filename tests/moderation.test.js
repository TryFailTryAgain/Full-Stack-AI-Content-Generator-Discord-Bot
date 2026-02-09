/**
 * Tests for functions/moderation.js
 *
 * Tests the moderateContent function with both mocked and (optionally) live OpenAI calls.
 * The bad-words filter is tested with real filter behavior (no mock needed).
 *
 * Metrics tracked: execution time, moderation results, filter behavior.
 */

const path = require('path');
require(path.resolve(__dirname, '..', 'tests', 'setup.js'));

const { measureTime, formatMetrics, isLiveMode, liveDescribe, createMockOpenAIClient, createFlaggedModerationResponse } = require('./utils/testHelpers');

// ─── Mock setup ──────────────────────────────────────────────
const mockOpenAI = createMockOpenAIClient();

jest.mock('openai', () => {
  // moderation.js does: const OpenAI = require('openai'); new OpenAI({apiKey: ...})
  // The mock constructor must capture the apiKey and store it on the instance
  const MockOpenAI = jest.fn().mockImplementation((opts) => {
    mockOpenAI.apiKey = opts?.apiKey;
    return mockOpenAI;
  });
  MockOpenAI.OpenAI = MockOpenAI;
  return MockOpenAI;
});

const { moderateContent } = require('../functions/moderation');

// ─────────────────────────────────────────────────────────────
// moderateContent - OpenAI moderation disabled
// ─────────────────────────────────────────────────────────────
describe('moderateContent (OpenAI moderation disabled)', () => {
  const metrics = [];
  const origModeration = process.env.MODERATION_OPENAI_MODERATION;

  beforeAll(() => {
    process.env.MODERATION_OPENAI_MODERATION = 'false';
  });

  afterAll(() => {
    process.env.MODERATION_OPENAI_MODERATION = origModeration;
    console.log('\n📊 moderateContent (disabled) Metrics:');
    metrics.forEach(m => console.log(`   ${m}`));
  });

  it('should return not-flagged with cleaned text when disabled', async () => {
    const { result, durationMs } = await measureTime(() =>
      moderateContent({ text: 'Hello world, this is a simple test.' })
    );
    metrics.push(formatMetrics('clean text (disabled)', durationMs));

    expect(result.flagged).toBe(false);
    expect(result.flaggedCategories).toEqual([]);
    expect(typeof result.cleanedText).toBe('string');
  });

  it('should still apply bad-words filter even when OpenAI moderation is off', async () => {
    const origBadWords = process.env.MODERATION_BAD_WORDS_FILTER;
    process.env.MODERATION_BAD_WORDS_FILTER = 'true';

    const { result, durationMs } = await measureTime(() =>
      moderateContent({ text: 'This is a damn test' })
    );
    metrics.push(formatMetrics('bad-words filter (OpenAI off)', durationMs));

    // bad-words filter should have cleaned "damn"
    expect(result.flagged).toBe(false);
    // cleanedText might have asterisks replacing the bad word
    expect(result.cleanedText).not.toBe('This is a damn test');

    process.env.MODERATION_BAD_WORDS_FILTER = origBadWords;
  });

  it('should skip bad-words filter when MODERATION_BAD_WORDS_FILTER is false', async () => {
    const origBadWords = process.env.MODERATION_BAD_WORDS_FILTER;
    process.env.MODERATION_BAD_WORDS_FILTER = 'false';

    const { result, durationMs } = await measureTime(() =>
      moderateContent({ text: 'This is a damn test' })
    );
    metrics.push(formatMetrics('bad-words filter disabled', durationMs));

    expect(result.cleanedText).toBe('This is a damn test');

    process.env.MODERATION_BAD_WORDS_FILTER = origBadWords;
  });
});

// ─────────────────────────────────────────────────────────────
// moderateContent - OpenAI moderation enabled (mocked)
// ─────────────────────────────────────────────────────────────
describe('moderateContent (OpenAI moderation enabled, mocked)', () => {
  const metrics = [];
  const origModeration = process.env.MODERATION_OPENAI_MODERATION;

  beforeAll(() => {
    process.env.MODERATION_OPENAI_MODERATION = 'true';
  });

  afterAll(() => {
    process.env.MODERATION_OPENAI_MODERATION = origModeration;
    console.log('\n📊 moderateContent (enabled, mocked) Metrics:');
    metrics.forEach(m => console.log(`   ${m}`));
  });

  beforeEach(() => {
    mockOpenAI.moderations.create.mockClear();
  });

  it('should call OpenAI moderation API and return not-flagged for clean text', async () => {
    mockOpenAI.moderations.create.mockResolvedValueOnce({
      results: [
        {
          flagged: false,
          categories: {
            flagged_category_a: false, 'flagged_category_a/threatening': false,
            flagged_category_b: false, 'flagged_category_b/graphic': false,
          },
        },
      ],
    });

    const { result, durationMs } = await measureTime(() =>
      moderateContent({ text: 'This is a clean and friendly message.' })
    );
    metrics.push(formatMetrics('clean text (mocked)', durationMs));

    expect(result.flagged).toBe(false);
    expect(result.flaggedCategories).toEqual([]);
    expect(mockOpenAI.moderations.create).toHaveBeenCalledTimes(1);

    // Verify the API call shape
    const callArgs = mockOpenAI.moderations.create.mock.calls[0][0];
    expect(callArgs.model).toBe('omni-moderation-latest');
    expect(callArgs.input).toContain('This is a clean and friendly message.');
  });

  it('should detect flagged content and return flagged categories', async () => {
    mockOpenAI.moderations.create.mockResolvedValueOnce(
      createFlaggedModerationResponse(['flagged_category_a', 'flagged_category_b'])
    );

    const { result, durationMs } = await measureTime(() =>
      moderateContent({ text: 'Some content that would be flagged.' })
    );
    metrics.push(formatMetrics('flagged content (mocked)', durationMs));

    expect(result.flagged).toBe(true);
    expect(result.flaggedCategories).toContain('flagged_category_a');
    expect(result.flaggedCategories).toContain('flagged_category_b');
  });

  it('should handle image URL input', async () => {
    mockOpenAI.moderations.create.mockResolvedValueOnce({
      results: [
        {
          flagged: false,
          categories: { flagged_category_a: false, flagged_category_b: false },
        },
      ],
    });

    const { result, durationMs } = await measureTime(() =>
      moderateContent({ image: 'https://example.com/safe-image.jpg' })
    );
    metrics.push(formatMetrics('image URL moderation', durationMs));

    expect(result.flagged).toBe(false);
    expect(mockOpenAI.moderations.create).toHaveBeenCalledTimes(1);
    const callArgs = mockOpenAI.moderations.create.mock.calls[0][0];
    expect(callArgs.input).toContain('https://example.com/safe-image.jpg');
  });

  it('should handle image Buffer input', async () => {
    mockOpenAI.moderations.create.mockResolvedValueOnce({
      results: [
        {
          flagged: false,
          categories: { flagged_category_a: false, flagged_category_b: false },
        },
      ],
    });

    const imageBuffer = Buffer.from('fake-image-data');
    const { result, durationMs } = await measureTime(() =>
      moderateContent({ image: imageBuffer })
    );
    metrics.push(formatMetrics('image Buffer moderation', durationMs));

    expect(result.flagged).toBe(false);
    const callArgs = mockOpenAI.moderations.create.mock.calls[0][0];
    // Buffer should be converted to base64
    expect(callArgs.input[0]).toBe(imageBuffer.toString('base64'));
  });

  it('should handle combined text and image', async () => {
    mockOpenAI.moderations.create.mockResolvedValueOnce({
      results: [
        { flagged: false, categories: { flagged_category_a: false } },
        { flagged: false, categories: { flagged_category_a: false } },
      ],
    });

    const { result, durationMs } = await measureTime(() =>
      moderateContent({ text: 'Check this image', image: 'https://example.com/img.png' })
    );
    metrics.push(formatMetrics('text + image moderation', durationMs));

    expect(result.flagged).toBe(false);
    const callArgs = mockOpenAI.moderations.create.mock.calls[0][0];
    expect(callArgs.input).toHaveLength(2);
  });

  it('should throw when no content provided', async () => {
    await expect(moderateContent({})).rejects.toThrow('No content provided');
  });

  it('should throw for invalid image type', async () => {
    await expect(moderateContent({ image: 12345 })).rejects.toThrow('Image must be a URL string or a Buffer');
  });
});

// ─────────────────────────────────────────────────────────────
// LIVE API TESTS
// ─────────────────────────────────────────────────────────────
liveDescribe('moderateContent (LIVE API)', () => {
  const metrics = [];

  afterAll(() => {
    console.log('\n🔴 LIVE API - moderateContent Metrics:');
    metrics.forEach(m => console.log(`   ${m}`));
  });

  it('should moderate clean text via real OpenAI API', async () => {
    jest.resetModules();
    process.env.MODERATION_OPENAI_MODERATION = 'true';
    const liveModeration = require('../functions/moderation');

    const { result, durationMs } = await measureTime(() =>
      liveModeration.moderateContent({ text: 'Hello, I love sunny days and friendly cats.' })
    );
    metrics.push(formatMetrics('live clean text', durationMs, {
      flagged: result.flagged,
      categories: result.flaggedCategories.length,
    }));

    expect(result.flagged).toBe(false);
    expect(result.flaggedCategories).toEqual([]);
    console.log(`   Clean text moderation took ${durationMs}ms`);
  });
});
