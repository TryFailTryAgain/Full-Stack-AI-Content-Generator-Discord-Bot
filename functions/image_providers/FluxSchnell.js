/* 
 * Author: TryFailTryAgain
 * Copyright (c) 2024. All rights reserved. For use in Open-Source projects this
 * may be freely copied or excerpted with credit to the author.
 */
const Replicate = require('replicate');
const sharp = require('sharp');
const { config, apiKeys } = require('../config.js');
const { checkThenSave_ReturnSendImage } = require('../helperFunctions.js');

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
            const saveBuffer = await sharp(Buffer.from(arrayBuffer))[config.Advanced.Save_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();

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
