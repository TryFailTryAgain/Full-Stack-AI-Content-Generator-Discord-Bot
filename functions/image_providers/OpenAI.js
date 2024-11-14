/* 
 * Author: TryFailTryAgain
 * Copyright (c) 2024. All rights reserved. For use in Open-Source projects this
 * may be freely copied or excerpted with credit to the author.
 */
const sharp = require('sharp');
const OpenAI = require('openai');
const { config, apiKeys } = require('../config.js');

const openAIImageKey = apiKeys.Keys.OpenAIImage;
const openaiImageBaseURL = config.Advanced.OpenAI_Image_Base_URL;

const openaiImage = new OpenAI({ apiKey: openAIImageKey });
openaiImage.baseURL = openaiImageBaseURL;

async function generateImageViaDallE3({ userInput, trueDimensions, numberOfImages, userID }) {
    // Log the parameters to the console
    console.log('\n---Generating image via Dall-E-3---');
    console.log('-User Input:', userInput);
    console.log('-True Dimensions:', trueDimensions);
    console.log('-Number of Images:', numberOfImages);
    console.log('-Hashed User ID:', userID);

    let imageBuffer = [];

    for (let i = 0; i < numberOfImages; i++) {
        const response = await openaiImage.images.generate({
            model: "dall-e-3",
            prompt: userInput,
            n: 1,
            size: trueDimensions,
            quality: "standard", // "standard" or "hd" TODO: Add this to command options
            style: "natural", // "natural" or "vivid  TODO: Add this to command options
            response_format: "b64_json",
            user: toString(userID),
        });
        // Process and save the generated image
        const saveBuffer = await sharp((Buffer.from(response.data[0].b64_json, 'base64')))[config.Advanced.Save_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
        const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);
        imageBuffer.push(processedBuffer);
    }
    console.log('Image Generated!');
    return imageBuffer;
}

module.exports = { generateImageViaDallE3 };
