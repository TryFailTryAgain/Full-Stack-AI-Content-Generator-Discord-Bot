/**
 * Error path tests for Image Functions (generateImage, generateImageToImage,
 * generateImageEdit, upscaleImage, promptOptimizer, adaptImagePrompt).
 *
 * Tests moderation flagging at various pipeline stages, unsupported models,
 * provider failures, and API errors.
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

// Mock the image command module (required by image_functions at load time)
jest.mock('../commands/CoreFunctions/image.js', () => ({
  data: { name: 'image' },
  execute: jest.fn(),
}));

// Mock moderation - default to not flagged, override per test
const mockModerateContent = jest.fn().mockResolvedValue({
  flagged: false,
  flaggedCategories: [],
  cleanedText: 'clean text',
});
jest.mock('../functions/moderation.js', () => ({
  moderateContent: mockModerateContent,
}));

// Mock helperFunctions (image_functions puts these on global)
jest.mock('../functions/helperFunctions.js', () => ({
  checkThenSave_ReturnSendImage: jest.fn().mockImplementation(async (buf) => buf),
  generateHashedUserId: jest.fn().mockResolvedValue('hashed-test-user'),
  saveToDiskCheck: jest.fn().mockReturnValue(false),
  generateRandomHex: jest.fn().mockReturnValue('deadbeef'),
}));

// Mock all image providers
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
  generateImageViaReplicate_Flux2Dev: jest.fn().mockResolvedValue([Buffer.from('mock')]),
  generateImageToImageViaReplicate_Flux2Dev: jest.fn().mockResolvedValue([Buffer.from('mock')]),
  generateMultiReferenceImageViaReplicate_Flux2Dev: jest.fn().mockResolvedValue([Buffer.from('mock')]),
  generateImageEditViaReplicate_Flux2Dev: jest.fn().mockResolvedValue([Buffer.from('mock')]),
}));
jest.mock('../functions/image_providers/Flux2Pro.js', () => ({
  generateImageViaReplicate_Flux2Pro: jest.fn().mockResolvedValue([Buffer.from('mock')]),
  generateImageToImageViaReplicate_Flux2Pro: jest.fn().mockResolvedValue([Buffer.from('mock')]),
  generateMultiReferenceImageViaReplicate_Flux2Pro: jest.fn().mockResolvedValue([Buffer.from('mock')]),
  generateImageEditViaReplicate_Flux2Pro: jest.fn().mockResolvedValue([Buffer.from('mock')]),
}));
jest.mock('../functions/image_providers/Flux2Klein4b.js', () => ({
  generateImageViaReplicate_Flux2Klein4b: jest.fn().mockResolvedValue([Buffer.from('mock')]),
  generateImageToImageViaReplicate_Flux2Klein4b: jest.fn().mockResolvedValue([Buffer.from('mock')]),
  generateImageEditViaReplicate_Flux2Klein4b: jest.fn().mockResolvedValue([Buffer.from('mock')]),
}));
jest.mock('../functions/image_providers/Flux2Klein9bBase.js', () => ({
  generateImageViaReplicate_Flux2Klein9bBase: jest.fn().mockResolvedValue([Buffer.from('mock')]),
  generateImageToImageViaReplicate_Flux2Klein9bBase: jest.fn().mockResolvedValue([Buffer.from('mock')]),
  generateImageEditViaReplicate_Flux2Klein9bBase: jest.fn().mockResolvedValue([Buffer.from('mock')]),
}));
jest.mock('../functions/image_providers/Flux2Max.js', () => ({
  generateImageViaReplicate_Flux2Max: jest.fn().mockResolvedValue([Buffer.from('mock')]),
  generateImageToImageViaReplicate_Flux2Max: jest.fn().mockResolvedValue([Buffer.from('mock')]),
  generateImageEditViaReplicate_Flux2Max: jest.fn().mockResolvedValue([Buffer.from('mock')]),
}));
jest.mock('../functions/image_providers/ReplicateESRGAN.js', () => ({
  upscaleImageViaReplicate_esrgan: jest.fn().mockResolvedValue(Buffer.from('upscaled-mock')),
}));
jest.mock('../functions/image_providers/FluxKontextPro.js', () => ({
  generateImageEditViaReplicate_FluxKontextPro: jest.fn().mockResolvedValue([Buffer.from('mock')]),
}));
jest.mock('../functions/image_providers/FluxKontextDev.js', () => ({
  generateImageEditViaReplicate_FluxKontextDev: jest.fn().mockResolvedValue([Buffer.from('mock')]),
}));
jest.mock('../functions/image_providers/Seedream3.js', () => ({
  generateImageViaReplicate_Seedream3: jest.fn().mockResolvedValue([Buffer.from('mock')]),
}));
jest.mock('../functions/image_providers/Seedream45.js', () => ({
  generateImageViaReplicate_Seedream45: jest.fn().mockResolvedValue([Buffer.from('mock')]),
  generateImageToImageViaReplicate_Seedream45: jest.fn().mockResolvedValue([Buffer.from('mock')]),
  generateImageEditViaReplicate_Seedream45: jest.fn().mockResolvedValue([Buffer.from('mock')]),
}));
jest.mock('../functions/image_providers/Imagen4Fast.js', () => ({
  generateImageViaReplicate_Imagen4Fast: jest.fn().mockResolvedValue([Buffer.from('mock')]),
}));
jest.mock('../functions/image_providers/Imagen4.js', () => ({
  generateImageViaReplicate_Imagen4: jest.fn().mockResolvedValue([Buffer.from('mock')]),
}));
jest.mock('../functions/image_providers/Imagen4Ultra.js', () => ({
  generateImageViaReplicate_Imagen4Ultra: jest.fn().mockResolvedValue([Buffer.from('mock')]),
}));
jest.mock('../functions/image_providers/NanaBananaPro.js', () => ({
  generateImageViaReplicate_NanaBananaPro: jest.fn().mockResolvedValue([Buffer.from('mock')]),
  generateImageToImageViaReplicate_NanaBananaPro: jest.fn().mockResolvedValue([Buffer.from('mock')]),
  generateImageEditViaReplicate_NanaBananaPro: jest.fn().mockResolvedValue([Buffer.from('mock')]),
}));

// Require the REAL image_functions (not mocked) - all its dependencies are mocked above
const imageFunctions = require('../functions/image_functions');

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockModerateContent.mockResolvedValue({
    flagged: false,
    flaggedCategories: [],
    cleanedText: 'clean text',
  });
  mockOpenAI.chat.completions.create.mockResolvedValue({
    choices: [{ message: { content: 'Optimized prompt text' } }],
  });
});

describe('generateImage error handling', () => {
  it('should throw when user input is flagged by moderation', async () => {
    mockModerateContent.mockResolvedValueOnce({
      flagged: true,
      flaggedCategories: ['flagged_category_b'],
      cleanedText: '',
    });

    await expect(
      imageFunctions.generateImage({
        userInput: 'flagged content',
        imageModel: 'dall-e-3',
        dimensions: 'square',
        numberOfImages: 1,
        userID: 'test-user',
      })
    ).rejects.toThrow('flagged by the moderation system');
  });

  it('should throw when negative prompt is flagged', async () => {
    mockModerateContent
      .mockResolvedValueOnce({ flagged: false, flaggedCategories: [], cleanedText: 'clean' })
      .mockResolvedValueOnce({ flagged: true, flaggedCategories: ['flagged_category_a'], cleanedText: '' });

    await expect(
      imageFunctions.generateImage({
        userInput: 'a landscape',
        negativePrompt: 'flagged prompt content',
        imageModel: 'dall-e-3',
        dimensions: 'square',
        numberOfImages: 1,
        userID: 'test-user',
      })
    ).rejects.toThrow('negative prompt was flagged');
  });

  it('should throw for completely invalid model', async () => {
    await expect(
      imageFunctions.generateImage({
        userInput: 'test',
        imageModel: 'nonexistent-provider/fake-model',
        dimensions: 'square',
        numberOfImages: 1,
        userID: 'test-user',
      })
    ).rejects.toThrow('Unsupported image model');
  });

  it('should propagate provider network error', async () => {
    const { generateImageViaReplicate_FluxSchnell } = require('../functions/image_providers/FluxSchnell.js');
    generateImageViaReplicate_FluxSchnell.mockRejectedValueOnce(
      new Error('Replicate API: 503 Service Unavailable')
    );

    await expect(
      imageFunctions.generateImage({
        userInput: 'a cat',
        imageModel: 'black-forest-labs/flux-schnell',
        dimensions: 'square',
        numberOfImages: 1,
        userID: 'test-user',
      })
    ).rejects.toThrow('503 Service Unavailable');
  });
});

describe('generateImageToImage error handling', () => {
  it('should throw when user input is flagged', async () => {
    mockModerateContent.mockResolvedValueOnce({
      flagged: true,
      flaggedCategories: ['flagged_category_a'],
      cleanedText: '',
    });

    await expect(
      imageFunctions.generateImageToImage({
        images: ['https://example.com/img.png'],
        userInput: 'flagged content',
        Image2Image_Model: 'black-forest-labs/flux-2-dev',
        strength: 0.5,
        userID: 'test-user',
      })
    ).rejects.toThrow('flagged by the moderation system');
  });

  it('should throw when input image is flagged', async () => {
    mockModerateContent
      .mockResolvedValueOnce({ flagged: false, flaggedCategories: [], cleanedText: 'clean' })
      .mockResolvedValueOnce({ flagged: true, flaggedCategories: ['flagged_category_b'], cleanedText: '' });

    await expect(
      imageFunctions.generateImageToImage({
        images: ['https://example.com/flagged-img.png'],
        userInput: 'transform this',
        Image2Image_Model: 'black-forest-labs/flux-2-dev',
        strength: 0.5,
        userID: 'test-user',
      })
    ).rejects.toThrow('image was flagged');
  });

  it('should throw for unsupported i2i model', async () => {
    await expect(
      imageFunctions.generateImageToImage({
        images: ['https://example.com/img.png'],
        userInput: 'transform',
        Image2Image_Model: 'nonexistent/model',
        strength: 0.5,
        userID: 'test-user',
      })
    ).rejects.toThrow('Unsupported image model');
  });

  it('should moderate each image in multi-image input', async () => {
    mockModerateContent
      .mockResolvedValueOnce({ flagged: false, flaggedCategories: [], cleanedText: 'clean' }) // userInput
      .mockResolvedValueOnce({ flagged: false, flaggedCategories: [], cleanedText: '' })  // img1
      .mockResolvedValueOnce({ flagged: false, flaggedCategories: [], cleanedText: '' })  // img2
      .mockResolvedValueOnce({ flagged: true, flaggedCategories: ['flagged_category_b'], cleanedText: '' }); // img3

    await expect(
      imageFunctions.generateImageToImage({
        images: ['https://example.com/a.png', 'https://example.com/b.png', 'https://example.com/bad.png'],
        userInput: 'blend these',
        Image2Image_Model: 'black-forest-labs/flux-2-dev',
        strength: 0.5,
        userID: 'test-user',
      })
    ).rejects.toThrow('image was flagged');
  });
});

describe('generateImageEdit error handling', () => {
  it('should throw when instructions are flagged', async () => {
    mockModerateContent.mockResolvedValueOnce({
      flagged: true,
      flaggedCategories: ['flagged_category_a'],
      cleanedText: '',
    });

    await expect(
      imageFunctions.generateImageEdit({
        images: ['https://example.com/img.png'],
        instructions: 'flagged edit',
        ImageEdit_Model: 'black-forest-labs/flux-kontext-pro',
        userID: 'test-user',
      })
    ).rejects.toThrow('flagged by the moderation system');
  });

  it('should throw when edit image is flagged', async () => {
    mockModerateContent
      .mockResolvedValueOnce({ flagged: false, flaggedCategories: [], cleanedText: 'clean' })
      .mockResolvedValueOnce({ flagged: true, flaggedCategories: ['flagged_category_b'], cleanedText: '' });

    await expect(
      imageFunctions.generateImageEdit({
        images: ['https://example.com/bad.png'],
        instructions: 'edit this',
        ImageEdit_Model: 'black-forest-labs/flux-kontext-pro',
        userID: 'test-user',
      })
    ).rejects.toThrow('image was flagged');
  });

  it('should throw for unsupported edit model', async () => {
    await expect(
      imageFunctions.generateImageEdit({
        images: ['https://example.com/img.png'],
        instructions: 'edit',
        ImageEdit_Model: 'unsupported/edit-model',
        userID: 'test-user',
      })
    ).rejects.toThrow('Unsupported image edit model');
  });
});

describe('upscaleImage error handling', () => {
  it('should throw when image is flagged by moderation', async () => {
    mockModerateContent.mockResolvedValueOnce({
      flagged: true,
      flaggedCategories: ['flagged_category_a'],
      cleanedText: '',
    });

    await expect(
      imageFunctions.upscaleImage(Buffer.from('test-image'), 'nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa')
    ).rejects.toThrow('image was flagged');
  });

  it('should throw for unsupported upscale model', async () => {
    await expect(
      imageFunctions.upscaleImage(Buffer.from('test-image'), 'some-unknown-upscaler')
    ).rejects.toThrow('Unsupported upscale model');
  });

  it('should propagate ESRGAN provider error', async () => {
    const { upscaleImageViaReplicate_esrgan } = require('../functions/image_providers/ReplicateESRGAN.js');
    upscaleImageViaReplicate_esrgan.mockRejectedValueOnce(
      new Error('ESRGAN processing failed')
    );

    await expect(
      imageFunctions.upscaleImage(Buffer.from('test-image'), 'nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa')
    ).rejects.toThrow('ESRGAN processing failed');
  });
});

describe('promptOptimizer error handling', () => {
  it('should throw when OpenAI API errors', async () => {
    mockOpenAI.chat.completions.create.mockRejectedValueOnce(
      new Error('OpenAI API: Internal Server Error')
    );

    // promptOptimizer wraps errors: throw new Error(`Error: ${error}`)
    await expect(
      imageFunctions.promptOptimizer('a cat photo', 'user-123')
    ).rejects.toThrow('Internal Server Error');
  });

  it('should throw when user input is flagged', async () => {
    mockModerateContent.mockResolvedValueOnce({
      flagged: true,
      flaggedCategories: ['flagged_category_b'],
      cleanedText: '',
    });

    await expect(
      imageFunctions.promptOptimizer('flagged content', 'user-123')
    ).rejects.toThrow('flagged by the moderation system');
  });

  it('should throw when AI-generated optimized prompt is flagged', async () => {
    // First call (user input) passes
    mockModerateContent
      .mockResolvedValueOnce({ flagged: false, flaggedCategories: [], cleanedText: 'clean input' })
      // Second call (AI output) flags
      .mockResolvedValueOnce({ flagged: true, flaggedCategories: ['flagged_category_a'], cleanedText: '' });

    await expect(
      imageFunctions.promptOptimizer('innocent prompt', 'user-123')
    ).rejects.toThrow('AI-generated optimized prompt was flagged');
  });

  it('should throw on rate limit from OpenAI', async () => {
    const error = new Error('429: Too Many Requests');
    error.status = 429;
    mockOpenAI.chat.completions.create.mockRejectedValueOnce(error);

    await expect(
      imageFunctions.promptOptimizer('test prompt', 'user-123')
    ).rejects.toThrow('429');
  });
});

describe('adaptImagePrompt error handling', () => {
  it('should throw when refinement request is flagged', async () => {
    mockModerateContent.mockResolvedValueOnce({
      flagged: true,
      flaggedCategories: ['flagged_category_a'],
      cleanedText: '',
    });

    await expect(
      imageFunctions.adaptImagePrompt('a landscape', 'flagged change', 'user-123')
    ).rejects.toThrow('refinement request was flagged');
  });

  it('should throw when AI response lacks PROMPT markers', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: 'Here is a better prompt without markers' } }],
    });

    await expect(
      imageFunctions.adaptImagePrompt('original prompt', 'make it better', 'user-123')
    ).rejects.toThrow('Failed to extract refined prompt');
  });

  it('should throw when OpenAI API fails', async () => {
    mockOpenAI.chat.completions.create.mockRejectedValueOnce(
      new Error('Service temporarily unavailable')
    );

    await expect(
      imageFunctions.adaptImagePrompt('test', 'refine', 'user-123')
    ).rejects.toThrow('Service temporarily unavailable');
  });

  it('should throw when AI-generated refined prompt is flagged', async () => {
    // Refinement moderation passes
    mockModerateContent
      .mockResolvedValueOnce({ flagged: false, flaggedCategories: [], cleanedText: 'make it different' });

    // OpenAI returns valid response with markers
    mockOpenAI.chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: '<PROMPT>flagged refined content</PROMPT>' } }],
    });

    // AI output moderation flags
    mockModerateContent
      .mockResolvedValueOnce({ flagged: true, flaggedCategories: ['flagged_category_a'], cleanedText: '' });

    await expect(
      imageFunctions.adaptImagePrompt('original', 'make it different', 'user-123')
    ).rejects.toThrow('AI-generated refined prompt was flagged');
  });

  it('should handle empty PROMPT markers - whitespace is valid', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: '<PROMPT>   </PROMPT>' } }],
    });

    // Empty-ish but whitespace between markers is still valid extraction
    const result = await imageFunctions.adaptImagePrompt('test', 'refine', 'user-123');
    expect(typeof result).toBe('string');
  });
});
