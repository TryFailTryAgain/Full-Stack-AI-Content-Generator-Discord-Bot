const sharp = require('sharp');
const { checkThenSave_ReturnSendImage } = require('../helperFunctions.js');


async function generateImageViaStabilityAIv1({ userInput, negativePrompt, trueDimensions, imageModel, numberOfImages, cfg, steps, seed, userID }) {
    const apiHost = 'https://api.stability.ai';
    let imageBuffer = [];
    let promises = [];
    const [width, height] = trueDimensions.split('x').map(Number);
    if (negativePrompt == null) negativePrompt = "bad quality, low resolution, low quality, blurry, lowres, jpeg artifacts, warped image, worst quality";

    // Log the parameters to the console
    console.log('\n---Generating image via StabilityAI API v1---');
    console.log('-User Input:', userInput);
    console.log('-Negative Prompt:', negativePrompt);
    console.log('-True Dimensions:', trueDimensions);
    console.log('-Image Model:', imageModel);
    console.log('-Number of Images:', numberOfImages);
    console.log('-CFG Scale:', cfg);
    console.log('-Steps:', steps);
    console.log('-Seed:', seed);
    console.log('-Hashed User ID:', userID);

    await fetch(`${apiHost}/v1/generation/${imageModel}/text-to-image`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: process.env.API_KEY_STABILITYAI,
            'Stability-Client-ID': userID,
        },
        body: JSON.stringify({
            text_prompts: [
                {
                    text: userInput,
                },
                {
                    "text": negativePrompt,
                    "weight": -1
                }
            ],
            cfg_scale: cfg,
            width: width,
            height: height,
            steps: steps,
            samples: numberOfImages,
            seed: seed,
        }),
    })
        .then(async (response) => {
            if (!response.ok) {
                throw new Error(`Non-200 response: ${await response.text()}`);
            }
            // Process and save the generated image
            const responseJSON = await response.json();
            for (const [index, image] of responseJSON.artifacts.entries()) {
                const promise = (async () => {
                    const saveBuffer = await sharp(Buffer.from(image.base64, 'base64'))[process.env.ADVCONF_SAVE_IMAGES_AS]({ quality: parseInt(process.env.ADVCONF_JPEG_QUALITY) }).toBuffer();
                    const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);
                    imageBuffer.push(processedBuffer);
                })();
                promises.push(promise);
            }
        })
        .catch((error) => {
            console.error(error);
            throw new Error(`Error: ${error}`);
        });
    await Promise.allSettled(promises);
    console.log('Image Generated!');
    return imageBuffer;
}


async function searchAndReplace(image, search, replace, negative_prompt, userID) {
    let imageBuffer = [];
    console.log("---Searching and replacing image via Stable Diffusion 3.0---");
    console.log("--Sending generation request to StabilityAI with the following parameters: \n" +
        "-Search: " + search + "\n" +
        "-Replace: " + replace + "\n" +
        "-User ID: " + userID + "\n\n");

    const apiUrl = `https://api.stability.ai/v2beta/stable-image/edit/search-and-replace`;

    const formData = new FormData();
    formData.append('prompt', replace);
    formData.append('search_prompt', search);
    formData.append('image', image, { filename: 'image.' + process.env.ADVCONF_SEND_IMAGES_AS, contentType: 'image/' + process.env.ADVCONF_SEND_IMAGES_AS });
    formData.append('output_format', 'png');
    formData.append('negative_prompt', negative_prompt);

    const response = await fetch(apiUrl, {
        method: 'POST',
        body: formData,
        headers: {
            Authorization: process.env.API_KEY_STABILITYAI,
            Accept: "image/*",
            ...formData.getHeaders(),
        },
    });
    const arrayBuffer = await response.arrayBuffer();

    if (response.ok) {
        const saveBuffer = await sharp(Buffer.from(arrayBuffer))[process.env.ADVCONF_SAVE_IMAGES_AS]({ quality: parseInt(process.env.ADVCONF_JPEG_QUALITY) }).toBuffer();
        // Saves images to disk if the setting is enabled, otherwise only send them to Discord
        const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);
        imageBuffer.push(processedBuffer);
    } else {
        throw new Error(`${response.status}: ${response.statusText}`);
    }
    console.log('Image Generated!');
    return imageBuffer;
}

module.exports = {
    generateImageViaStabilityAIv1,
    searchAndReplace
};
