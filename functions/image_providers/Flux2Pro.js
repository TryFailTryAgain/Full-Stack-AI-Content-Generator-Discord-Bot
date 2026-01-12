const Replicate = require('replicate');
const sharp = require('sharp');
const { checkThenSave_ReturnSendImage } = require('../helperFunctions.js');

// Flux 2 Pro provider — mirrors Flux2Dev with Pro-specific inputs
async function generateImageViaReplicate_Flux2Pro({ userInput, imageModel, numberOfImages, trueDimensions, output_format, output_quality, seed, width, height, resolution, safety_tolerance }) {
    const replicate = new Replicate({ auth: process.env.API_KEY_REPLICATE });

    console.log('\n---Generating image via Replicate Flux 2 Pro---');
    console.log('-Prompt:', userInput);
    console.log('-Number of Images:', numberOfImages);
    console.log('-Aspect Ratio:', trueDimensions);
    console.log('-Resolution:', resolution || process.env.FLUX2PRO_RESOLUTION || '1 MP');
    console.log('-Output Format:', output_format);
    console.log('-Output Quality:', output_quality);
    if (seed !== undefined) console.log('-Seed:', seed);
    if (trueDimensions === 'custom') {
        console.log('-Width:', width);
        console.log('-Height:', height);
    }

    const input = {
        prompt: userInput,
        aspect_ratio: trueDimensions,
        resolution: resolution || process.env.FLUX2PRO_RESOLUTION || '1 MP',
        output_format: output_format,
        output_quality: output_quality,
        safety_tolerance: safety_tolerance !== undefined ? safety_tolerance : (process.env.FLUX2PRO_SAFETY_TOLERANCE ? Number(process.env.FLUX2PRO_SAFETY_TOLERANCE) : 2)
    };

    if (seed !== undefined && seed !== null) {
        input.seed = seed;
    }
    if (trueDimensions === 'custom') {
        if (width) input.width = width;
        if (height) input.height = height;
    }

    try {
        const imageBuffer = [];
        for (let n = 0; n < numberOfImages; n++) {
            const prediction = await replicate.run(imageModel || 'black-forest-labs/flux-2-pro', { input });
            const imageUrl = prediction; // Pro returns a single URL string
            const response = await fetch(imageUrl);
            const arrayBuffer = await response.arrayBuffer();
            const saveBuffer = await sharp(Buffer.from(arrayBuffer))[process.env.ADVCONF_SAVE_IMAGES_AS]({ quality: parseInt(process.env.ADVCONF_JPEG_QUALITY) }).toBuffer();
            const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);
            imageBuffer.push(processedBuffer);
        }
        console.log('Image Generated!');
        return imageBuffer;
    } catch (error) {
        console.error('Error generating image with Replicate Flux 2 Pro:', error);
        throw error;
    }
}

async function generateImageToImageViaReplicate_Flux2Pro({ images, image, userInput, strength, output_format, output_quality, seed, resolution, safety_tolerance }) {
    const replicate = new Replicate({ auth: process.env.API_KEY_REPLICATE });
    const inputImages = images || (image ? [image] : []);

    console.log('\n---Generating image-2-Image via Replicate Flux 2 Pro---');
    console.log('-User Input:', userInput);
    console.log('-Number of Input Images:', inputImages.length);
    if (strength !== undefined) console.log('-Strength:', strength);
    console.log('-Resolution:', resolution || process.env.FLUX2PRO_RESOLUTION || '1 MP');

    try {
        const input = {
            prompt: userInput,
            input_images: inputImages,
            aspect_ratio: 'match_input_image',
            resolution: resolution || process.env.FLUX2PRO_RESOLUTION || '1 MP',
            output_format: output_format || 'jpg',
            output_quality: output_quality || 80,
            safety_tolerance: safety_tolerance !== undefined ? safety_tolerance : (process.env.FLUX2PRO_SAFETY_TOLERANCE ? Number(process.env.FLUX2PRO_SAFETY_TOLERANCE) : 2)
        };

        if (seed !== undefined && seed !== null) input.seed = seed;

        const prediction = await replicate.run('black-forest-labs/flux-2-pro', { input });
        const imageUrl = prediction;
        const response = await fetch(imageUrl);
        const arrayBuffer = await response.arrayBuffer();
        const saveBuffer = await sharp(Buffer.from(arrayBuffer))[process.env.ADVCONF_SAVE_IMAGES_AS]({ quality: parseInt(process.env.ADVCONF_JPEG_QUALITY) }).toBuffer();
        const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);

        console.log('Image-2-Image Generated!');
        return [processedBuffer];
    } catch (error) {
        console.error('Error generating image-2-image with Replicate Flux 2 Pro:', error);
        throw error;
    }
}

