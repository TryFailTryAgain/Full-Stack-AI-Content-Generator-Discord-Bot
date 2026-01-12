const Replicate = require('replicate');
const sharp = require('sharp');
const { checkThenSave_ReturnSendImage } = require('../helperFunctions.js');

async function generateImageViaReplicate_NanaBananaPro({ userInput, aspect_ratio, resolution, output_format, safety_filter_level }) {
    const replicate = new Replicate({ auth: process.env.API_KEY_REPLICATE });
    console.log('\n---Generating image via Replicate Nano Banana Pro---');
    console.log('-Prompt:', userInput);
    if (aspect_ratio) console.log('-Aspect Ratio:', aspect_ratio);
    if (resolution) console.log('-Resolution:', resolution);
    if (output_format) console.log('-Output Format:', output_format);
    if (safety_filter_level) console.log('-Safety Filter Level:', safety_filter_level);

    const input = { prompt: userInput };
    if (aspect_ratio) input.aspect_ratio = aspect_ratio;
    if (resolution) input.resolution = resolution;
    if (output_format) input.output_format = output_format;
    if (safety_filter_level) input.safety_filter_level = safety_filter_level;

    try {
        const prediction = await replicate.run('google/nano-banana-pro', { input });
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
        console.error('Error generating image with Replicate Nano Banana Pro:', error);
        throw error;
    }
}

async function generateImageToImageViaReplicate_NanaBananaPro({ images, userInput, aspect_ratio, resolution, output_format, safety_filter_level }) {
    const replicate = new Replicate({ auth: process.env.API_KEY_REPLICATE });
    console.log('\n---Generating image-to-image via Replicate Nano Banana Pro---');
    console.log('-Prompt:', userInput);
    console.log('-Input Images:', images.length);
    if (aspect_ratio) console.log('-Aspect Ratio:', aspect_ratio);
    if (resolution) console.log('-Resolution:', resolution);
    if (output_format) console.log('-Output Format:', output_format);
    if (safety_filter_level) console.log('-Safety Filter Level:', safety_filter_level);

    const input = { prompt: userInput, image_input: images };
    if (aspect_ratio) input.aspect_ratio = aspect_ratio;
    if (resolution) input.resolution = resolution;
    if (output_format) input.output_format = output_format;
    if (safety_filter_level) input.safety_filter_level = safety_filter_level;

    try {
        const prediction = await replicate.run('google/nano-banana-pro', { input });
        const results = Array.isArray(prediction) ? prediction : [prediction];
        const imageBuffer = [];

        for (const url of results) {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const saveBuffer = await sharp(Buffer.from(arrayBuffer))[process.env.ADVCONF_SAVE_IMAGES_AS]({ quality: parseInt(process.env.ADVCONF_JPEG_QUALITY) }).toBuffer();
            const processed = await checkThenSave_ReturnSendImage(saveBuffer);
            imageBuffer.push(processed);
        }

        console.log('Image-to-image Generated!');
        return imageBuffer;
    } catch (error) {
        console.error('Error generating image-to-image with Replicate Nano Banana Pro:', error);
        throw error;
    }
}

async function generateImageEditViaReplicate_NanaBananaPro({ images, userInput, aspect_ratio, resolution, output_format, safety_filter_level }) {
    const replicate = new Replicate({ auth: process.env.API_KEY_REPLICATE });
    console.log('\n---Generating image-edit via Replicate Nano Banana Pro---');
    console.log('-Prompt:', userInput);
    console.log('-Input Images:', images.length);
    if (aspect_ratio) console.log('-Aspect Ratio:', aspect_ratio);
    if (resolution) console.log('-Resolution:', resolution);
    if (output_format) console.log('-Output Format:', output_format);
    if (safety_filter_level) console.log('-Safety Filter Level:', safety_filter_level);

    const input = { prompt: userInput, image_input: images };
    if (aspect_ratio) input.aspect_ratio = aspect_ratio;
    if (resolution) input.resolution = resolution;
    if (output_format) input.output_format = output_format;
    if (safety_filter_level) input.safety_filter_level = safety_filter_level;

    try {
        const prediction = await replicate.run('google/nano-banana-pro', { input });
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
        console.error('Error generating image-edit with Replicate Nano Banana Pro:', error);
        throw error;
    }
}

module.exports = { 
    generateImageViaReplicate_NanaBananaPro,
    generateImageToImageViaReplicate_NanaBananaPro,
    generateImageEditViaReplicate_NanaBananaPro
};
