const Replicate = require('replicate');
const sharp = require('sharp');
const { checkThenSave_ReturnSendImage } = require('../helperFunctions.js');

async function generateImageViaReplicate_Imagen4Ultra({ userInput, aspect_ratio, safety_filter_level, output_format }) {
    const replicate = new Replicate({ auth: process.env.API_KEY_REPLICATE });
    console.log('\n---Generating image via Replicate Imagen-4-Ultra---');
    console.log('-Prompt:', userInput);
    if (aspect_ratio) console.log('-Aspect Ratio:', aspect_ratio);
    if (safety_filter_level) console.log('-Safety Filter Level:', safety_filter_level);
    if (output_format) console.log('-Output Format:', output_format);

    const input = { prompt: userInput };
    if (aspect_ratio) input.aspect_ratio = aspect_ratio;
    if (safety_filter_level) input.safety_filter_level = safety_filter_level;
    if (output_format) input.output_format = output_format;

    try {
        const prediction = await replicate.run('google/imagen-4-ultra', { input });
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
        console.error('Error generating image with Replicate Imagen-4-Ultra:', error);
        throw error;
    }
}

module.exports = { generateImageViaReplicate_Imagen4Ultra };