async function generateMultiReferenceImageViaReplicate_Flux2Pro({ inputImages, userInput, output_format, output_quality, aspect_ratio, resolution, safety_tolerance, seed }) {
    const replicate = new Replicate({ auth: process.env.API_KEY_REPLICATE });

    console.log('\n---Generating multi-reference image via Replicate Flux 2 Pro---');
    console.log('-User Input:', userInput);
    console.log('-Number of Reference Images:', inputImages.length);
    console.log('-Aspect Ratio:', aspect_ratio);
    console.log('-Resolution:', resolution || process.env.FLUX2PRO_RESOLUTION || '1 MP');

    try {
        const input = {
            prompt: userInput,
            input_images: inputImages,
            aspect_ratio: aspect_ratio || 'match_input_image',
            resolution: resolution || process.env.FLUX2PRO_RESOLUTION || '1 MP',
            output_format: output_format || 'jpg',
            output_quality: output_quality || 80,
            safety_tolerance: safety_tolerance !== undefined ? safety_tolerance : (process.env.FLUX2PRO_SAFETY_TOLERANCE ? Number(process.env.FLUX2PRO_SAFETY_TOLERANCE) : 2)
        };
        if (seed !== undefined && seed !== null) input.seed = seed;

        const prediction = await replicate.run('black-forest-labs/flux-2-pro', { input });
        const imageUrl = prediction;
        const response = await fetch(imageUrl);
        const arrayBuffer = await response.arrayBuffer();
        const saveBuffer = await sharp(Buffer.from(arrayBuffer))[process.env.ADVCONF_SAVE_IMAGES_AS]({ quality: parseInt(process.env.ADVCONF_JPEG_QUALITY) }).toBuffer();
        const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);

        console.log('Multi-Reference Image Generated!');
        return [processedBuffer];
    } catch (error) {
        console.error('Error generating multi-reference image with Replicate Flux 2 Pro:', error);
        throw error;
    }
}

async function generateImageEditViaReplicate_Flux2Pro({ images, image, userInput, aspect_ratio, output_format, output_quality, resolution, safety_tolerance, seed }) {
    const replicate = new Replicate({ auth: process.env.API_KEY_REPLICATE });
    const inputImages = images || (image ? [image] : []);

    console.log('\n---Generating image-edit via Replicate Flux 2 Pro---');
    console.log('-Prompt:', userInput);
    console.log('-Number of Input Images:', inputImages.length);
    if (aspect_ratio) console.log('-Aspect Ratio:', aspect_ratio);
    console.log('-Resolution:', resolution || process.env.FLUX2PRO_RESOLUTION || '1 MP');
    if (output_format) console.log('-Output Format:', output_format);
    if (output_quality !== undefined) console.log('-Output Quality:', output_quality);

    const input = {
        prompt: userInput,
        input_images: inputImages,
        aspect_ratio: aspect_ratio || 'match_input_image',
        resolution: resolution || process.env.FLUX2PRO_RESOLUTION || '1 MP',
        output_format: output_format || 'jpg',
        output_quality: output_quality || 80,
        safety_tolerance: safety_tolerance !== undefined ? safety_tolerance : (process.env.FLUX2PRO_SAFETY_TOLERANCE ? Number(process.env.FLUX2PRO_SAFETY_TOLERANCE) : 2)
    };
    if (seed !== undefined && seed !== null) input.seed = seed;

    try {
        const prediction = await replicate.run('black-forest-labs/flux-2-pro', { input });
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
        console.error('Error generating image-edit with Replicate Flux 2 Pro:', error);
        throw error;
    }
}

module.exports = {
    generateImageViaReplicate_Flux2Pro,
    generateImageToImageViaReplicate_Flux2Pro,
    generateMultiReferenceImageViaReplicate_Flux2Pro,
    generateImageEditViaReplicate_Flux2Pro,
};
