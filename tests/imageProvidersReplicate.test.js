const path = require('path');
require(path.resolve(__dirname, '..', 'tests', 'setup.js'));

let mockRun = jest.fn();

jest.mock('replicate', () => {
  return jest.fn().mockImplementation(() => ({ run: mockRun }));
});

jest.mock('sharp', () => {
  return jest.fn(() => ({
    png: jest.fn().mockReturnValue({
      toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed')),
    }),
    jpeg: jest.fn().mockReturnValue({
      toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed')),
    }),
    webp: jest.fn().mockReturnValue({
      toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed')),
    }),
  }));
});

jest.mock('../functions/helperFunctions.js', () => ({
  checkThenSave_ReturnSendImage: jest.fn().mockResolvedValue(Buffer.from('saved')),
}));

const { generateImageViaReplicate_FluxSchnell } = require('../functions/image_providers/FluxSchnell.js');
const { generateImageViaReplicate_FluxDev, generateImageToImageViaReplicate_FluxDev } = require('../functions/image_providers/FluxDev.js');
const { generateImageViaReplicate_Flux2Dev, generateImageToImageViaReplicate_Flux2Dev } = require('../functions/image_providers/Flux2Dev.js');
const { generateImageViaReplicate_Flux2Pro, generateImageToImageViaReplicate_Flux2Pro } = require('../functions/image_providers/Flux2Pro.js');
const { generateImageViaReplicate_Flux2Klein4b, generateImageToImageViaReplicate_Flux2Klein4b } = require('../functions/image_providers/Flux2Klein4b.js');
const { generateImageViaReplicate_Flux2Klein9bBase, generateImageToImageViaReplicate_Flux2Klein9bBase } = require('../functions/image_providers/Flux2Klein9bBase.js');
const { generateImageViaReplicate_Flux2Max, generateImageToImageViaReplicate_Flux2Max } = require('../functions/image_providers/Flux2Max.js');
const { upscaleImageViaReplicate_esrgan } = require('../functions/image_providers/ReplicateESRGAN.js');
const { generateImageViaReplicate_Seedream3 } = require('../functions/image_providers/Seedream3.js');
const { generateImageViaReplicate_Seedream45, generateImageToImageViaReplicate_Seedream45 } = require('../functions/image_providers/Seedream45.js');
const { generateImageViaReplicate_Imagen4Fast } = require('../functions/image_providers/Imagen4Fast.js');
const { generateImageViaReplicate_Imagen4 } = require('../functions/image_providers/Imagen4.js');
const { generateImageViaReplicate_Imagen4Ultra } = require('../functions/image_providers/Imagen4Ultra.js');
const { generateImageViaReplicate_NanaBananaPro, generateImageToImageViaReplicate_NanaBananaPro } = require('../functions/image_providers/NanaBananaPro.js');
const { generateImageEditViaReplicate_FluxKontextDev } = require('../functions/image_providers/FluxKontextDev.js');
const { generateImageEditViaReplicate_FluxKontextPro } = require('../functions/image_providers/FluxKontextPro.js');

global.fetch = jest.fn().mockResolvedValue({
  arrayBuffer: jest.fn().mockResolvedValue(Buffer.from('raw')),
});

function expectRunCall(model, expectedInput) {
  expect(mockRun).toHaveBeenCalled();
  const [callModel, callOptions] = mockRun.mock.calls[0];
  expect(callModel).toBe(model);
  expect(callOptions).toEqual({ input: expect.objectContaining(expectedInput) });
}

