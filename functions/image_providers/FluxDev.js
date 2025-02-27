const Replicate = require('replicate');
const sharp = require('sharp');
const { checkThenSave_ReturnSendImage } = require('../helperFunctions.js');

async function generateImageViaReplicate_FluxDev({ userInput, imageModel, numberOfImages, trueDimensions, output_format, output_quality, disable_safety_checker, seed, prompt_strength, num_inference_steps }) {
    const replicate = new Replicate({
        auth: process.env.API_KEY_REPLICATE,
    });

    console.log('\n---Generating image via Replicate Flux Dev---');
    console.log('-Prompt:', userInput);
    console.log('-Number of Images:', numberOfImages);
    console.log('-Aspect Ratio:', trueDimensions);
    console.log('-Output Format:', output_format);
    console.log('-Output Quality:', output_quality);
    console.log('-Seed:', seed);
    console.log('-Prompt Strength:', prompt_strength);
    console.log('-Inference Steps:', num_inference_steps);

    const input = {
        prompt: userInput,
        num_outputs: numberOfImages,
        aspect_ratio: trueDimensions,
        output_format: output_format,
        output_quality: output_quality,
        seed: seed,
        //prompt_strength: prompt_strength,
        //num_inference_steps: num_inference_steps,
        disable_safety_checker: disable_safety_checker
    };

    try {
        const prediction = await replicate.run(imageModel, { input });

        let imageBuffer = [];
        for (let i = 0; i < prediction.length; i++) {
            const imageUrl = prediction[i];
            const response = await fetch(imageUrl);
            const arrayBuffer = await response.arrayBuffer();
            const saveBuffer = await sharp(Buffer.from(arrayBuffer))[process.env.ADVCONF_SAVE_IMAGES_AS]({ quality: parseInt(process.env.ADVCONF_JPEG_QUALITY) }).toBuffer();

            const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);
            imageBuffer.push(processedBuffer);
        }
        console.log('Image Generated!');
        return imageBuffer;

    } catch (error) {
        console.error('Error generating image with Replicate Flux Dev:', error);
        throw error;
    }
}

async function generateImageToImageViaReplicate_FluxDev({ image, userInput, strength, disable_safety_checker }) {
    let imageBuffer = [];
    const replicate = new Replicate({
        auth: process.env.API_KEY_REPLICATE,
    });

    console.log('\n---Generating image-2-Image via Replicate Flux Dev---');
    console.log('-User Input:', userInput);
    console.log('-Strength:', strength);

    try {
        const input = {
            prompt: userInput,
            image: image,
            strength: strength,
            num_outputs: 1,
            disable_safety_checker: disable_safety_checker
        };

        const prediction = await replicate.run('black-forest-labs/flux-dev', { input });

        for (let i = 0; i < prediction.length; i++) {
            const imageUrl = prediction[i];
            const response = await fetch(imageUrl);
            const arrayBuffer = await response.arrayBuffer();
            const saveBuffer = await sharp(Buffer.from(arrayBuffer))[process.env.ADVCONF_SAVE_IMAGES_AS]({ quality: parseInt(process.env.ADVCONF_JPEG_QUALITY) }).toBuffer();

            const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);
            imageBuffer.push(processedBuffer);
        }
        console.log('Image-2-Image Generated!');
        return imageBuffer;

    } catch (error) {
        console.error('Error generating image with Replicate Flux Dev:', error);
        throw error;
    }
}

module.exports = {
    generateImageViaReplicate_FluxDev,
    generateImageToImageViaReplicate_FluxDev
};
