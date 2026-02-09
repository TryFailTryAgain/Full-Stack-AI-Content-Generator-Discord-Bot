/**
 * Tests for functions/image_providers/*.js
 *
 * These tests verify that each image provider constructs valid API requests
 * by mocking the external APIs (Replicate, Stability AI, OpenAI) at a low
 * level while letting the actual provider functions execute.
 *
 * This catches issues like:
 *  - Wrong API parameters / missing fields
 *  - Incorrect model identifiers passed to Replicate
 *  - Broken image processing pipelines (sharp / fetch)
 *  - Missing environment variable usage
 */

const path = require('path');
require(path.resolve(__dirname, '..', 'tests', 'setup.js'));

const { measureTime, formatMetrics } = require('./utils/testHelpers');

// ─── Shared mock infrastructure ──────────────────────────────

// A minimal valid PNG (1x1 transparent pixel) for sharp to process
// Prefix with `mock` so jest.mock() factories can reference it
const mockValidPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64'
);

// Track all replicate.run calls across tests
const replicateRunCalls = [];
const mockReplicateRun = jest.fn().mockImplementation(async (model, opts) => {
  replicateRunCalls.push({ model, input: opts.input });
  // Return a mock URL that fetch will intercept
  return 'https://mock-replicate.test/output.png';
});

// Mock Replicate constructor
jest.mock('replicate', () => {
  return jest.fn().mockImplementation(() => ({
    run: mockReplicateRun,
  }));
});

// Mock global fetch to return a valid PNG
const mockFetchResponse = {
  arrayBuffer: jest.fn().mockResolvedValue(mockValidPng.buffer.slice(
    mockValidPng.byteOffset,
    mockValidPng.byteOffset + mockValidPng.byteLength
  )),
  ok: true,
  status: 200,
  json: jest.fn().mockResolvedValue({}),
  text: jest.fn().mockResolvedValue(''),
};
global.fetch = jest.fn().mockResolvedValue(mockFetchResponse);

// Mock sharp to pass through buffers without real image processing
const mockSharpInstance = {
  png: jest.fn().mockReturnThis(),
  jpeg: jest.fn().mockReturnThis(),
  webp: jest.fn().mockReturnThis(),
  toBuffer: jest.fn().mockResolvedValue(mockValidPng),
};
jest.mock('sharp', () => {
  return jest.fn().mockImplementation(() => mockSharpInstance);
});

// Mock axios for Stability AI providers
const mockAxiosResponse = {
  status: 200,
  data: mockValidPng,
};
jest.mock('axios', () => ({
  postForm: jest.fn().mockResolvedValue(mockAxiosResponse),
  toFormData: jest.fn().mockReturnValue({}),
  post: jest.fn().mockResolvedValue(mockAxiosResponse),
  get: jest.fn().mockResolvedValue({ data: mockValidPng }),
}));

// Mock helperFunctions to avoid disk I/O
jest.mock('../functions/helperFunctions.js', () => ({
  checkThenSave_ReturnSendImage: jest.fn().mockImplementation(async (buf) => buf),
  generateHashedUserId: jest.fn().mockResolvedValue('hashed-test-user'),
  saveToDiskCheck: jest.fn().mockResolvedValue(false),
  generateRandomHex: jest.fn().mockReturnValue('deadbeef'),
}));

// Mock OpenAI for the OpenAI provider
const mockOpenAIImages = {
  generate: jest.fn().mockResolvedValue({
    data: [{ b64_json: mockValidPng.toString('base64') }],
  }),
};
jest.mock('openai', () => {
  const MockOpenAI = jest.fn().mockImplementation(() => ({
    images: mockOpenAIImages,
    set baseURL(url) { /* no-op */ },
    get baseURL() { return 'https://api.openai.com/v1'; },
  }));
  MockOpenAI.OpenAI = MockOpenAI;
  return MockOpenAI;
});

// ─── Require providers after mocks ───────────────────────────