describe('image providers/Replicate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
    mockRun.mockResolvedValue(['http://img.test/1.png']);
  });

  it('builds Flux Schnell request', async () => {
    mockRun.mockResolvedValueOnce(['http://img.test/1.png']);

    await generateImageViaReplicate_FluxSchnell({
      userInput: 'prompt',
      imageModel: 'black-forest-labs/flux-schnell',
      numberOfImages: 1,
      trueDimensions: '1:1',
      output_format: 'png',
      output_quality: 100,
      disable_safety_checker: false,
    });

    expectRunCall('black-forest-labs/flux-schnell', {
      prompt: 'prompt',
      num_outputs: 1,
      aspect_ratio: '1:1',
      output_format: 'png',
      output_quality: 100,
      disable_safety_checker: false,
    });
  });

  it('builds Flux Dev request', async () => {
    mockRun.mockResolvedValueOnce(['http://img.test/1.png']);

    await generateImageViaReplicate_FluxDev({
      userInput: 'prompt',
      imageModel: 'black-forest-labs/flux-dev',
      numberOfImages: 1,
      trueDimensions: '1:1',
      output_format: 'png',
      output_quality: 90,
      disable_safety_checker: true,
      seed: 123,
    });

    expectRunCall('black-forest-labs/flux-dev', {
      prompt: 'prompt',
      num_outputs: 1,
      aspect_ratio: '1:1',
      output_format: 'png',
      output_quality: 90,
      disable_safety_checker: true,
      seed: 123,
    });
  });

  it('builds Flux Dev image-to-image request', async () => {
    mockRun.mockResolvedValueOnce(['http://img.test/1.png']);

    await generateImageToImageViaReplicate_FluxDev({
      image: Buffer.from('img'),
      userInput: 'prompt',
      strength: 0.5,
      disable_safety_checker: true,
    });

    expectRunCall('black-forest-labs/flux-dev', {
      prompt: 'prompt',
      image: Buffer.from('img'),
      strength: 0.5,
      num_outputs: 1,
      disable_safety_checker: true,
    });
  });

  it('builds Flux 2 Dev request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageViaReplicate_Flux2Dev({
      userInput: 'prompt',
      imageModel: 'black-forest-labs/flux-2-dev',
      numberOfImages: 1,
      trueDimensions: '1:1',
      output_format: 'png',
      output_quality: 100,
      disable_safety_checker: false,
      go_fast: true,
    });

    expectRunCall('black-forest-labs/flux-2-dev', {
      prompt: 'prompt',
      aspect_ratio: '1:1',
      output_format: 'png',
      output_quality: 100,
      go_fast: true,
      disable_safety_checker: false,
    });
  });

  it('builds Flux 2 Dev image-to-image request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageToImageViaReplicate_Flux2Dev({
      images: [Buffer.from('img')],
      userInput: 'prompt',
      strength: 0.8,
      disable_safety_checker: false,
    });

    expectRunCall('black-forest-labs/flux-2-dev', {
      prompt: 'prompt',
      input_images: [Buffer.from('img')],
      aspect_ratio: 'match_input_image',
      output_format: 'jpg',
      output_quality: 80,
      disable_safety_checker: false,
    });
  });

  it('builds Flux 2 Pro request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageViaReplicate_Flux2Pro({
      userInput: 'prompt',
      imageModel: 'black-forest-labs/flux-2-pro',
      numberOfImages: 1,
      trueDimensions: '1:1',
      output_format: 'png',
      output_quality: 90,
      resolution: '1 MP',
      safety_tolerance: 2,
    });

    expectRunCall('black-forest-labs/flux-2-pro', {
      prompt: 'prompt',
      aspect_ratio: '1:1',
      resolution: '1 MP',
      output_format: 'png',
      output_quality: 90,
      safety_tolerance: 2,
    });
  });

  it('builds Flux 2 Pro image-to-image request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageToImageViaReplicate_Flux2Pro({
      images: [Buffer.from('img')],
      userInput: 'prompt',
      resolution: '1 MP',
    });

    expectRunCall('black-forest-labs/flux-2-pro', {
      prompt: 'prompt',
      input_images: [Buffer.from('img')],
      aspect_ratio: 'match_input_image',
      resolution: '1 MP',
      output_format: 'jpg',
      output_quality: 80,
    });
  });

  it('builds Flux 2 Klein 4B request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageViaReplicate_Flux2Klein4b({
      userInput: 'prompt',
      imageModel: 'black-forest-labs/flux-2-klein-4b',
      numberOfImages: 1,
      trueDimensions: '1:1',
      output_format: 'png',
      output_quality: 95,
      disable_safety_checker: true,
    });

    expectRunCall('black-forest-labs/flux-2-klein-4b', {
      prompt: 'prompt',
      aspect_ratio: '1:1',
      output_format: 'png',
      output_quality: 95,
      output_megapixels: '2',
      disable_safety_checker: true,
    });
  });

  it('builds Flux 2 Klein 4B image-to-image request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageToImageViaReplicate_Flux2Klein4b({
      images: [Buffer.from('img')],
      userInput: 'prompt',
      strength: 0.7,
      disable_safety_checker: false,
    });

    expectRunCall('black-forest-labs/flux-2-klein-4b', {
      prompt: 'prompt',
      images: [Buffer.from('img')],
      aspect_ratio: 'match_input_image',
      output_format: 'png',
      output_quality: 100,
      output_megapixels: '2',
      disable_safety_checker: false,
    });
  });

  it('builds Flux 2 Klein 9B Base request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageViaReplicate_Flux2Klein9bBase({
      userInput: 'prompt',
      imageModel: 'black-forest-labs/flux-2-klein-9b-base',
      numberOfImages: 1,
      trueDimensions: '1:1',
      output_format: 'png',
      output_quality: 95,
      disable_safety_checker: true,
      guidance: 4,
    });

    expectRunCall('black-forest-labs/flux-2-klein-9b-base', {
      prompt: 'prompt',
      aspect_ratio: '1:1',
      output_format: 'png',
      output_quality: 95,
      output_megapixels: '2',
      guidance: 4,
      disable_safety_checker: true,
    });
  });

  it('builds Flux 2 Klein 9B Base image-to-image request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageToImageViaReplicate_Flux2Klein9bBase({
      images: [Buffer.from('img')],
      userInput: 'prompt',
      disable_safety_checker: false,
    });

    expectRunCall('black-forest-labs/flux-2-klein-9b-base', {
      prompt: 'prompt',
      images: [Buffer.from('img')],
      aspect_ratio: 'match_input_image',
      output_format: 'png',
      output_quality: 100,
      output_megapixels: '2',
      guidance: 4,
      disable_safety_checker: false,
    });
  });

  it('builds Flux 2 Max request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageViaReplicate_Flux2Max({
      userInput: 'prompt',
      imageModel: 'black-forest-labs/flux-2-max',
      numberOfImages: 1,
      trueDimensions: '1:1',
      output_format: 'png',
      output_quality: 90,
    });

    expectRunCall('black-forest-labs/flux-2-max', {
      prompt: 'prompt',
      aspect_ratio: '1:1',
      output_format: 'png',
      output_quality: 90,
    });
  });

  it('builds Flux 2 Max image-to-image request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageToImageViaReplicate_Flux2Max({
      images: [Buffer.from('img')],
      userInput: 'prompt',
      output_format: 'png',
    });

    expectRunCall('black-forest-labs/flux-2-max', {
      prompt: 'prompt',
      input_images: [Buffer.from('img')],
      aspect_ratio: 'match_input_image',
      output_format: 'png',
      output_quality: 100,
    });
  });

  it('builds ESRGAN upscale request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await upscaleImageViaReplicate_esrgan({
      imageBuffer: Buffer.from('img'),
      scaleFactor: 2,
      face_enhance: false,
    });

    expect(mockRun).toHaveBeenCalledWith(
      'nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa',
      {
        input: expect.objectContaining({
          scale: 2,
          face_enhance: false,
        }),
      }
    );
  });

  it('builds Seedream-3 request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageViaReplicate_Seedream3({
      userInput: 'prompt',
      seed: 123,
      aspect_ratio: '1:1',
    });

    expectRunCall('bytedance/seedream-3', {
      prompt: 'prompt',
      seed: 123,
      aspect_ratio: '1:1',
    });
  });

  it('builds Seedream-4.5 request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageViaReplicate_Seedream45({
      userInput: 'prompt',
      size: '2K',
      aspect_ratio: '1:1',
      sequential_image_generation: 'disabled',
    });

    expectRunCall('bytedance/seedream-4.5', {
      prompt: 'prompt',
      size: '2K',
      aspect_ratio: '1:1',
      sequential_image_generation: 'disabled',
    });
  });

  it('builds Seedream-4.5 image-to-image request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageToImageViaReplicate_Seedream45({
      images: [Buffer.from('img')],
      userInput: 'prompt',
      size: '2K',
    });

    expectRunCall('bytedance/seedream-4.5', {
      prompt: 'prompt',
      image_input: [Buffer.from('img')],
      size: '2K',
    });
  });

  it('builds Imagen-4 Fast request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageViaReplicate_Imagen4Fast({
      userInput: 'prompt',
      aspect_ratio: '1:1',
      output_format: 'png',
    });

    expectRunCall('google/imagen-4-fast', {
      prompt: 'prompt',
      aspect_ratio: '1:1',
      output_format: 'png',
    });
  });

  it('builds Imagen-4 request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageViaReplicate_Imagen4({
      userInput: 'prompt',
      aspect_ratio: '1:1',
      output_format: 'png',
    });

    expectRunCall('google/imagen-4', {
      prompt: 'prompt',
      aspect_ratio: '1:1',
      output_format: 'png',
    });
  });

  it('builds Imagen-4 Ultra request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageViaReplicate_Imagen4Ultra({
      userInput: 'prompt',
      aspect_ratio: '1:1',
      output_format: 'png',
    });

    expectRunCall('google/imagen-4-ultra', {
      prompt: 'prompt',
      aspect_ratio: '1:1',
      output_format: 'png',
    });
  });

  it('builds Nano Banana Pro request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageViaReplicate_NanaBananaPro({
      userInput: 'prompt',
      aspect_ratio: '1:1',
      resolution: '2K',
    });

    expectRunCall('google/nano-banana-pro', {
      prompt: 'prompt',
      aspect_ratio: '1:1',
      resolution: '2K',
    });
  });

  it('builds Nano Banana Pro image-to-image request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageToImageViaReplicate_NanaBananaPro({
      images: [Buffer.from('img')],
      userInput: 'prompt',
      aspect_ratio: '1:1',
    });

    expectRunCall('google/nano-banana-pro', {
      prompt: 'prompt',
      image_input: [Buffer.from('img')],
      aspect_ratio: '1:1',
    });
  });

  it('builds Flux Kontext Dev edit request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageEditViaReplicate_FluxKontextDev({
      image: Buffer.from('img'),
      userInput: 'prompt',
      aspect_ratio: '1:1',
    });

    expectRunCall('black-forest-labs/flux-kontext-dev', {
      prompt: 'prompt',
      input_image: Buffer.from('img'),
      aspect_ratio: '1:1',
    });
  });

  it('builds Flux Kontext Pro edit request', async () => {
    mockRun.mockResolvedValueOnce('http://img.test/1.png');

    await generateImageEditViaReplicate_FluxKontextPro({
      image: Buffer.from('img'),
      userInput: 'prompt',
      aspect_ratio: '1:1',
    });

    expectRunCall('black-forest-labs/flux-kontext-pro', {
      prompt: 'prompt',
      input_image: Buffer.from('img'),
      aspect_ratio: '1:1',
    });
  });
});
