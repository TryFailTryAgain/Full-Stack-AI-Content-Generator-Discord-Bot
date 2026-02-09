/**
 * Tests for functions/image_functions.js
 *
 * Pure functions (getDimensions, genSeed, autoDisableUnneededPromptOptimization,
 * validateApiKeys, saveToDiskCheck) are tested directly.
 *
 * Orchestrator functions (generateImage, promptOptimizer, etc.) are tested
 * with mocked providers and mocked OpenAI.
 *
 * In live mode, a real image generation and prompt optimization are tested.
 *
 * Metrics tracked: execution time, seed range, dimension mappings.
 */

const path = require('path');
require(path.resolve(__dirname, '..', 'tests', 'setup.js'));

const { measureTime, formatMetrics, isLiveMode, liveDescribe, createMockOpenAIClient } = require('./utils/testHelpers');

// ─── Mock setup ──────────────────────────────────────────────
// Mock OpenAI before image_functions loads it
const mockOpenAI = createMockOpenAIClient();

jest.mock('openai', () => {
  // image_functions.js does: const OpenAI = require('openai'); new OpenAI({...})
  // So the module.exports itself must be the constructor
  const MockOpenAI = jest.fn().mockImplementation((opts) => {
    mockOpenAI.apiKey = opts?.apiKey;
    return mockOpenAI;
  });
  // Also support destructured import: const { OpenAI } = require('openai')
  MockOpenAI.OpenAI = MockOpenAI;
  return MockOpenAI;
});

// Mock the image command module
jest.mock('../commands/CoreFunctions/image.js', () => ({
  data: { name: 'image' },
  execute: jest.fn(),
}));

// Mock moderation to not flag anything by default
jest.mock('../functions/moderation.js', () => ({
  moderateContent: jest.fn().mockResolvedValue({
    flagged: false,
    flaggedCategories: [],
    cleanedText: 'mock cleaned text',
  }),
}));

// Mock all image providers so they don't make real API calls
const mockImageBuffer = [Buffer.from('mock-png-image-data')];