const { generateImageViaDallE3, generateImageViaGPTImageGen1 } = require('../functions/image_providers/OpenAI.js');
const { generateImageViaSD3, generateImageToImageViaStabilityAISD3 } = require('../functions/image_providers/SD3.js');
const { generateImageViaStabilityAIv1 } = require('../functions/image_providers/StabilityXL.js');
const { generateImageViaReplicate_FluxSchnell } = require('../functions/image_providers/FluxSchnell.js');
const { generateImageViaReplicate_FluxDev } = require('../functions/image_providers/FluxDev.js');
const { generateImageViaReplicate_Flux2Dev, generateImageToImageViaReplicate_Flux2Dev, generateImageEditViaReplicate_Flux2Dev } = require('../functions/image_providers/Flux2Dev.js');
const { generateImageViaReplicate_Flux2Pro, generateImageToImageViaReplicate_Flux2Pro, generateImageEditViaReplicate_Flux2Pro } = require('../functions/image_providers/Flux2Pro.js');
const { generateImageViaReplicate_Flux2Klein4b } = require('../functions/image_providers/Flux2Klein4b.js');
const { generateImageViaReplicate_Flux2Klein9bBase } = require('../functions/image_providers/Flux2Klein9bBase.js');
const { generateImageViaReplicate_Flux2Max } = require('../functions/image_providers/Flux2Max.js');
const { upscaleImageViaReplicate_esrgan } = require('../functions/image_providers/ReplicateESRGAN.js');
const { generateImageEditViaReplicate_FluxKontextPro } = require('../functions/image_providers/FluxKontextPro.js');
const { generateImageEditViaReplicate_FluxKontextDev } = require('../functions/image_providers/FluxKontextDev.js');
const { generateImageViaReplicate_Seedream3 } = require('../functions/image_providers/Seedream3.js');
const { generateImageViaReplicate_Seedream45, generateImageToImageViaReplicate_Seedream45, generateImageEditViaReplicate_Seedream45 } = require('../functions/image_providers/Seedream45.js');
const { generateImageViaReplicate_Imagen4Fast } = require('../functions/image_providers/Imagen4Fast.js');
const { generateImageViaReplicate_Imagen4 } = require('../functions/image_providers/Imagen4.js');
const { generateImageViaReplicate_Imagen4Ultra } = require('../functions/image_providers/Imagen4Ultra.js');
const { generateImageViaReplicate_NanaBananaPro, generateImageToImageViaReplicate_NanaBananaPro, generateImageEditViaReplicate_NanaBananaPro } = require('../functions/image_providers/NanaBananaPro.js');

const axios = require('axios');

// ─────────────────────────────────────────────────────────────
// Test suites
// ─────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  replicateRunCalls.length = 0;

  // Re-setup mockReplicateRun implementation (clearAllMocks wipes it)
  mockReplicateRun.mockImplementation(async (model, opts) => {
    replicateRunCalls.push({ model, input: opts.input });
    return 'https://mock-replicate.test/output.png';
  });

  // Re-setup default mock responses after clearAllMocks
  mockFetchResponse.arrayBuffer.mockResolvedValue(
    mockValidPng.buffer.slice(mockValidPng.byteOffset, mockValidPng.byteOffset + mockValidPng.byteLength)
  );
  mockSharpInstance.png.mockReturnThis();
  mockSharpInstance.jpeg.mockReturnThis();
  mockSharpInstance.webp.mockReturnThis();
  mockSharpInstance.toBuffer.mockResolvedValue(mockValidPng);
  global.fetch.mockResolvedValue(mockFetchResponse);

  // OpenAI.js uses checkThenSave_ReturnSendImage as an implicit global
  global.checkThenSave_ReturnSendImage = jest.fn().mockImplementation(async (buf) => buf);
  // Reset OpenAI images mock
  mockOpenAIImages.generate.mockResolvedValue({
    data: [{ b64_json: mockValidPng.toString('base64') }],
  });
});

