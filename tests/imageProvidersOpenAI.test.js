const path = require('path');
require(path.resolve(__dirname, '..', 'tests', 'setup.js'));

let mockOpenAIInstance;

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => {
    mockOpenAIInstance = {
      images: {
        generate: jest.fn().mockResolvedValue({
          data: [{ b64_json: Buffer.from('image-data').toString('base64') }],
        }),
      },
    };
    return mockOpenAIInstance;
  });
});

jest.mock('sharp', () => {
  return jest.fn(() => ({
    png: jest.fn().mockReturnValue({
      toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed')),
    }),
    jpeg: jest.fn().mockReturnValue({
      toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed')),
    }),
  }));
});

jest.mock('../functions/helperFunctions.js', () => ({
  checkThenSave_ReturnSendImage: jest.fn().mockResolvedValue(Buffer.from('saved')),
}));

const { generateImageViaDallE3, generateImageViaGPTImageGen1 } = require('../functions/image_providers/OpenAI.js');

const { checkThenSave_ReturnSendImage } = require('../functions/helperFunctions.js');

describe('image providers/OpenAI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds a valid Dall-E 3 request', async () => {
    const result = await generateImageViaDallE3({
      userInput: 'a cabin',
      trueDimensions: '1024x1024',
      numberOfImages: 1,
      userID: 'user-123',
    });

    expect(mockOpenAIInstance.images.generate).toHaveBeenCalledWith({
      model: 'dall-e-3',
      prompt: 'a cabin',
      n: 1,
      size: '1024x1024',
      quality: 'standard',
      style: 'natural',
      response_format: 'b64_json',
      user: 'user-123',
    });
    expect(checkThenSave_ReturnSendImage).toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it('builds a valid GPT image-1 request', async () => {
    const result = await generateImageViaGPTImageGen1({
      userInput: 'a river',
      trueDimensions: '1024x1024',
      numberOfImages: 1,
      userID: 'user-456',
      quality: 'high',
      moderation: 'auto',
    });

    expect(mockOpenAIInstance.images.generate).toHaveBeenCalledWith({
      model: 'gpt-image-1',
      prompt: 'a river',
      n: 1,
      size: '1024x1024',
      quality: 'high',
      moderation: 'auto',
      user: 'user-456',
    });
    expect(result).toHaveLength(1);
  });
});