jest.mock('../functions/image_providers/OpenAI.js', () => ({
  generateImageViaDallE3: jest.fn().mockResolvedValue([Buffer.from('dalle3-mock')]),
  generateImageViaGPTImageGen1: jest.fn().mockResolvedValue([Buffer.from('gpt-image-mock')]),
}));
jest.mock('../functions/image_providers/StabilityXL.js', () => ({
  generateImageViaStabilityAIv1: jest.fn().mockResolvedValue([Buffer.from('stability-mock')]),
  searchAndReplace: jest.fn().mockResolvedValue([Buffer.from('snr-mock')]),
}));
jest.mock('../functions/image_providers/SD3.js', () => ({
  generateImageViaSD3: jest.fn().mockResolvedValue([Buffer.from('sd3-mock')]),
  generateImageToImageViaStabilityAISD3: jest.fn().mockResolvedValue([Buffer.from('sd3-i2i-mock')]),
}));
jest.mock('../functions/image_providers/FluxSchnell.js', () => ({
  generateImageViaReplicate_FluxSchnell: jest.fn().mockResolvedValue([Buffer.from('flux-schnell-mock')]),
}));
jest.mock('../functions/image_providers/FluxDev.js', () => ({
  generateImageViaReplicate_FluxDev: jest.fn().mockResolvedValue([Buffer.from('flux-dev-mock')]),
  generateImageToImageViaReplicate_FluxDev: jest.fn().mockResolvedValue([Buffer.from('flux-dev-i2i-mock')]),
}));
jest.mock('../functions/image_providers/Flux2Dev.js', () => ({
  generateImageViaReplicate_Flux2Dev: jest.fn().mockResolvedValue([Buffer.from('flux2-dev-mock')]),
  generateImageToImageViaReplicate_Flux2Dev: jest.fn().mockResolvedValue([Buffer.from('flux2-dev-i2i-mock')]),
  generateMultiReferenceImageViaReplicate_Flux2Dev: jest.fn().mockResolvedValue([Buffer.from('flux2-dev-multi-mock')]),
  generateImageEditViaReplicate_Flux2Dev: jest.fn().mockResolvedValue([Buffer.from('flux2-dev-edit-mock')]),
}));
jest.mock('../functions/image_providers/Flux2Pro.js', () => ({
  generateImageViaReplicate_Flux2Pro: jest.fn().mockResolvedValue([Buffer.from('flux2-pro-mock')]),
  generateImageToImageViaReplicate_Flux2Pro: jest.fn().mockResolvedValue([Buffer.from('flux2-pro-i2i-mock')]),
  generateMultiReferenceImageViaReplicate_Flux2Pro: jest.fn().mockResolvedValue([Buffer.from('flux2-pro-multi-mock')]),
  generateImageEditViaReplicate_Flux2Pro: jest.fn().mockResolvedValue([Buffer.from('flux2-pro-edit-mock')]),
}));
jest.mock('../functions/image_providers/Flux2Klein4b.js', () => ({
  generateImageViaReplicate_Flux2Klein4b: jest.fn().mockResolvedValue([Buffer.from('flux2-klein4b-mock')]),
  generateImageToImageViaReplicate_Flux2Klein4b: jest.fn().mockResolvedValue([Buffer.from('flux2-klein4b-i2i-mock')]),
  generateImageEditViaReplicate_Flux2Klein4b: jest.fn().mockResolvedValue([Buffer.from('flux2-klein4b-edit-mock')]),
}));
jest.mock('../functions/image_providers/Flux2Klein9bBase.js', () => ({
  generateImageViaReplicate_Flux2Klein9bBase: jest.fn().mockResolvedValue([Buffer.from('flux2-klein9b-mock')]),
  generateImageToImageViaReplicate_Flux2Klein9bBase: jest.fn().mockResolvedValue([Buffer.from('flux2-klein9b-i2i-mock')]),
  generateImageEditViaReplicate_Flux2Klein9bBase: jest.fn().mockResolvedValue([Buffer.from('flux2-klein9b-edit-mock')]),
}));
jest.mock('../functions/image_providers/Flux2Max.js', () => ({
  generateImageViaReplicate_Flux2Max: jest.fn().mockResolvedValue([Buffer.from('flux2-max-mock')]),
  generateImageToImageViaReplicate_Flux2Max: jest.fn().mockResolvedValue([Buffer.from('flux2-max-i2i-mock')]),
  generateImageEditViaReplicate_Flux2Max: jest.fn().mockResolvedValue([Buffer.from('flux2-max-edit-mock')]),
}));
jest.mock('../functions/image_providers/ReplicateESRGAN.js', () => ({
  upscaleImageViaReplicate_esrgan: jest.fn().mockResolvedValue(Buffer.from('upscaled-mock')),
}));
jest.mock('../functions/image_providers/FluxKontextPro.js', () => ({
  generateImageEditViaReplicate_FluxKontextPro: jest.fn().mockResolvedValue([Buffer.from('kontext-pro-mock')]),
}));
jest.mock('../functions/image_providers/FluxKontextDev.js', () => ({
  generateImageEditViaReplicate_FluxKontextDev: jest.fn().mockResolvedValue([Buffer.from('kontext-dev-mock')]),
}));
jest.mock('../functions/image_providers/Seedream3.js', () => ({
  generateImageViaReplicate_Seedream3: jest.fn().mockResolvedValue([Buffer.from('seedream3-mock')]),
}));
jest.mock('../functions/image_providers/Seedream45.js', () => ({
  generateImageViaReplicate_Seedream45: jest.fn().mockResolvedValue([Buffer.from('seedream45-mock')]),
  generateImageToImageViaReplicate_Seedream45: jest.fn().mockResolvedValue([Buffer.from('seedream45-i2i-mock')]),
  generateImageEditViaReplicate_Seedream45: jest.fn().mockResolvedValue([Buffer.from('seedream45-edit-mock')]),
}));
jest.mock('../functions/image_providers/Imagen4Fast.js', () => ({
  generateImageViaReplicate_Imagen4Fast: jest.fn().mockResolvedValue([Buffer.from('imagen4fast-mock')]),
}));
jest.mock('../functions/image_providers/Imagen4.js', () => ({
  generateImageViaReplicate_Imagen4: jest.fn().mockResolvedValue([Buffer.from('imagen4-mock')]),
}));
jest.mock('../functions/image_providers/Imagen4Ultra.js', () => ({
  generateImageViaReplicate_Imagen4Ultra: jest.fn().mockResolvedValue([Buffer.from('imagen4ultra-mock')]),
}));
jest.mock('../functions/image_providers/NanaBananaPro.js', () => ({
  generateImageViaReplicate_NanaBananaPro: jest.fn().mockResolvedValue([Buffer.from('nanabananapro-mock')]),
  generateImageToImageViaReplicate_NanaBananaPro: jest.fn().mockResolvedValue([Buffer.from('nanabananapro-i2i-mock')]),
  generateImageEditViaReplicate_NanaBananaPro: jest.fn().mockResolvedValue([Buffer.from('nanabananapro-edit-mock')]),
}));

