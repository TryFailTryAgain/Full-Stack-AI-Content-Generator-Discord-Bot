/**
 * Tests for functions/helperFunctions.js
 *
 * Tests pure utility functions directly. Functions requiring Discord interaction
 * objects are tested with mocks to verify they call the right Discord APIs.
 *
 * Metrics tracked: execution time for each function call.
 */

const path = require('path');
// Load env before requiring modules that read env at import time
require(path.resolve(__dirname, '..', 'tests', 'setup.js'));

const { measureTime, formatMetrics, createMockInteraction } = require('./utils/testHelpers');

// helperFunctions.js is safe to import - it only uses Node.js builtins (crypto, fs, ini, sharp)
const {
  generateHashedUserId,
  generateRandomHex,
  saveToDiskCheck,
  deleteAndFollowUpEphemeral,
  followUpEphemeral,
  sendImages,
} = require('../functions/helperFunctions');

// ─────────────────────────────────────────────────────────────
// generateHashedUserId
// ─────────────────────────────────────────────────────────────
describe('generateHashedUserId', () => {
  const metrics = [];

  afterAll(() => {
    console.log('\n📊 generateHashedUserId Metrics:');
    metrics.forEach(m => console.log(`   ${m}`));
  });

  it('should return a hex string of consistent length', async () => {
    const { result, durationMs } = await measureTime(() => generateHashedUserId('12345'));
    metrics.push(formatMetrics('basic hash', durationMs, { inputLength: 5 }));

    expect(typeof result).toBe('string');
    // pbkdf2 with 64 bytes → 128 hex chars
    expect(result).toHaveLength(128);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it('should produce the same hash for the same input', async () => {
    const { result: hash1 } = await measureTime(() => generateHashedUserId('user-abc'));
    const { result: hash2, durationMs } = await measureTime(() => generateHashedUserId('user-abc'));
    metrics.push(formatMetrics('consistency check', durationMs));

    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different inputs', async () => {
    const { result: hash1 } = await measureTime(() => generateHashedUserId('user-1'));
    const { result: hash2, durationMs } = await measureTime(() => generateHashedUserId('user-2'));
    metrics.push(formatMetrics('uniqueness check', durationMs));

    expect(hash1).not.toBe(hash2);
  });

  it('should handle numeric input (converted to string)', async () => {
    const { result, durationMs } = await measureTime(() => generateHashedUserId(99999));
    metrics.push(formatMetrics('numeric input', durationMs));

    expect(typeof result).toBe('string');
    expect(result).toHaveLength(128);
  });
});

// ─────────────────────────────────────────────────────────────
// generateRandomHex
// ─────────────────────────────────────────────────────────────
describe('generateRandomHex', () => {
  const metrics = [];

  afterAll(() => {
    console.log('\n📊 generateRandomHex Metrics:');
    metrics.forEach(m => console.log(`   ${m}`));
  });

  it('should return a hex string of 8 characters', () => {
    const { result, durationMs } = (() => {
      const start = performance.now();
      const r = generateRandomHex();
      return { result: r, durationMs: Math.round((performance.now() - start) * 100) / 100 };
    })();
    metrics.push(formatMetrics('single call', durationMs));

    expect(typeof result).toBe('string');
    expect(result).toHaveLength(8);
    expect(result).toMatch(/^[0-9a-f]{8}$/);
  });

  it('should generate unique values across 100 calls', () => {
    const start = performance.now();
    const values = new Set();
    for (let i = 0; i < 100; i++) {
      values.add(generateRandomHex());
    }
    const durationMs = Math.round((performance.now() - start) * 100) / 100;
    metrics.push(formatMetrics('100 calls uniqueness', durationMs, { uniqueCount: values.size }));

    // With ~4 billion possible values, 100 should almost certainly all be unique
    // Allow up to 2 collisions to be safe
    expect(values.size).toBeGreaterThanOrEqual(98);
  });
});

// ─────────────────────────────────────────────────────────────
// saveToDiskCheck
// ─────────────────────────────────────────────────────────────
describe('saveToDiskCheck', () => {
  const originalSaveImages = process.env.ADVCONF_SAVE_IMAGES;

  afterEach(() => {
    // Restore original value
    process.env.ADVCONF_SAVE_IMAGES = originalSaveImages;
  });

  it('should return true when ADVCONF_SAVE_IMAGES is "true"', async () => {
    process.env.ADVCONF_SAVE_IMAGES = 'true';
    const result = await saveToDiskCheck();
    expect(result).toBe(true);
  });

  it('should return false when ADVCONF_SAVE_IMAGES is "false"', async () => {
    process.env.ADVCONF_SAVE_IMAGES = 'false';
    const result = await saveToDiskCheck();
    expect(result).toBe(false);
  });

  it('should handle mixed case "True"', async () => {
    process.env.ADVCONF_SAVE_IMAGES = 'True';
    const result = await saveToDiskCheck();
    expect(result).toBe(true);
  });

  it('should handle mixed case "FALSE"', async () => {
    process.env.ADVCONF_SAVE_IMAGES = 'FALSE';
    const result = await saveToDiskCheck();
    expect(result).toBe(false);
  });

  it('should throw an error for invalid values', async () => {
    process.env.ADVCONF_SAVE_IMAGES = 'maybe';
    await expect(saveToDiskCheck()).rejects.toThrow('The Save_Images setting');
  });
});

// ─────────────────────────────────────────────────────────────
// Discord interaction helpers (mocked)
// ─────────────────────────────────────────────────────────────
describe('deleteAndFollowUpEphemeral', () => {
  it('should call deleteReply then followUp with ephemeral', async () => {
    const interaction = createMockInteraction();
    const message = 'Something went wrong';

    await deleteAndFollowUpEphemeral(interaction, message);

    expect(interaction.deleteReply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: message,
      ephemeral: true,
    });
  });
});

describe('followUpEphemeral', () => {
  it('should call followUp with ephemeral flag', async () => {
    const interaction = createMockInteraction();
    const message = 'Info message';

    await followUpEphemeral(interaction, message);

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: message,
      ephemeral: true,
    });
  });
});

describe('sendImages', () => {
  it('should send each image as a followUp', async () => {
    const interaction = createMockInteraction();
    const mockImages = [Buffer.from('img1'), Buffer.from('img2'), Buffer.from('img3')];

    const { durationMs } = await measureTime(() => sendImages(interaction, mockImages));
    console.log(`📊 sendImages (3 images): ${durationMs}ms`);

    expect(interaction.followUp).toHaveBeenCalledTimes(3);
    expect(interaction.followUp).toHaveBeenNthCalledWith(1, { files: [mockImages[0]] });
    expect(interaction.followUp).toHaveBeenNthCalledWith(2, { files: [mockImages[1]] });
    expect(interaction.followUp).toHaveBeenNthCalledWith(3, { files: [mockImages[2]] });
  });

  it('should handle empty image array', async () => {
    const interaction = createMockInteraction();
    await sendImages(interaction, []);
    expect(interaction.followUp).not.toHaveBeenCalled();
  });
});
