const Replicate = require('replicate');
const sharp = require('sharp');
const { checkThenSave_ReturnSendImage } = require('../helperFunctions.js');

async function generateImageEditViaReplicate_FluxKontextDev({ image, userInput, aspect_ratio, num_inference_steps, guidance, seed, output_format, output_quality, disable_safety_checker, go_fast }) {
    const replicate = new Replicate({ auth: process.env.API_KEY_REPLICATE });
    console.log('\n---Generating image-edit via Replicate FLUX Kontex Dev---');
    console.log('-Prompt:', userInput);
    if (aspect_ratio) console.log('-Aspect Ratio:', aspect_ratio);
    if (num_inference_steps !== undefined) console.log('-Inference Steps:', num_inference_steps);
    if (guidance !== undefined) console.log('-Guidance:', guidance);
    if (seed !== undefined) console.log('-Seed:', seed);
    if (output_format) console.log('-Output Format:', output_format);
    if (output_quality !== undefined) console.log('-Output Quality:', output_quality);
    if (disable_safety_checker !== undefined) console.log('-Disable Safety Checker:', disable_safety_checker);
    if (go_fast !== undefined) console.log('-Go Fast:', go_fast);

    const input = { prompt: userInput, input_image: image };
    if (aspect_ratio) input.aspect_ratio = aspect_ratio;
    if (num_inference_steps !== undefined) input.num_inference_steps = num_inference_steps;
    if (guidance !== undefined) input.guidance = guidance;
    if (seed !== undefined) input.seed = seed;
    if (output_format) input.output_format = output_format;
    if (output_quality !== undefined) input.output_quality = output_quality;
    if (disable_safety_checker !== undefined) input.disable_safety_checker = disable_safety_checker;
    if (go_fast !== undefined) input.go_fast = go_fast;

    try {
        const prediction = await replicate.run('black-forest-labs/flux-kontext-dev', { input });
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
        console.error('Error generating image-edit with Replicate FLUX Kontex Dev:', error);
        throw error;
    }
}

module.exports = {
    generateImageEditViaReplicate_FluxKontextDev
};