// Now require image_functions after all mocks are set up
const {
  getDimensions,
  genSeed,
  autoDisableUnneededPromptOptimization,
  validateApiKeys,
  saveToDiskCheck,
  generateImage,
  generateImageToImage,
  generateImageEdit,
  upscaleImage,
  promptOptimizer,
  adaptImagePrompt,
} = require('../functions/image_functions');

const { moderateContent } = require('../functions/moderation');

// ─────────────────────────────────────────────────────────────
// getDimensions
// ─────────────────────────────────────────────────────────────
describe('getDimensions', () => {
  const metrics = [];

  afterAll(() => {
    console.log('\n📊 getDimensions Metrics:');
    metrics.forEach(m => console.log(`   ${m}`));
  });

  it('should return correct dimensions for dall-e-3 square', () => {
    const start = performance.now();
    const result = getDimensions('dall-e-3', 'square');
    metrics.push(formatMetrics('dall-e-3 square', Math.round((performance.now() - start) * 100) / 100));
    expect(result).toBe('1024x1024');
  });

  it('should return correct dimensions for dall-e-3 tall', () => {
    expect(getDimensions('dall-e-3', 'tall')).toBe('1024x1792');
  });

  it('should return correct dimensions for dall-e-3 wide', () => {
    expect(getDimensions('dall-e-3', 'wide')).toBe('1792x1024');
  });

  it('should return aspect ratios for flux models', () => {
    expect(getDimensions('black-forest-labs/flux-2-dev', 'square')).toBe('1:1');
    expect(getDimensions('black-forest-labs/flux-2-dev', 'tall')).toBe('9:16');
    expect(getDimensions('black-forest-labs/flux-2-dev', 'wide')).toBe('16:9');
  });

  it('should return aspect ratios for SD3 models', () => {
    expect(getDimensions('sd3.5-large', 'square')).toBe('1:1');
    expect(getDimensions('sd3.5-large-turbo', 'tall')).toBe('9:16');
    expect(getDimensions('sd3.5-medium', 'wide')).toBe('16:9');
  });

  it('should return pixel dimensions for SD v1', () => {
    expect(getDimensions('stable-diffusion-v1-6', 'square')).toBe('512x512');
    expect(getDimensions('stable-diffusion-v1-6', 'tall')).toBe('512x896');
    expect(getDimensions('stable-diffusion-v1-6', 'wide')).toBe('896x512');
  });

  it('should return pixel dimensions for SDXL', () => {
    expect(getDimensions('stable-diffusion-xl-1024-v1-0', 'square')).toBe('1024x1024');
    expect(getDimensions('stable-diffusion-xl-1024-v1-0', 'tall')).toBe('768x1344');
  });

  it('should handle newer models (Seedream, Imagen)', () => {
    expect(getDimensions('bytedance/seedream-3', 'square')).toBe('1:1');
    expect(getDimensions('google/imagen-4-fast', 'tall')).toBe('9:16');
    expect(getDimensions('google/imagen-4', 'wide')).toBe('16:9');
    expect(getDimensions('google/imagen-4-ultra', 'square')).toBe('1:1');
    expect(getDimensions('bytedance/seedream-4.5', 'wide')).toBe('16:9');
    expect(getDimensions('google/nano-banana-pro', 'square')).toBe('1:1');
  });

  it('should throw for unsupported model', () => {
    expect(() => getDimensions('unsupported-model', 'square')).toThrow('Unsupported image model');
  });

  it('should return "Invalid dimension type" for unknown dimension type', () => {
    expect(getDimensions('dall-e-3', 'circular')).toBe('Invalid dimension type');
  });

  it('should cover all supported models', () => {
    const supportedModels = [
      'stable-diffusion-xl-1024-v1-0', 'dall-e-3', 'stable-diffusion-v1-6',
      'sd3.5-large', 'sd3.5-large-turbo', 'sd3.5-medium',
      'black-forest-labs/flux-schnell', 'black-forest-labs/flux-dev',
      'black-forest-labs/flux-2-dev', 'black-forest-labs/flux-2-pro',
      'bytedance/seedream-3', 'google/imagen-4-fast', 'google/imagen-4',
      'google/imagen-4-ultra', 'bytedance/seedream-4.5', 'google/nano-banana-pro',
      'black-forest-labs/flux-2-klein-4b', 'black-forest-labs/flux-2-klein-9b-base',
      'black-forest-labs/flux-2-max', 'gpt-image-1',
    ];

    const start = performance.now();
    let testedCount = 0;
    for (const model of supportedModels) {
      try {
        const result = getDimensions(model, 'square');
        expect(result).toBeTruthy();
        testedCount++;
      } catch (e) {
        // gpt-image-1 may not be in the map
        if (!e.message.includes('Unsupported')) throw e;
      }
    }
    const durationMs = Math.round((performance.now() - start) * 100) / 100;
    metrics.push(formatMetrics(`all models (${testedCount} tested)`, durationMs));
  });
});