// ─────────────────────────────────────────────────────────────
// Replicate-based providers
// ─────────────────────────────────────────────────────────────
describe('Replicate-based Image Providers', () => {
  const metrics = [];

  afterAll(() => {
    console.log('\n--- Image Provider Integration Metrics ---');
    metrics.forEach(m => console.log(`   ${m}`));
  });

  // --- Flux Schnell ---
  describe('FluxSchnell', () => {
    it('should call replicate.run with correct model and input params', async () => {
      const { durationMs } = await measureTime(() =>
        generateImageViaReplicate_FluxSchnell({
          userInput: 'a red fox',
          imageModel: 'black-forest-labs/flux-schnell',
          numberOfImages: 1,
          trueDimensions: '1:1',
          output_format: 'png',
          output_quality: 100,
          disable_safety_checker: false,
        })
      );
      metrics.push(formatMetrics('FluxSchnell', durationMs));

      expect(mockReplicateRun).toHaveBeenCalledTimes(1);
      const call = replicateRunCalls[0];
      expect(call.model).toBe('black-forest-labs/flux-schnell');
      expect(call.input.prompt).toBe('a red fox');
      expect(call.input.aspect_ratio).toBe('1:1');
      expect(call.input.output_format).toBe('png');
      expect(call.input.num_outputs).toBe(1);
    });
  });

  // --- Flux Dev ---
  describe('FluxDev', () => {
    it('should call replicate.run with correct model and seed', async () => {
      const { durationMs } = await measureTime(() =>
        generateImageViaReplicate_FluxDev({
          userInput: 'a blue whale',
          imageModel: 'black-forest-labs/flux-dev',
          numberOfImages: 1,
          trueDimensions: '16:9',
          output_format: 'png',
          output_quality: 100,
          disable_safety_checker: true,
          seed: 42,
        })
      );
      metrics.push(formatMetrics('FluxDev', durationMs));

      expect(mockReplicateRun).toHaveBeenCalledTimes(1);
      const call = replicateRunCalls[0];
      expect(call.model).toBe('black-forest-labs/flux-dev');
      expect(call.input.prompt).toBe('a blue whale');
      expect(call.input.seed).toBe(42);
      expect(call.input.disable_safety_checker).toBe(true);
    });
  });

  // --- Flux 2 Dev ---
  describe('Flux2Dev', () => {
    it('should pass go_fast and correct aspect ratio for text-to-image', async () => {
      const result = await generateImageViaReplicate_Flux2Dev({
        userInput: 'sunset over ocean',
        imageModel: 'black-forest-labs/flux-2-dev',
        numberOfImages: 1,
        trueDimensions: '9:16',
        output_format: 'png',
        output_quality: 100,
        disable_safety_checker: false,
        seed: 123,
        go_fast: true,
      });

      expect(mockReplicateRun).toHaveBeenCalledTimes(1);
      const call = replicateRunCalls[0];
      expect(call.model).toBe('black-forest-labs/flux-2-dev');
      expect(call.input.aspect_ratio).toBe('9:16');
      expect(call.input.go_fast).toBe(true);
      expect(call.input.seed).toBe(123);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
    });

    it('should handle custom dimensions with width/height', async () => {
      await generateImageViaReplicate_Flux2Dev({
        userInput: 'custom size test',
        imageModel: 'black-forest-labs/flux-2-dev',
        numberOfImages: 1,
        trueDimensions: 'custom',
        output_format: 'png',
        output_quality: 100,
        disable_safety_checker: false,
        go_fast: true,
        width: 800,
        height: 600,
      });

      const call = replicateRunCalls[0];
      expect(call.input.aspect_ratio).toBe('custom');
      expect(call.input.width).toBe(800);
      expect(call.input.height).toBe(600);
    });

    it('should pass input_images for image-to-image', async () => {
      await generateImageToImageViaReplicate_Flux2Dev({
        images: ['https://example.com/img1.png', 'https://example.com/img2.png'],
        userInput: 'transform these',
        strength: 0.7,
        disable_safety_checker: false,
        go_fast: true,
        output_format: 'jpg',
        output_quality: 80,
      });

      expect(mockReplicateRun).toHaveBeenCalledTimes(1);
      const call = replicateRunCalls[0];
      expect(call.model).toBe('black-forest-labs/flux-2-dev');
      expect(call.input.input_images).toEqual(['https://example.com/img1.png', 'https://example.com/img2.png']);
      expect(call.input.prompt).toBe('transform these');
    });

    it('should pass input_images for image-edit', async () => {
      await generateImageEditViaReplicate_Flux2Dev({
        images: ['https://example.com/img.png'],
        userInput: 'change the sky',
        aspect_ratio: 'match_input_image',
        go_fast: true,
        output_format: 'png',
        output_quality: 100,
        disable_safety_checker: false,
      });

      const call = replicateRunCalls[0];
      expect(call.model).toBe('black-forest-labs/flux-2-dev');
      expect(call.input.input_images).toEqual(['https://example.com/img.png']);
      expect(call.input.prompt).toBe('change the sky');
    });

    it('should generate multiple images by running replicate.run multiple times', async () => {
      const result = await generateImageViaReplicate_Flux2Dev({
        userInput: 'multi image test',
        imageModel: 'black-forest-labs/flux-2-dev',
        numberOfImages: 3,
        trueDimensions: '1:1',
        output_format: 'png',
        output_quality: 100,
        disable_safety_checker: false,
        go_fast: true,
      });

      expect(mockReplicateRun).toHaveBeenCalledTimes(3);
      expect(result.length).toBe(3);
    });
  });

  // --- Flux 2 Pro ---
  describe('Flux2Pro', () => {
    it('should include safety_tolerance and resolution params', async () => {
      await generateImageViaReplicate_Flux2Pro({
        userInput: 'mountain landscape',
        imageModel: 'black-forest-labs/flux-2-pro',
        numberOfImages: 1,
        trueDimensions: '1:1',
        output_format: 'png',
        output_quality: 100,
        seed: 999,
        resolution: '1 MP',
        safety_tolerance: 2,
      });

      const call = replicateRunCalls[0];
      expect(call.model).toBe('black-forest-labs/flux-2-pro');
      expect(call.input.safety_tolerance).toBe(2);
      expect(call.input.resolution).toBe('1 MP');
    });
  });

  // --- Flux 2 Klein variants ---
  describe('Flux2Klein4b', () => {
    it('should call correct model with go_fast disabled', async () => {
      await generateImageViaReplicate_Flux2Klein4b({
        userInput: 'abstract art',
        imageModel: 'black-forest-labs/flux-2-klein-4b',
        numberOfImages: 1,
        trueDimensions: '1:1',
        output_format: 'png',
        output_quality: 100,
        disable_safety_checker: false,
        seed: null,
        go_fast: false,
      });

      const call = replicateRunCalls[0];
      expect(call.model).toBe('black-forest-labs/flux-2-klein-4b');
      expect(call.input.go_fast).toBe(false);
    });
  });

  describe('Flux2Klein9bBase', () => {
    it('should include guidance parameter', async () => {
      await generateImageViaReplicate_Flux2Klein9bBase({
        userInput: 'neon city',
        imageModel: 'black-forest-labs/flux-2-klein-9b-base',
        numberOfImages: 1,
        trueDimensions: '16:9',
        output_format: 'png',
        output_quality: 100,
        disable_safety_checker: false,
        seed: null,
        go_fast: true,
        guidance: 4,
      });

      const call = replicateRunCalls[0];
      expect(call.model).toBe('black-forest-labs/flux-2-klein-9b-base');
      expect(call.input.guidance).toBe(4);
      expect(call.input.go_fast).toBe(true);
    });
  });

  describe('Flux2Max', () => {
    it('should call correct model with optional resolution', async () => {
      await generateImageViaReplicate_Flux2Max({
        userInput: 'ocean waves',
        imageModel: 'black-forest-labs/flux-2-max',
        numberOfImages: 1,
        trueDimensions: '1:1',
        output_format: 'png',
        output_quality: 100,
        seed: 50,
      });

      const call = replicateRunCalls[0];
      expect(call.model).toBe('black-forest-labs/flux-2-max');
      expect(call.input.seed).toBe(50);
    });
  });

  // --- Flux Kontext ---
  describe('FluxKontextPro', () => {
    it('should pass input_image and optional params for image-edit', async () => {
      await generateImageEditViaReplicate_FluxKontextPro({
        image: 'https://example.com/photo.png',
        userInput: 'add sunglasses',
        aspect_ratio: '1:1',
        seed: 77,
        output_format: 'png',
        safety_tolerance: 3,
      });

      const call = replicateRunCalls[0];
      expect(call.model).toBe('black-forest-labs/flux-kontext-pro');
      expect(call.input.input_image).toBe('https://example.com/photo.png');
      expect(call.input.prompt).toBe('add sunglasses');
      expect(call.input.seed).toBe(77);
      expect(call.input.safety_tolerance).toBe(3);
    });
  });

  describe('FluxKontextDev', () => {
    it('should pass input_image and disable_safety_checker', async () => {
      await generateImageEditViaReplicate_FluxKontextDev({
        image: 'https://example.com/pic.png',
        userInput: 'change hair color',
        aspect_ratio: 'match_input_image',
        disable_safety_checker: true,
        go_fast: false,
      });

      const call = replicateRunCalls[0];
      expect(call.model).toBe('black-forest-labs/flux-kontext-dev');
      expect(call.input.input_image).toBe('https://example.com/pic.png');
      expect(call.input.disable_safety_checker).toBe(true);
      expect(call.input.go_fast).toBe(false);
    });
  });

  // --- Seedream ---
  describe('Seedream3', () => {
    it('should call replicate with correct model and aspect_ratio', async () => {
      await generateImageViaReplicate_Seedream3({
        userInput: 'futuristic city',
        seed: 42,
        aspect_ratio: '1:1',
      });

      const call = replicateRunCalls[0];
      expect(call.model).toBe('bytedance/seedream-3');
      expect(call.input.prompt).toBe('futuristic city');
      expect(call.input.aspect_ratio).toBe('1:1');
    });
  });

  describe('Seedream45', () => {
    it('should include size and sequential_image_generation for text-to-image', async () => {
      await generateImageViaReplicate_Seedream45({
        userInput: 'dragon in flight',
        aspect_ratio: '16:9',
        size: '2K',
        sequential_image_generation: 'disabled',
      });

      const call = replicateRunCalls[0];
      expect(call.model).toBe('bytedance/seedream-4.5');
      expect(call.input.size).toBe('2K');
      expect(call.input.sequential_image_generation).toBe('disabled');
    });

    it('should pass image_input for image-to-image', async () => {
      await generateImageToImageViaReplicate_Seedream45({
        images: ['https://example.com/ref.png'],
        userInput: 'make it darker',
        size: '2K',
      });

      const call = replicateRunCalls[0];
      expect(call.model).toBe('bytedance/seedream-4.5');
      expect(call.input.image_input).toEqual(['https://example.com/ref.png']);
    });

    it('should pass image_input for image-edit', async () => {
      await generateImageEditViaReplicate_Seedream45({
        images: ['https://example.com/edit.png'],
        userInput: 'add a hat',
        size: '2K',
        aspect_ratio: 'match_input_image',
      });

      const call = replicateRunCalls[0];
      expect(call.input.image_input).toEqual(['https://example.com/edit.png']);
      expect(call.input.prompt).toBe('add a hat');
    });
  });

  // --- Imagen ---
  describe('Imagen4Fast', () => {
    it('should call replicate with google/imagen-4-fast', async () => {
      const result = await generateImageViaReplicate_Imagen4Fast({
        userInput: 'a cat sitting',
        aspect_ratio: '1:1',
      });

      const call = replicateRunCalls[0];
      expect(call.model).toBe('google/imagen-4-fast');
      expect(call.input.prompt).toBe('a cat sitting');
      expect(Array.isArray(result)).toBe(true);
    });

    it('should pass optional safety_filter_level', async () => {
      await generateImageViaReplicate_Imagen4Fast({
        userInput: 'test',
        safety_filter_level: 'block_medium_and_above',
      });

      const call = replicateRunCalls[0];
      expect(call.input.safety_filter_level).toBe('block_medium_and_above');
    });
  });

  describe('Imagen4', () => {
    it('should call replicate with google/imagen-4', async () => {
      await generateImageViaReplicate_Imagen4({
        userInput: 'a dog playing catch',
        aspect_ratio: '9:16',
      });

      const call = replicateRunCalls[0];
      expect(call.model).toBe('google/imagen-4');
      expect(call.input.aspect_ratio).toBe('9:16');
    });
  });

  describe('Imagen4Ultra', () => {
    it('should call replicate with google/imagen-4-ultra', async () => {
      await generateImageViaReplicate_Imagen4Ultra({
        userInput: 'hyperrealistic landscape',
        aspect_ratio: '16:9',
      });

      const call = replicateRunCalls[0];
      expect(call.model).toBe('google/imagen-4-ultra');
    });
  });

  // --- NanaBananaPro ---
  describe('NanaBananaPro', () => {
    it('should include resolution and safety_filter_level for text-to-image', async () => {
      await generateImageViaReplicate_NanaBananaPro({
        userInput: 'watercolor painting',
        aspect_ratio: '1:1',
        resolution: '2K',
        output_format: 'png',
        safety_filter_level: 'block_only_high',
      });

      const call = replicateRunCalls[0];
      expect(call.model).toBe('google/nano-banana-pro');
      expect(call.input.resolution).toBe('2K');
      expect(call.input.safety_filter_level).toBe('block_only_high');
    });

    it('should handle image-to-image with multiple images', async () => {
      await generateImageToImageViaReplicate_NanaBananaPro({
        images: ['https://example.com/a.png', 'https://example.com/b.png'],
        userInput: 'blend these',
        resolution: '1K',
        output_format: 'png',
      });

      const call = replicateRunCalls[0];
      expect(call.model).toBe('google/nano-banana-pro');
      expect(call.input.image_input).toEqual(['https://example.com/a.png', 'https://example.com/b.png']);
    });

    it('should handle image-edit', async () => {
      await generateImageEditViaReplicate_NanaBananaPro({
        images: ['https://example.com/c.png'],
        userInput: 'remove background',
        resolution: '1K',
        output_format: 'png',
      });

      const call = replicateRunCalls[0];
      expect(call.input.prompt).toBe('remove background');
    });
  });

  // --- ESRGAN Upscaler ---
  describe('ReplicateESRGAN', () => {
    it('should convert image to data URI and call replicate with correct model', async () => {
      const result = await upscaleImageViaReplicate_esrgan({
        imageBuffer: mockValidPng,
        scaleFactor: 4,
        face_enhance: true,
      });

      expect(mockReplicateRun).toHaveBeenCalledTimes(1);
      const call = replicateRunCalls[0];
      expect(call.model).toBe('nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa');
      expect(call.input.scale).toBe(4);
      expect(call.input.face_enhance).toBe(true);
      expect(call.input.image).toMatch(/^data:image\/png;base64,/);
      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it('should default to scale=2 and face_enhance=false', async () => {
      await upscaleImageViaReplicate_esrgan({
        imageBuffer: mockValidPng,
      });

      const call = replicateRunCalls[0];
      expect(call.input.scale).toBe(2);
      expect(call.input.face_enhance).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Stability AI providers (axios-based)
// ─────────────────────────────────────────────────────────────
describe('Stability AI Image Providers', () => {

  describe('SD3', () => {
    it('should POST to stability API with correct form payload', async () => {
      axios.postForm.mockResolvedValue({ status: 200, data: mockValidPng });

      await generateImageViaSD3({
        userInput: 'a galaxy',
        negativePrompt: 'blurry',
        trueDimensions: '1:1',
        imageModel: 'sd3.5-large',
        numberOfImages: 1,
      });

      expect(axios.postForm).toHaveBeenCalledTimes(1);
      const [url, , config] = axios.postForm.mock.calls[0];
      expect(url).toBe('https://api.stability.ai/v2beta/stable-image/generate/sd3');
      expect(config.headers.Authorization).toBe(process.env.API_KEY_STABILITYAI);
    });

    it('should throw on non-200 response', async () => {
      axios.postForm.mockResolvedValueOnce({
        status: 400,
        data: Buffer.from('Bad Request'),
      });

      await expect(
        generateImageViaSD3({
          userInput: 'test',
          negativePrompt: '',
          trueDimensions: '1:1',
          imageModel: 'sd3.5-large',
          numberOfImages: 1,
        })
      ).rejects.toThrow('400');
    });

    it('should handle image-to-image with URL input', async () => {
      axios.get.mockResolvedValue({ data: mockValidPng });
      axios.post.mockResolvedValue({ status: 200, data: mockValidPng });

      await generateImageToImageViaStabilityAISD3({
        userInput: 'enhance this',
        negativePrompt: '',
        imageModel: 'sd3.5-large',
        strength: 0.6,
        image: 'https://example.com/test.png',
        numberOfImages: 1,
      });

      expect(axios.get).toHaveBeenCalledWith('https://example.com/test.png', { responseType: 'arraybuffer' });
      expect(axios.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('StabilityXL v1', () => {
    it('should POST to v1 generation API with correct body', async () => {
      // Mock fetch for StabilityXL (uses fetch, not axios)
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          artifacts: [{ base64: mockValidPng.toString('base64') }],
        }),
      });

      await generateImageViaStabilityAIv1({
        userInput: 'a cat',
        negativePrompt: 'blurry',
        trueDimensions: '512x512',
        imageModel: 'stable-diffusion-v1-6',
        numberOfImages: 1,
        cfg: 7,
        steps: 30,
        seed: 42,
        userID: 'hashed-user',
      });

      expect(global.fetch).toHaveBeenCalled();
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toContain('api.stability.ai/v1/generation/stable-diffusion-v1-6/text-to-image');
      const body = JSON.parse(options.body);
      expect(body.text_prompts[0].text).toBe('a cat');
      expect(body.cfg_scale).toBe(7);
      expect(body.width).toBe(512);
      expect(body.height).toBe(512);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// OpenAI providers
// ─────────────────────────────────────────────────────────────
describe('OpenAI Image Providers', () => {

  describe('DALL-E 3', () => {
    it('should call openai.images.generate with correct params', async () => {
      const result = await generateImageViaDallE3({
        userInput: 'a sunset painting',
        trueDimensions: '1024x1024',
        numberOfImages: 1,
        userID: 'hashed-user',
      });

      expect(mockOpenAIImages.generate).toHaveBeenCalledTimes(1);
      const callArgs = mockOpenAIImages.generate.mock.calls[0][0];
      expect(callArgs.model).toBe('dall-e-3');
      expect(callArgs.prompt).toBe('a sunset painting');
      expect(callArgs.size).toBe('1024x1024');
      expect(callArgs.response_format).toBe('b64_json');
      expect(callArgs.style).toBe('natural');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('GPT Image Gen 1', () => {
    it('should call openai.images.generate with gpt-image-1 params', async () => {
      const result = await generateImageViaGPTImageGen1({
        userInput: 'a modern logo',
        trueDimensions: '1024x1024',
        numberOfImages: 1,
        userID: 'hashed-user',
        quality: 'high',
        moderation: 'auto',
      });

      expect(mockOpenAIImages.generate).toHaveBeenCalledTimes(1);
      const callArgs = mockOpenAIImages.generate.mock.calls[0][0];
      expect(callArgs.model).toBe('gpt-image-1');
      expect(callArgs.quality).toBe('high');
      expect(callArgs.moderation).toBe('auto');
      expect(callArgs.size).toBe('1024x1024');
      expect(Array.isArray(result)).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Return value validation
// ─────────────────────────────────────────────────────────────
describe('All providers return Buffer arrays', () => {
  const replicateProviders = [
    { name: 'FluxSchnell', fn: () => generateImageViaReplicate_FluxSchnell({ userInput: 'test', imageModel: 'black-forest-labs/flux-schnell', numberOfImages: 1, trueDimensions: '1:1', output_format: 'png', output_quality: 100, disable_safety_checker: false }) },
    { name: 'Flux2Dev', fn: () => generateImageViaReplicate_Flux2Dev({ userInput: 'test', imageModel: 'black-forest-labs/flux-2-dev', numberOfImages: 1, trueDimensions: '1:1', output_format: 'png', output_quality: 100, disable_safety_checker: false, go_fast: true }) },
    { name: 'Seedream3', fn: () => generateImageViaReplicate_Seedream3({ userInput: 'test', aspect_ratio: '1:1' }) },
    { name: 'Imagen4Fast', fn: () => generateImageViaReplicate_Imagen4Fast({ userInput: 'test', aspect_ratio: '1:1' }) },
    { name: 'NanaBananaPro', fn: () => generateImageViaReplicate_NanaBananaPro({ userInput: 'test', aspect_ratio: '1:1', resolution: '1K', output_format: 'png' }) },
  ];

  for (const { name, fn } of replicateProviders) {
    it(`${name} should return an array of Buffers`, async () => {
      const result = await fn();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      for (const buf of result) {
        expect(Buffer.isBuffer(buf)).toBe(true);
      }
    });
  }
});
