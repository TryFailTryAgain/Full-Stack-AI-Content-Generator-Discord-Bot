/* 
 * Author: TryFailTryAgain
 * Copyright (c) 2024. All rights reserved. For use in Open-Source projects this
 * may be freely copied or excerpted with credit to the author.
 */
const axios = require('axios');
const sharp = require('sharp');
const FormData = require('form-data'); // Added import
const fs = require('fs'); // Added import if needed
const { config, apiKeys } = require('../config.js');
const { checkThenSave_ReturnSendImage } = require('../helperFunctions');

const StabilityAIKey = apiKeys.Keys.StabilityAI;

async function generateImageViaSD3({ userInput, negativePrompt, trueDimensions, imageModel, numberOfImages }) {
    const apiUrl = 'https://api.stability.ai/v2beta/stable-image/generate/sd3';
    let imageBuffer = [];
    if (negativePrompt == "") negativePrompt = "bad quality, low resolution, low quality, blurry, lowres, jpeg artifacts, warped image, worst quality";

    // Log the parameters to the console
    console.log('\n---Generating image via StabilityAI APIv2---');
    console.log('-User Input:', userInput);
    console.log('-Negative Prompt:', negativePrompt);
    console.log('-True Dimensions:', trueDimensions);
    console.log('-Image Model:', imageModel);
    console.log('-Number of Images:', numberOfImages);

    for (let i = 0; i < numberOfImages; i++) {
        const payload = {
            model: imageModel,
            prompt: userInput,
            output_format: "png",
            mode: "text-to-image",
            aspect_ratio: trueDimensions,
            negativePrompt: negativePrompt,
        };

        const response = await axios.postForm(
            apiUrl,
            axios.toFormData(payload, new FormData()),
            {
                validateStatus: undefined,
                responseType: "arraybuffer",
                headers: {
                    Authorization: StabilityAIKey,
                    Accept: "image/*",
                },
            }
        );

        if (response.status === 200) {
            const saveBuffer = await sharp(Buffer.from(response.data))[config.Advanced.Save_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
            const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);
            imageBuffer.push(processedBuffer);
        } else {
            console.error('Error Response:', response.data.toString());
            throw new Error(`${response.status}: ${response.data.toString()}`);
        }
    }
    console.log('Image Generated!');
    return imageBuffer;
}

const isUrl = (string) => {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
};

async function generateImageToImageViaStabilityAISD3({ userInput, negativePrompt, imageModel, strength, image, numberOfImages }) {
    const apiUrl = 'https://api.stability.ai/v2beta/stable-image/generate/sd3';
    let imageBuffer = [];
    if (negativePrompt === "") negativePrompt = "bad quality, low resolution, low quality, blurry, lowres, jpeg artifacts, warped image, worst quality";

    console.log('\n---Generating image via StabilityAI APIv2 Image-to-Image---');
    console.log('-User Input:', userInput);
    console.log('-Negative Prompt:', negativePrompt);
    console.log('-Image Model:', imageModel);
    console.log('-Strength:', strength);
    console.log('-Number of Images:', numberOfImages);

    for (let i = 0; i < numberOfImages; i++) {   
        let processedImageBuffer;
        if (isUrl(image)) {
            // Fetch image from URL
            const response = await axios.get(image, { responseType: 'arraybuffer' });
            processedImageBuffer = await sharp(Buffer.from(response.data)).webp().toBuffer();
        } else {
            processedImageBuffer = image;
        }
        
        const form = new FormData();
        form.append('model', imageModel);
        form.append('prompt', userInput);
        form.append('strength', strength);
        form.append('output_format', 'png');
        form.append('mode', 'image-to-image');
        form.append('negativePrompt', negativePrompt);
        form.append('image', processedImageBuffer, {
            filename: 'image.png',
            contentType: 'image/png'
        });

        const response = await axios.post(
            apiUrl,
            form,
            {
                headers: {
                    ...form.getHeaders(),
                    Authorization: StabilityAIKey,
                    Accept: "image/*",
                },
                responseType: "arraybuffer",
                validateStatus: undefined,
            }
        );

        if (response.status === 200) {
            const saveBuffer = await sharp(Buffer.from(response.data))[config.Advanced.Save_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
            const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);
            imageBuffer.push(processedBuffer);
        } else {
            console.error('Error Response:', response.data.toString());
            throw new Error(`${response.status}: ${response.data.toString()}`);
        }
    }
    console.log('Image-to-Image Generated!');
    return imageBuffer;
}

module.exports = { generateImageViaSD3, generateImageToImageViaStabilityAISD3 };