// ─────────────────────────────────────────────────────────────
// genSeed
// ─────────────────────────────────────────────────────────────
describe('genSeed', () => {
  it('should return a number between 0 and 4294967295', async () => {
    const { result, durationMs } = await measureTime(() => genSeed());
    console.log(`📊 genSeed: ${durationMs}ms, value=${result}`);

    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(4294967295);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('should generate different seeds across calls', async () => {
    const seeds = new Set();
    for (let i = 0; i < 50; i++) {
      seeds.add(await genSeed());
    }
    // At least 45/50 should be unique
    expect(seeds.size).toBeGreaterThanOrEqual(45);
  });
});

// ─────────────────────────────────────────────────────────────
// autoDisableUnneededPromptOptimization
// ─────────────────────────────────────────────────────────────
describe('autoDisableUnneededPromptOptimization', () => {
  it('should return true for dall-e-3', () => {
    expect(autoDisableUnneededPromptOptimization('dall-e-3')).toBe(true);
  });

  it('should return true for sd3-large', () => {
    expect(autoDisableUnneededPromptOptimization('sd3-large')).toBe(true);
  });

  it('should return true for sd3-large-turbo', () => {
    expect(autoDisableUnneededPromptOptimization('sd3-large-turbo')).toBe(true);
  });

  it('should return false for flux models (not in disable list)', () => {
    expect(autoDisableUnneededPromptOptimization('black-forest-labs/flux-2-dev')).toBe(false);
    expect(autoDisableUnneededPromptOptimization('black-forest-labs/flux-schnell')).toBe(false);
  });

  it('should return false for unknown models', () => {
    expect(autoDisableUnneededPromptOptimization('some-new-model')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// validateApiKeys
// ─────────────────────────────────────────────────────────────
describe('validateApiKeys', () => {
  it('should not throw for valid keys', () => {
    expect(() =>
      validateApiKeys({ Keys: { StabilityAI: 'sk-test123', OpenAI: 'sk-test456' } })
    ).not.toThrow();
  });

  it('should throw when StabilityAI key is empty', () => {
    expect(() =>
      validateApiKeys({ Keys: { StabilityAI: '', OpenAI: 'sk-test456' } })
    ).toThrow('API key is not set');
  });

  it('should throw when OpenAI key is empty', () => {
    expect(() =>
      validateApiKeys({ Keys: { StabilityAI: 'sk-test123', OpenAI: '' } })
    ).toThrow('API key is not set');
  });
});

// ─────────────────────────────────────────────────────────────
// generateImage (mocked orchestrator)
// ─────────────────────────────────────────────────────────────
describe('generateImage (mocked)', () => {
  const metrics = [];

  afterAll(() => {
    console.log('\n📊 generateImage Metrics:');
    metrics.forEach(m => console.log(`   ${m}`));
  });

  beforeEach(() => {
    // Reset moderation mock to not-flagged
    moderateContent.mockResolvedValue({
      flagged: false,
      flaggedCategories: [],
      cleanedText: 'a beautiful landscape',
    });
  });

  const testModels = [
    { model: 'dall-e-3', provider: 'OpenAI DALL-E 3' },
    { model: 'black-forest-labs/flux-schnell', provider: 'Flux Schnell' },
    { model: 'black-forest-labs/flux-2-dev', provider: 'Flux 2 Dev' },
    { model: 'black-forest-labs/flux-2-pro', provider: 'Flux 2 Pro' },
    { model: 'bytedance/seedream-3', provider: 'Seedream 3' },
    { model: 'google/imagen-4-fast', provider: 'Imagen 4 Fast' },
    { model: 'google/imagen-4', provider: 'Imagen 4' },
    { model: 'google/imagen-4-ultra', provider: 'Imagen 4 Ultra' },
    { model: 'bytedance/seedream-4.5', provider: 'Seedream 4.5' },
    { model: 'google/nano-banana-pro', provider: 'NanaBanana Pro' },
    { model: 'black-forest-labs/flux-2-klein-4b', provider: 'Flux 2 Klein 4B' },
    { model: 'black-forest-labs/flux-2-klein-9b-base', provider: 'Flux 2 Klein 9B' },
    { model: 'black-forest-labs/flux-2-max', provider: 'Flux 2 Max' },
    // Note: gpt-image-1 is missing from getDimensions map (codebase bug).
    // Tested separately below.
  ];

  for (const { model, provider } of testModels) {
    it(`should route to ${provider} (${model})`, async () => {
      // gpt-image-1 is not in getDimensions map; it uses its own dimension handling
      const dimensionParam = (model === 'gpt-image-1') ? 'auto' : 'square';
      const { result, durationMs } = await measureTime(() =>
        generateImage({
          userInput: 'a beautiful landscape',
          imageModel: model,
          dimensions: dimensionParam,
          numberOfImages: 1,
          userID: 'test-user-123',
        })
      );
      metrics.push(formatMetrics(`${provider}`, durationMs));

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(Buffer.isBuffer(result[0])).toBe(true);
    });
  }

  it('should throw for unsupported model', async () => {
    await expect(
      generateImage({
        userInput: 'test',
        imageModel: 'nonexistent-model',
        dimensions: 'square',
        numberOfImages: 1,
        userID: 'test-user',
      })
    ).rejects.toThrow('Unsupported image model');
  });

  it('should detect gpt-image-1 is missing from getDimensions map (known bug)', async () => {
    // gpt-image-1 has a switch case in generateImage but is not in getDimensions map
    // This test documents this issue for future fixing
    await expect(
      generateImage({
        userInput: 'test',
        imageModel: 'gpt-image-1',
        dimensions: 'square',
        numberOfImages: 1,
        userID: 'test-user',
      })
    ).rejects.toThrow('Unsupported image model');
  });

  it('should throw when moderation flags content', async () => {
    moderateContent.mockResolvedValueOnce({
      flagged: true,
      flaggedCategories: ['flagged_category_b'],
      cleanedText: '',
    });

    await expect(
      generateImage({
        userInput: 'flagged content',
        imageModel: 'dall-e-3',
        dimensions: 'square',
        numberOfImages: 1,
        userID: 'test-user',
      })
    ).rejects.toThrow('flagged by the moderation system');
  });
});

// ─────────────────────────────────────────────────────────────
// generateImageToImage (mocked)
// ─────────────────────────────────────────────────────────────
describe('generateImageToImage (mocked)', () => {
  beforeEach(() => {
    moderateContent.mockResolvedValue({
      flagged: false,
      flaggedCategories: [],
      cleanedText: 'transform this image',
    });
  });

  const testModels = [
    'black-forest-labs/flux-2-dev',
    'black-forest-labs/flux-2-pro',
    'bytedance/seedream-4.5',
    'google/nano-banana-pro',
  ];

  for (const model of testModels) {
    it(`should route image-to-image via ${model}`, async () => {
      const { result, durationMs } = await measureTime(() =>
        generateImageToImage({
          images: ['https://example.com/image.png'],
          userInput: 'transform this image',
          Image2Image_Model: model,
          strength: 0.7,
          userID: 'test-user-123',
        })
      );
      console.log(`📊 generateImageToImage ${model}: ${durationMs}ms`);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });
  }
});

// ─────────────────────────────────────────────────────────────
// generateImageEdit (mocked)
// ─────────────────────────────────────────────────────────────
describe('generateImageEdit (mocked)', () => {
  beforeEach(() => {
    moderateContent.mockResolvedValue({
      flagged: false,
      flaggedCategories: [],
      cleanedText: 'make the sky blue',
    });
  });

  const testModels = [
    'black-forest-labs/flux-kontext-pro',
    'black-forest-labs/flux-kontext-dev',
    'black-forest-labs/flux-2-dev',
    'black-forest-labs/flux-2-pro',
    'bytedance/seedream-4.5',
    'google/nano-banana-pro',
  ];

  for (const model of testModels) {
    it(`should route image edit via ${model}`, async () => {
      const { result, durationMs } = await measureTime(() =>
        generateImageEdit({
          images: ['https://example.com/image.png'],
          instructions: 'make the sky blue',
          ImageEdit_Model: model,
          userID: 'test-user-123',
        })
      );
      console.log(`📊 generateImageEdit ${model}: ${durationMs}ms`);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });
  }
});

// ─────────────────────────────────────────────────────────────
// upscaleImage (mocked)
// ─────────────────────────────────────────────────────────────
describe('upscaleImage (mocked)', () => {
  beforeEach(() => {
    moderateContent.mockResolvedValue({
      flagged: false,
      flaggedCategories: [],
      cleanedText: '',
    });
  });

  it('should upscale an image via ESRGAN', async () => {
    const mockBuffer = Buffer.from('small-image');
    const { result, durationMs } = await measureTime(() =>
      upscaleImage(mockBuffer, 'nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa')
    );
    console.log(`📊 upscaleImage ESRGAN: ${durationMs}ms`);

    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('should throw for unsupported upscale model', async () => {
    await expect(
      upscaleImage(Buffer.from('test'), 'unknown-model')
    ).rejects.toThrow('Unsupported upscale model');
  });
});

// ─────────────────────────────────────────────────────────────
// promptOptimizer (mocked)
// ─────────────────────────────────────────────────────────────
describe('promptOptimizer (mocked)', () => {
  beforeEach(() => {
    moderateContent.mockResolvedValue({
      flagged: false,
      flaggedCategories: [],
      cleanedText: 'a cat sitting on a fence',
    });
    mockOpenAI.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: 'An enhanced, detailed prompt of a cat sitting' } }],
    });
  });

  it('should optimize a prompt via OpenAI', async () => {
    const { result, durationMs } = await measureTime(() =>
      promptOptimizer('a cat sitting', 'user-123')
    );
    console.log(`📊 promptOptimizer: ${durationMs}ms, resultLength=${result.length}`);

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(mockOpenAI.chat.completions.create).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// adaptImagePrompt (mocked)
// ─────────────────────────────────────────────────────────────
describe('adaptImagePrompt (mocked)', () => {
  beforeEach(() => {
    // moderateContent should pass through the input text as cleanedText
    moderateContent.mockImplementation(async ({ text }) => ({
      flagged: false,
      flaggedCategories: [],
      cleanedText: text || '',
    }));
    mockOpenAI.chat.completions.create.mockResolvedValue({
      choices: [{
        message: {
          content: '<PROMPT>A vibrant colorful landscape with enhanced colors</PROMPT>',
        },
      }],
    });
  });

  it('should adapt a prompt based on refinement request', async () => {
    const { result, durationMs } = await measureTime(() =>
      adaptImagePrompt('a landscape', 'make it more colorful', 'user-123')
    );
    console.log(`📊 adaptImagePrompt: ${durationMs}ms, resultLength=${result.length}`);

    expect(typeof result).toBe('string');
    expect(result).toContain('vibrant');
    expect(mockOpenAI.chat.completions.create).toHaveBeenCalled();
  });

  it('should throw when <PROMPT> markers are missing', async () => {
    moderateContent.mockImplementation(async ({ text }) => ({
      flagged: false,
      flaggedCategories: [],
      cleanedText: text || '',
    }));
    mockOpenAI.chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: 'Just a plain response without markers' } }],
    });

    await expect(
      adaptImagePrompt('test', 'refine this', 'user-123')
    ).rejects.toThrow('Failed to extract refined prompt');
  });
});

// ─────────────────────────────────────────────────────────────
// LIVE API TESTS
// ─────────────────────────────────────────────────────────────
liveDescribe('image_functions (LIVE API)', () => {
  const metrics = [];
  let liveImageFunctions;

  beforeAll(() => {
    jest.unmock('openai');
    jest.unmock('../functions/moderation.js');
    jest.resetModules();
    liveImageFunctions = require('../functions/image_functions');
  });

  afterAll(() => {
    console.log('\n🔴 LIVE API - image_functions Metrics:');
    metrics.forEach(m => console.log(`   ${m}`));
  });

  it('should optimize a prompt via real OpenAI API', async () => {
    const { result, durationMs } = await measureTime(() =>
      liveImageFunctions.promptOptimizer('a simple cat photo', 'test-user')
    );
    metrics.push(formatMetrics('promptOptimizer', durationMs, { resultLength: result.length }));
    console.log(`🔴 LIVE promptOptimizer: ${durationMs}ms`);
    console.log(`   Result: "${result.substring(0, 150)}..."`);

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(10);
  });

  it('should adapt a prompt via real OpenAI API', async () => {
    const { result, durationMs } = await measureTime(() =>
      liveImageFunctions.adaptImagePrompt(
        'a sunset over mountains',
        'make it more dramatic and cinematic',
        'test-user'
      )
    );
    metrics.push(formatMetrics('adaptImagePrompt', durationMs, { resultLength: result.length }));
    console.log(`🔴 LIVE adaptImagePrompt: ${durationMs}ms`);
    console.log(`   Result: "${result.substring(0, 150)}..."`);

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(10);
  });
});

liveDescribe('generateImage (LIVE API)', () => {
  const metrics = [];
  let liveImageFunctions;

  beforeAll(() => {
    jest.unmock('openai');
    jest.unmock('../functions/moderation.js');
    // Unmock all image providers for real generation
    [
      '../functions/image_providers/OpenAI.js',
      '../functions/image_providers/StabilityXL.js',
      '../functions/image_providers/SD3.js',
      '../functions/image_providers/FluxSchnell.js',
      '../functions/image_providers/FluxDev.js',
      '../functions/image_providers/Flux2Dev.js',
      '../functions/image_providers/Flux2Pro.js',
      '../functions/image_providers/Flux2Klein4b.js',
      '../functions/image_providers/Flux2Klein9bBase.js',
      '../functions/image_providers/Flux2Max.js',
      '../functions/image_providers/ReplicateESRGAN.js',
      '../functions/image_providers/FluxKontextPro.js',
      '../functions/image_providers/FluxKontextDev.js',
      '../functions/image_providers/Seedream3.js',
      '../functions/image_providers/Seedream45.js',
      '../functions/image_providers/Imagen4Fast.js',
      '../functions/image_providers/Imagen4.js',
      '../functions/image_providers/Imagen4Ultra.js',
      '../functions/image_providers/NanaBananaPro.js',
    ].forEach(p => jest.unmock(p));
    jest.resetModules();
    liveImageFunctions = require('../functions/image_functions');
  });

  afterAll(() => {
    console.log('\n🔴 LIVE API - generateImage Metrics:');
    metrics.forEach(m => console.log(`   ${m}`));
  });

  // Live test: generate via Flux Schnell (fastest/cheapest model)
  it('should generate a real image via Flux Schnell', async () => {
    const { result, durationMs } = await measureTime(() =>
      liveImageFunctions.generateImage({
        userInput: 'a simple red circle on a white background',
        imageModel: 'black-forest-labs/flux-schnell',
        dimensions: 'square',
        numberOfImages: 1,
        userID: 'live-test-user',
      })
    );
    metrics.push(formatMetrics('Flux Schnell', durationMs, { bufferSize: result[0]?.length }));
    console.log(`🔴 LIVE generateImage Flux Schnell: ${durationMs}ms, buffer=${result[0]?.length} bytes`);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(Buffer.isBuffer(result[0])).toBe(true);
    // A real image should be at least a few KB
    expect(result[0].length).toBeGreaterThan(1000);
  }, 120000);

  // Live test: generate via Flux 2 Dev
  it('should generate a real image via Flux 2 Dev', async () => {
    const { result, durationMs } = await measureTime(() =>
      liveImageFunctions.generateImage({
        userInput: 'a beautiful mountain landscape at sunset',
        imageModel: 'black-forest-labs/flux-2-dev',
        dimensions: 'wide',
        numberOfImages: 1,
        userID: 'live-test-user',
      })
    );
    metrics.push(formatMetrics('Flux 2 Dev', durationMs, { bufferSize: result[0]?.length }));
    console.log(`🔴 LIVE generateImage Flux 2 Dev: ${durationMs}ms, buffer=${result[0]?.length} bytes`);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(Buffer.isBuffer(result[0])).toBe(true);
    expect(result[0].length).toBeGreaterThan(1000);
  }, 120000);

  // Live test: generate via Imagen 4 Fast
  it('should generate a real image via Imagen 4 Fast', async () => {
    const { result, durationMs } = await measureTime(() =>
      liveImageFunctions.generateImage({
        userInput: 'a cat sitting on a windowsill',
        imageModel: 'google/imagen-4-fast',
        dimensions: 'square',
        numberOfImages: 1,
        userID: 'live-test-user',
      })
    );
    metrics.push(formatMetrics('Imagen 4 Fast', durationMs, { bufferSize: result[0]?.length }));
    console.log(`🔴 LIVE generateImage Imagen 4 Fast: ${durationMs}ms, buffer=${result[0]?.length} bytes`);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(Buffer.isBuffer(result[0])).toBe(true);
    expect(result[0].length).toBeGreaterThan(1000);
  }, 120000);

  // Live test: prompt optimization then generation round-trip
  it('should optimize prompt then generate an image (round-trip)', async () => {
    const { result: optimizedPrompt, durationMs: optimizeDuration } = await measureTime(() =>
      liveImageFunctions.promptOptimizer('a dog playing fetch', 'live-test-user')
    );
    metrics.push(formatMetrics('round-trip: optimize', optimizeDuration, { promptLength: optimizedPrompt.length }));
    console.log(`🔴 LIVE round-trip optimize: ${optimizeDuration}ms, prompt="${optimizedPrompt.substring(0, 100)}..."`);

    expect(typeof optimizedPrompt).toBe('string');
    expect(optimizedPrompt.length).toBeGreaterThan(10);

    const { result: imageBuffers, durationMs: genDuration } = await measureTime(() =>
      liveImageFunctions.generateImage({
        userInput: optimizedPrompt,
        imageModel: 'black-forest-labs/flux-schnell',
        dimensions: 'square',
        numberOfImages: 1,
        userID: 'live-test-user',
      })
    );
    metrics.push(formatMetrics('round-trip: generate', genDuration, { bufferSize: imageBuffers[0]?.length }));
    console.log(`🔴 LIVE round-trip generate: ${genDuration}ms, buffer=${imageBuffers[0]?.length} bytes`);

    expect(Array.isArray(imageBuffers)).toBe(true);
    expect(Buffer.isBuffer(imageBuffers[0])).toBe(true);
    expect(imageBuffers[0].length).toBeGreaterThan(1000);
  }, 180000);
});
