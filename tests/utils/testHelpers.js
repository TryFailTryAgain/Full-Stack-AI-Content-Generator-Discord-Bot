/**
 * Test helper utilities for timing, metrics, and common assertions.
 */

/**
 * Measures execution time of an async function.
 * Returns { result, durationMs }.
 */
async function measureTime(fn) {
  const start = performance.now();
  const result = await fn();
  const end = performance.now();
  const durationMs = Math.round((end - start) * 100) / 100;
  return { result, durationMs };
}

/**
 * Checks if we're in live API mode.
 */
function isLiveMode() {
  return process.env.LIVE_API === 'true';
}

/**
 * Skip a test block unless in live API mode.
 * Usage: conditionalDescribe('live tests', () => { ... })
 */
const liveDescribe = isLiveMode() ? describe : describe.skip;
const liveIt = isLiveMode() ? it : it.skip;

/**
 * Creates a mock Discord interaction object for testing.
 */
function createMockInteraction(overrides = {}) {
  return {
    user: { id: '123456789', username: 'testuser', ...overrides.user },
    channel: {
      id: '987654321',
      awaitMessages: jest.fn().mockResolvedValue({ size: 0, first: () => null }),
      ...overrides.channel,
    },
    guild: { id: '111222333', name: 'Test Guild', ...overrides.guild },
    options: {
      getString: jest.fn().mockReturnValue('test-value'),
      getInteger: jest.fn().mockReturnValue(1),
      getNumber: jest.fn().mockReturnValue(1.0),
      getBoolean: jest.fn().mockReturnValue(false),
      getAttachment: jest.fn().mockReturnValue(null),
      getSubcommand: jest.fn().mockReturnValue('generate'),
      ...overrides.options,
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    deleteReply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Creates a mock OpenAI client.
 */
function createMockOpenAIClient(overrides = {}) {
  return {
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: 'Mock AI response',
                role: 'assistant',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        }),
      },
    },
    responses: {
      create: jest.fn().mockResolvedValue({
        output_text: 'Mock AI response via responses API',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Mock AI response via responses API' }],
          },
        ],
      }),
    },
    images: {
      generate: jest.fn().mockResolvedValue({
        data: [
          {
            url: 'https://mock-image-url.test/image.png',
            b64_json: Buffer.from('fake-image-data').toString('base64'),
          },
        ],
      }),
    },
    moderations: {
      create: jest.fn().mockResolvedValue({
        results: [
          {
            flagged: false,
            categories: {
              flagged_category_a: false,
              'flagged_category_a/threatening': false,
              flagged_category_b: false,
              'flagged_category_b/graphic': false,
            },
            category_scores: {
              flagged_category_a: 0.0001,
              'flagged_category_a/threatening': 0.0001,
              flagged_category_b: 0.0001,
              'flagged_category_b/graphic': 0.0001,
            },
          },
        ],
      }),
    },
    ...overrides,
  };
}

/**
 * Creates a mock flagged moderation response.
 */
function createFlaggedModerationResponse(categories = ['flagged_category_a']) {
  const result = {
    flagged: true,
    categories: {},
    category_scores: {},
  };
  const allCategories = [
    'flagged_category_a',
    'flagged_category_a/threatening',
    'flagged_category_b',
    'flagged_category_b/graphic',
  ];
  for (const cat of allCategories) {
    result.categories[cat] = categories.includes(cat);
    result.category_scores[cat] = categories.includes(cat) ? 0.95 : 0.001;
  }
  return { results: [result] };
}

/**
 * Creates a mock Replicate client.
 */
function createMockReplicateClient() {
  return {
    run: jest.fn().mockResolvedValue([
      'https://mock-replicate-output.test/image1.png',
    ]),
  };
}

/**
 * Produces a simple reporting string for timing metrics.
 */
function formatMetrics(testName, durationMs, extra = {}) {
  const parts = [`${testName}: ${durationMs}ms`];
  for (const [key, value] of Object.entries(extra)) {
    parts.push(`${key}=${value}`);
  }
  return parts.join(' | ');
}

module.exports = {
  measureTime,
  isLiveMode,
  liveDescribe,
  liveIt,
  createMockInteraction,
  createMockOpenAIClient,
  createFlaggedModerationResponse,
  createMockReplicateClient,
  formatMetrics,
};
