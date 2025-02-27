const Replicate = require('replicate');
const sharp = require('sharp');
const { checkThenSave_ReturnSendImage } = require('../helperFunctions.js');

const apiKeys = { Keys: { Replicate: process.env.API_KEY_REPLICATE } };

async function generateImageViaReplicate_FluxSchnell({ userInput, imageModel, numberOfImages, trueDimensions, output_format, output_quality, disable_safety_checker }) {
    const replicate = new Replicate({
        auth: apiKeys.Keys.Replicate,
    });
    console.log('\n---Generating image via Replicate Flux Schnell---');
    console.log('-Prompt:', userInput);
    console.log('-Number of Images:', numberOfImages);
    console.log('-Aspect Ratio:', trueDimensions);
    console.log('-Output Format:', output_format);
    console.log('-Output Quality:', output_quality);

    const input = {
        prompt: userInput,
        num_outputs: numberOfImages,
        aspect_ratio: trueDimensions,
        output_format: output_format,
        output_quality: output_quality,
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
        console.error('Error generating image with Replicate:', error);
        throw error;
    }
}

module.exports = { generateImageViaReplicate_FluxSchnell };
