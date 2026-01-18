const Replicate = require('replicate');
const sharp = require('sharp');
const { checkThenSave_ReturnSendImage } = require('../helperFunctions.js');

async function generateImageViaReplicate_Flux2Klein4b({ userInput, imageModel, numberOfImages, trueDimensions, output_format, output_quality, disable_safety_checker, seed, go_fast, width, height }) {
    const replicate = new Replicate({
        auth: process.env.API_KEY_REPLICATE,
    });

    console.log('\n---Generating image via Replicate Flux 2 Klein 4B---');
    console.log('-Prompt:', userInput);
    console.log('-Number of Images:', numberOfImages);
    console.log('-Aspect Ratio:', trueDimensions);
    console.log('-Output Format:', output_format);
    console.log('-Output Quality:', output_quality);
    console.log('-Seed:', seed);
    console.log('-Go Fast:', go_fast);
    if (trueDimensions === 'custom') {
        console.log('-Width:', width);
        console.log('-Height:', height);
    }

    const input = {
        prompt: userInput,
        aspect_ratio: trueDimensions,
        output_format: output_format,
        output_quality: output_quality,
        output_megapixels: '2',
        go_fast: go_fast !== undefined ? go_fast : false,
        disable_safety_checker: disable_safety_checker
    };

    // Add seed if provided
    if (seed !== undefined && seed !== null) {
        input.seed = seed;
    }

    // Add custom dimensions if aspect_ratio is 'custom'
    if (trueDimensions === 'custom') {
        if (width) input.width = width;
        if (height) input.height = height;
    }

    try {
        let imageBuffer = [];

        // Flux 2 Klein 4B doesn't support num_outputs, so we need to run multiple times
        for (let n = 0; n < numberOfImages; n++) {
            const prediction = await replicate.run(imageModel, { input });

            // Returns a single URL string, not an array
            const imageUrl = prediction;
            const response = await fetch(imageUrl);
            const arrayBuffer = await response.arrayBuffer();
            const saveBuffer = await sharp(Buffer.from(arrayBuffer))[process.env.ADVCONF_SAVE_IMAGES_AS]({ quality: parseInt(process.env.ADVCONF_JPEG_QUALITY) }).toBuffer();

            const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);
            imageBuffer.push(processedBuffer);
        }

        console.log('Image Generated!');
        return imageBuffer;

    } catch (error) {
        console.error('Error generating image with Replicate Flux 2 Klein 4B:', error);
        throw error;
    }
}

async function generateImageToImageViaReplicate_Flux2Klein4b({ images, image, userInput, strength, disable_safety_checker, go_fast, output_format, output_quality }) {
    let imageBuffer = [];
    const replicate = new Replicate({
        auth: process.env.API_KEY_REPLICATE,
    });
    // Support both single image (legacy) and multiple images
    const inputImages = images || (image ? [image] : []);

    console.log('\n---Generating image-2-Image via Replicate Flux 2 Klein 4B---');
    console.log('-User Input:', userInput);
    console.log('-Number of Input Images:', inputImages.length);
    console.log('-Strength:', strength);
    console.log('-Go Fast:', go_fast);

    try {
        const input = {
            prompt: userInput,
            images: inputImages, // Flux 2 Klein 4B uses images array (max 5)
            aspect_ratio: 'match_input_image', // Match the input image aspect ratio
            output_format: output_format || 'jpg',
            output_quality: output_quality || 80,
            output_megapixels: '2',
            go_fast: go_fast !== undefined ? go_fast : false,
            disable_safety_checker: disable_safety_checker
        };

        const prediction = await replicate.run('black-forest-labs/flux-2-klein-4b', { input });

        // Returns a single URL string
        const imageUrl = prediction;
        const response = await fetch(imageUrl);
        const arrayBuffer = await response.arrayBuffer();
        const saveBuffer = await sharp(Buffer.from(arrayBuffer))[process.env.ADVCONF_SAVE_IMAGES_AS]({ quality: parseInt(process.env.ADVCONF_JPEG_QUALITY) }).toBuffer();

        const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);
        imageBuffer.push(processedBuffer);

        console.log('Image-2-Image Generated!');
        return imageBuffer;

    } catch (error) {
        console.error('Error generating image with Replicate Flux 2 Klein 4B:', error);
        throw error;
    }
}

async function generateImageEditViaReplicate_Flux2Klein4b({ images, image, userInput, aspect_ratio, seed, output_format, output_quality, disable_safety_checker, go_fast }) {
    const replicate = new Replicate({ auth: process.env.API_KEY_REPLICATE });
    // Support both single image (legacy) and multiple images
    const inputImages = images || (image ? [image] : []);
    
    console.log('\n---Generating image-edit via Replicate Flux 2 Klein 4B---');
    console.log('-Prompt:', userInput);
    console.log('-Number of Input Images:', inputImages.length);
    if (aspect_ratio) console.log('-Aspect Ratio:', aspect_ratio);
    if (seed !== undefined) console.log('-Seed:', seed);
    if (output_format) console.log('-Output Format:', output_format);
    if (output_quality !== undefined) console.log('-Output Quality:', output_quality);
    if (disable_safety_checker !== undefined) console.log('-Disable Safety Checker:', disable_safety_checker);
    if (go_fast !== undefined) console.log('-Go Fast:', go_fast);

    const input = { 
        prompt: userInput, 
        images: inputImages, // Max 5 images
        output_megapixels: '2'
    };
    if (aspect_ratio) input.aspect_ratio = aspect_ratio;
    if (seed !== undefined) input.seed = seed;
    if (output_format) input.output_format = output_format;
    if (output_quality !== undefined) input.output_quality = output_quality;
    if (disable_safety_checker !== undefined) input.disable_safety_checker = disable_safety_checker;
    if (go_fast !== undefined) input.go_fast = go_fast;

    try {
        const prediction = await replicate.run('black-forest-labs/flux-2-klein-4b', { input });
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
        console.error('Error generating image-edit with Replicate Flux 2 Klein 4B:', error);
        throw error;
    }
}

module.exports = {
    generateImageViaReplicate_Flux2Klein4b,
    generateImageToImageViaReplicate_Flux2Klein4b,
    generateImageEditViaReplicate_Flux2Klein4b
};
