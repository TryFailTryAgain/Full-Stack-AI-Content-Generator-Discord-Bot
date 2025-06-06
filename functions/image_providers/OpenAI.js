const sharp = require('sharp');
const OpenAI = require('openai');

const openaiImage = new OpenAI({ apiKey: process.env.API_KEY_OPENAI_IMAGE });
openaiImage.baseURL = process.env.ADVCONF_OPENAI_IMAGE_BASE_URL;

async function generateImageViaDallE3({ userInput, trueDimensions, numberOfImages, userID }) {
    // Log the parameters to the console
    console.log('\n---Generating image via Dall-E-3---');
    console.log('-User Input:', userInput);
    console.log('-True Dimensions:', trueDimensions);
    console.log('-Number of Images:', numberOfImages);
    console.log('-Hashed User ID:', userID);

    let imageBuffer = [];

    for (let i = 0; i < numberOfImages; i++) {
        const response = await openaiImage.images.generate({
            model: "dall-e-3",
            prompt: userInput,
            n: 1,
            size: trueDimensions,
            quality: "standard", // "standard" or "hd" TODO: Add this to command options
            style: "natural", // "natural" or "vivid  TODO: Add this to command options
            response_format: "b64_json",
            user: toString(userID),
        });
        // Process and save the generated image
        const saveBuffer = await sharp((Buffer.from(response.data[0].b64_json, 'base64')))[process.env.ADVCONF_SAVE_IMAGES_AS]({ quality: parseInt(process.env.ADVCONF_JPEG_QUALITY) }).toBuffer();
        const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);
        imageBuffer.push(processedBuffer);
    }
    console.log('Image Generated!');
    return imageBuffer;
}

async function generateImageViaGPTImageGen1({ userInput, trueDimensions, numberOfImages, userID, quality, moderation }) {
    console.log('\n---Generating image via GPT image-1---');
    console.log('-User Input:', userInput);
    console.log('-True Dimensions:', trueDimensions);
    console.log('-Number of Images:', numberOfImages);
    console.log('-Hashed User ID:', userID);
    console.log('-Quality:', quality);
    console.log('-Moderation:', moderation);

    let imageBuffer = [];
    for (let i = 0; i < numberOfImages; i++) {
        const response = await openaiImage.images.generate({
            model: 'gpt-image-1',
            prompt: userInput,
            n: numberOfImages, // 1-10
            size: trueDimensions, // 1024x1024,1024x1536,1536x1024
            quality: quality, // low, medium, high, auto
            moderation: moderation, // low, auto
            user: String(userID), // user ID for moderation
        });
        const saveBuffer = await sharp(Buffer.from(response.data[0].b64_json, 'base64'))[process.env.ADVCONF_SAVE_IMAGES_AS]({ quality: parseInt(process.env.ADVCONF_JPEG_QUALITY) }).toBuffer();
        const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);
        imageBuffer.push(processedBuffer);
    }
    console.log('GPT imagegen completed!');
    return imageBuffer;
}

module.exports = { generateImageViaDallE3, generateImageViaGPTImageGen1 };
