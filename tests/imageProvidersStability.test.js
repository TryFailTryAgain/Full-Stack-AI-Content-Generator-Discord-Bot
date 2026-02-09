const path = require('path');
require(path.resolve(__dirname, '..', 'tests', 'setup.js'));

jest.mock('sharp', () => {
  return jest.fn(() => ({
    png: jest.fn().mockReturnValue({
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

const axios = require('axios');

jest.mock('axios', () => ({
  postForm: jest.fn(),
  post: jest.fn(),
  toFormData: jest.fn(),
}));

const { generateImageViaStabilityAIv1 } = require('../functions/image_providers/StabilityXL.js');
const { generateImageViaSD3 } = require('../functions/image_providers/SD3.js');

const { checkThenSave_ReturnSendImage } = require('../functions/helperFunctions.js');

global.fetch = jest.fn();

describe('image providers/Stability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds StabilityAI v1 request', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        artifacts: [{ base64: Buffer.from('img').toString('base64') }],
      }),
    });

    await generateImageViaStabilityAIv1({
      userInput: 'prompt',
      negativePrompt: 'nope',
      trueDimensions: '512x512',
      imageModel: 'stable-diffusion-v1-6',
      numberOfImages: 1,
      cfg: 7,
      steps: 30,
      seed: 123,
      userID: 'user-1',
    });

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.stability.ai/v1/generation/stable-diffusion-v1-6/text-to-image');
    const body = JSON.parse(options.body);
    expect(body).toEqual(expect.objectContaining({
      cfg_scale: 7,
      width: 512,
      height: 512,
      steps: 30,
      samples: 1,
      seed: 123,
    }));
    expect(checkThenSave_ReturnSendImage).toHaveBeenCalled();
  });

  it('throws on StabilityAI non-200 responses', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      text: jest.fn().mockResolvedValue('bad request'),
    });

    await expect(
      generateImageViaStabilityAIv1({
        userInput: 'prompt',
        negativePrompt: 'nope',
        trueDimensions: '512x512',
        imageModel: 'stable-diffusion-v1-6',
        numberOfImages: 1,
        cfg: 7,
        steps: 30,
        seed: 123,
        userID: 'user-1',
      })
    ).rejects.toThrow('Non-200 response');
  });

  it('builds SD3 request payload', async () => {
    axios.toFormData.mockReturnValueOnce('form');
    axios.postForm.mockResolvedValueOnce({ status: 200, data: Buffer.from('img') });

    await generateImageViaSD3({
      userInput: 'prompt',
      negativePrompt: 'nope',
      trueDimensions: '1:1',
      imageModel: 'sd3.5-large',
      numberOfImages: 1,
    });

    expect(axios.toFormData).toHaveBeenCalledWith({
      model: 'sd3.5-large',
      prompt: 'prompt',
      output_format: 'png',
      mode: 'text-to-image',
      aspect_ratio: '1:1',
      negativePrompt: 'nope',
    }, expect.any(Object));
    expect(axios.postForm).toHaveBeenCalled();
    expect(checkThenSave_ReturnSendImage).toHaveBeenCalled();
  });

  it('throws on SD3 non-200 responses', async () => {
    axios.toFormData.mockReturnValueOnce('form');
    axios.postForm.mockResolvedValueOnce({ status: 400, data: Buffer.from('bad') });

    await expect(
      generateImageViaSD3({
        userInput: 'prompt',
        negativePrompt: 'nope',
        trueDimensions: '1:1',
        imageModel: 'sd3.5-large',
        numberOfImages: 1,
      })
    ).rejects.toThrow('400');
  });
});
