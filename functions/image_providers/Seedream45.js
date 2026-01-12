const Replicate = require('replicate');
const sharp = require('sharp');
const { checkThenSave_ReturnSendImage } = require('../helperFunctions.js');

async function generateImageViaReplicate_Seedream45({ userInput, size, aspect_ratio, sequential_image_generation, max_images }) {
    const replicate = new Replicate({ auth: process.env.API_KEY_REPLICATE });
    console.log('\n---Generating image via Replicate Seedream-4.5---');
    console.log('-Prompt:', userInput);
    if (size) console.log('-Size:', size);
    if (aspect_ratio) console.log('-Aspect Ratio:', aspect_ratio);
    if (sequential_image_generation) console.log('-Sequential Image Generation:', sequential_image_generation);
    if (max_images) console.log('-Max Images:', max_images);

    const input = { prompt: userInput };
    if (size) input.size = size;
    if (aspect_ratio) input.aspect_ratio = aspect_ratio;
    if (sequential_image_generation) input.sequential_image_generation = sequential_image_generation;
    if (max_images) input.max_images = max_images;

    try {
        const prediction = await replicate.run('bytedance/seedream-4.5', { input });
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
        console.error('Error generating image with Replicate Seedream-4.5:', error);
        throw error;
    }
}

async function generateImageToImageViaReplicate_Seedream45({ images, userInput, size, aspect_ratio, sequential_image_generation, max_images }) {
    const replicate = new Replicate({ auth: process.env.API_KEY_REPLICATE });
    console.log('\n---Generating image-to-image via Replicate Seedream-4.5---');
    console.log('-Prompt:', userInput);
    console.log('-Input Images:', images.length);
    if (size) console.log('-Size:', size);
    if (aspect_ratio) console.log('-Aspect Ratio:', aspect_ratio);
    if (sequential_image_generation) console.log('-Sequential Image Generation:', sequential_image_generation);
    if (max_images) console.log('-Max Images:', max_images);

    const input = { prompt: userInput, image_input: images };
    if (size) input.size = size;
    if (aspect_ratio) input.aspect_ratio = aspect_ratio;
    if (sequential_image_generation) input.sequential_image_generation = sequential_image_generation;
    if (max_images) input.max_images = max_images;

    try {
        const prediction = await replicate.run('bytedance/seedream-4.5', { input });
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
        console.error('Error generating image-to-image with Replicate Seedream-4.5:', error);
        throw error;
    }
}

async function generateImageEditViaReplicate_Seedream45({ images, userInput, size, aspect_ratio }) {
    const replicate = new Replicate({ auth: process.env.API_KEY_REPLICATE });
    console.log('\n---Generating image-edit via Replicate Seedream-4.5---');
    console.log('-Prompt:', userInput);
    console.log('-Input Images:', images.length);
    if (size) console.log('-Size:', size);
    if (aspect_ratio) console.log('-Aspect Ratio:', aspect_ratio);

    const input = { prompt: userInput, image_input: images };
    if (size) input.size = size;
    if (aspect_ratio) input.aspect_ratio = aspect_ratio;
    input.sequential_image_generation = 'disabled';
    input.max_images = 1;

    try {
        const prediction = await replicate.run('bytedance/seedream-4.5', { input });
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
        console.error('Error generating image-edit with Replicate Seedream-4.5:', error);
        throw error;
    }
}

module.exports = { 
    generateImageViaReplicate_Seedream45,
    generateImageToImageViaReplicate_Seedream45,
    generateImageEditViaReplicate_Seedream45
};
