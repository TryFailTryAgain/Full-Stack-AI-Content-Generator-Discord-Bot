const Replicate = require('replicate');
const sharp = require('sharp');
const { checkThenSave_ReturnSendImage } = require('../helperFunctions.js');

async function generateImageViaReplicate_Seedream3({ userInput, seed, aspect_ratio, size, width, height, guidance_scale }) {
    const replicate = new Replicate({ auth: process.env.API_KEY_REPLICATE });
    console.log('\n---Generating image via Replicate Seedream-3---');
    console.log('-Prompt:', userInput);
    if (seed) console.log('-Seed:', seed);
    if (aspect_ratio) console.log('-Aspect Ratio:', aspect_ratio);
    if (size) console.log('-Size:', size);
    if (width) console.log('-Width:', width);
    if (height) console.log('-Height:', height);
    if (guidance_scale) console.log('-Guidance Scale:', guidance_scale);

    const input = { prompt: userInput };
    if (seed) input.seed = seed;
    if (aspect_ratio) input.aspect_ratio = aspect_ratio;
    if (size) input.size = size;
    if (width) input.width = width;
    if (height) input.height = height;
    if (guidance_scale) input.guidance_scale = guidance_scale;

    try {
        const prediction = await replicate.run('bytedance/seedream-3', { input });
        const results = Array.isArray(prediction) ? prediction : [prediction];
        const imageBuffer = [];

        for (const url of results) {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const saveBuffer = await sharp(Buffer.from(arrayBuffer))[process.env.ADVCONF_SAVE_IMAGES_AS]({ quality: parseInt(process.env.ADVCONF_JPEG_QUALITY) }).toBuffer();
            const processed = await checkThenSave_ReturnSendImage(saveBuffer);
            imageBuffer.push(processed);
        }

        console.log('Image Generated!');
        return imageBuffer;
    } catch (error) {
        console.error('Error generating image with Replicate Seedream-3:', error);
        throw error;
    }
}

module.exports = { generateImageViaReplicate_Seedream3 };
