const Replicate = require('replicate');
const sharp = require('sharp');
const { checkThenSave_ReturnSendImage } = require('../helperFunctions.js');

async function generateImageEditViaReplicate_FluxKontextPro({ image, userInput, aspect_ratio, prompt_upsampling, seed, output_format, safety_tolerance }) {
    const replicate = new Replicate({ auth: process.env.API_KEY_REPLICATE });
    console.log('\n---Generating image-edit via Replicate FLUX Kontex Pro---');
    console.log('-Prompt:', userInput);
    if (aspect_ratio) console.log('-Aspect Ratio:', aspect_ratio);
    if (prompt_upsampling !== undefined) console.log('-Prompt Upsampling:', prompt_upsampling);
    if (seed !== undefined) console.log('-Seed:', seed);
    if (output_format) console.log('-Output Format:', output_format);
    if (safety_tolerance !== undefined) console.log('-Safety Tolerance:', safety_tolerance);

    const input = { prompt: userInput, input_image: image };
    if (aspect_ratio) input.aspect_ratio = aspect_ratio;
    if (prompt_upsampling !== undefined) input.prompt_upsampling = prompt_upsampling;
    if (seed !== undefined) input.seed = seed;
    if (output_format) input.output_format = output_format;
    if (safety_tolerance !== undefined) input.safety_tolerance = safety_tolerance;

    try {
        const prediction = await replicate.run('black-forest-labs/flux-kontext-pro', { input });
        const results = Array.isArray(prediction) ? prediction : [prediction];
        const imageBuffer = [];

        for (const url of results) {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const saveBuffer = await sharp(Buffer.from(arrayBuffer))[process.env.ADVCONF_SAVE_IMAGES_AS]({ quality: parseInt(process.env.ADVCONF_JPEG_QUALITY) }).toBuffer();
            const processed = await checkThenSave_ReturnSendImage(saveBuffer);
            imageBuffer.push(processed);
        }

        console.log('Image-edit Generated!');
        return imageBuffer;
    } catch (error) {
        console.error('Error generating image-edit with Replicate FLUX Kontex Pro:', error);
        throw error;
    }
}

module.exports = {
    generateImageEditViaReplicate_FluxKontextPro
};
