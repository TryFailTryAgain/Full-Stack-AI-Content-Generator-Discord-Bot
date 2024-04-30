// File: image_functions.js
// Author: TryFailTryAgain
// Copyright (c) 2024. All rights reserved. For use in Open-Source projects this
// may be freely copied or excerpted with credit to the author.

/* Getting required modules */
const fs = require('fs');
const ini = require('ini');
const Filter = require('bad-words');
const filter = new Filter({ placeHolder: '*' }); // Modify the character used to replace bad words
const Crypto = require('crypto');
const OpenAI = require('openai');
const sharp = require('sharp');
const FormData = require('form-data');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const axios = require('axios');
/* End getting required modules */

/* Some global variables for ease of access */

// File paths
const SETTINGS_FILE_PATH = './settings.ini';
const API_KEYS_FILE_PATH = './api_keys.ini';

/* Acquiring Global values */
const config = getIniFileContent(SETTINGS_FILE_PATH);
const apiKeys = getIniFileContent(API_KEYS_FILE_PATH);

// Validate API keys
validateApiKeys(apiKeys);
const StabilityAIKey = apiKeys.Keys.StabilityAI;
const openAIChatKey = apiKeys.Keys.OpenAIChat;
const openAIImageKey = apiKeys.Keys.OpenAIImage;

// Get base URL for the API
const openaiChatBaseURL = config.Advanced.OpenAI_Chat_Base_URL;
const openaiImageBaseURL = config.Advanced.OpenAI_Image_Base_URL;
// Set the API keys for OpenAI and the base URL
const openaiChat = new OpenAI({ apiKey: openAIChatKey });
openaiChat.baseURL = openaiChatBaseURL;
const openaiImage = new OpenAI({ apiKey: openAIImageKey });
openaiImage.baseURL = openaiImageBaseURL;

// This is a profanity filter that will prevent the bot from passing profanity and other rude words to the generator
// It can be enabled or disabled in the config.json file
const profanityFilterEnabled = filterCheck();
const saveToDiskEnabled = saveToDiskCheck();
console.log(`Profanity filter -- /image == ${profanityFilterEnabled ? 'ENABLED' : 'DISABLED'}`);
console.log(`Save images to disk -- /image == ${saveToDiskEnabled ? 'ENABLED' : 'DISABLED'}`);
/* End of Acquiring values */


/* Functions */
async function generateImage(userInput, negativePrompt, imageModel, dimensions, numberOfImages, cfg, steps, seed, userID) {
    // Creates an empty array to store the image buffers in
    let imageBuffer = [];
    // Generates a randomID integer to be used in the file name for identification
    randomID.generate();
    // Get the correct dimensions for the image
    const trueDimensions = getDimensions(imageModel, dimensions);
    // Generate a hashed user ID to send to openai instead of the original user ID
    const hashedUserID = await generateHashedUserId(userID);

    if (imageModel == "dall-e-3") {
        imageBuffer = await generateImageViaDallE3(userInput, trueDimensions, numberOfImages, hashedUserID, randomID);
    } else if (imageModel == "stable-diffusion-v1-6" || imageModel == "stable-diffusion-xl-1024-v1-0") {
        imageBuffer = await generateImageViaStabilityAIv1(userInput, negativePrompt, trueDimensions, imageModel, numberOfImages, cfg, steps, seed, hashedUserID, randomID);
    } else if (imageModel == "sd3" || imageModel == "sd3-turbo") {
        imageBuffer = await generateImageViaSD3(userInput, negativePrompt, trueDimensions, imageModel, numberOfImages, randomID);
    }

    return imageBuffer;
}

// Function to generate an image via Dall-E-3
async function generateImageViaDallE3(userInput, trueDimensions, numberOfImages, hashedUserID, randomID) {
    // Log the parameters to the console
    console.log('\n---Generating image via Dall-E-3---');
    console.log('-User Input:', userInput);
    console.log('-True Dimensions:', trueDimensions);
    console.log('-Number of Images:', numberOfImages);
    console.log('-Hashed User ID:', hashedUserID);

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
            user: toString(hashedUserID),
        });
        // Process and save the generated image
        const saveBuffer = await sharp((Buffer.from(response.data[0].b64_json, 'base64')))[config.Advanced.Save_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
        if (saveToDiskCheck()) {
            fs.writeFileSync(
                `./Outputs/txt2img_${randomID.get()}_${i + 1}.${config.Advanced.Save_Images_As}`,
                saveBuffer
            );
        }
        if (config.Advanced.Save_Images_As == config.Advanced.Send_Images_As) {
            imageBuffer.push(saveBuffer);
        } else {
            const sendBuffer = await sharp(saveBuffer)[config.Advanced.Send_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
            imageBuffer.push(sendBuffer);
        }
    }
    console.log("RETURNING");
    return imageBuffer;
}

// Function to generate an image via StabilityAI v1
async function generateImageViaStabilityAIv1(userInput, negativePrompt, trueDimensions, imageModel, numberOfImages, cfg, steps, seed, hashedUserID, randomID) {
    const apiHost = 'https://api.stability.ai';
    let imageBuffer = [];
    let promises = [];
    const [width, height] = trueDimensions.split('x').map(Number);
    if (negativePrompt == "") negativePrompt = "bad quality, low resolution, low quality, blurry, lowres, jpeg artifacts, warped image, worst quality";

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
    console.log('-Hashed User ID:', hashedUserID);

    await fetch(`${apiHost}/v1/generation/${imageModel}/text-to-image`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: StabilityAIKey,
            'Stability-Client-ID': hashedUserID,
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
                    const saveBuffer = await sharp(Buffer.from(image.base64, 'base64'))[config.Advanced.Save_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
                    if (saveToDiskCheck()) {
                        fs.writeFileSync(
                            `./Outputs/txt2img_${randomID.get()}_${index + 1}.${config.Advanced.Save_Images_As}`,
                            saveBuffer
                        );
                    }
                    if (config.Advanced.Save_Images_As == config.Advanced.Send_Images_As) {
                        imageBuffer.push(saveBuffer);
                    } else {
                        const sendBuffer = await sharp(saveBuffer)[config.Advanced.Send_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
                        imageBuffer.push(sendBuffer);
                    }
                })();
                promises.push(promise);
            }
        })
        .catch((error) => {
            console.error(error);
            throw new Error(`Error: ${error}`);
        });
    await Promise.allSettled(promises);
    return imageBuffer;
}

// Function to generate an image via Stable Diffusion 3.0
async function generateImageViaSD3(userInput, negativePrompt, trueDimensions, imageModel, numberOfImages, randomID) {
    const apiUrl = `https://api.stability.ai/v2beta/stable-image/generate/sd3`;
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
        const formData = new FormData();
        formData.append("model", imageModel);
        formData.append("prompt", userInput);
        formData.append("output_format", "png");
        formData.append("mode", "text-to-image");
        formData.append("aspect_ratio", trueDimensions);
        if (imageModel == "sd3") { // Only append to supported models
            formData.append("negative_prompt", negativePrompt);
        }

        const response = await axios.post(
            apiUrl,
            formData,
            {
                responseType: "arraybuffer",
                headers: {
                    Authorization: StabilityAIKey,
                    Accept: "image/*",
                    ...formData.getHeaders(),
                },
            }
        );
        // Process and save the generated image
        if (response.status === 200) {
            const saveBuffer = await sharp(Buffer.from(response.data))[config.Advanced.Save_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
            if (saveToDiskCheck()) {
                const filePath = `./Outputs/txt2img_${randomID.get()}_${i + 1}.${config.Advanced.Save_Images_As}`;
                await fs.promises.writeFile(filePath, saveBuffer);
            }
            if (config.Advanced.Save_Images_As == config.Advanced.Send_Images_As) {
                imageBuffer.push(saveBuffer);
            } else {
                const sendBuffer = await sharp(Buffer.from(response.data))[config.Advanced.Send_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
                imageBuffer.push(sendBuffer);
            }
        } else {
            throw new Error(`${response.status}: ${response.data.toString()}`);
        }
    }
    return imageBuffer;
}

//Documentation
// https://platform.stability.ai/docs/api-reference#tag/v1generation/operation/imageToImage
async function generateImageToImage(imageFile, userInput, negativePrompt, strength, seed, userID) {
    let imageBuffer = [];

    console.log("---Generating image via Stable Diffusion 3.0---");
    console.log("\n\n--Sending generation request to StabilityAI with the following parameters: \n" +
        "-Prompt: " + userInput + "\n" +
        "-Negative Prompt: " + negativePrompt + "\n" +
        "-Strength: " + strength + "\n" +
        "-Seed: " + seed + "\n" +
        "-Image Model: " + "SD3" + "\n\n"); // TODO: Add the image model to use the same as the text-to-image

    const apiUrl = `https://api.stability.ai/v2beta/stable-image/generate/sd3`;

    const formData = new FormData();
    formData.append('prompt', userInput);
    formData.append('image', imageFile, { filename: 'image.' + config.Advanced.Send_Images_As, contentType: 'image/' + config.Advanced.Send_Images_As });
    formData.append('output_format', 'png');
    formData.append('mode', 'image-to-image');
    formData.append('negative_prompt', negativePrompt);
    formData.append('strength', strength);
    formData.append('seed', seed);
    formData.append('model', 'sd3');

    const response = await axios.post(
        apiUrl,
        formData,
        {
            validateStatus: undefined,
            responseType: "arraybuffer",
            headers: {
                Authorization: StabilityAIKey,
                Accept: "image/*",
                ...formData.getHeaders(),
            },
        },
    );

    if (response.status === 200) {
        const saveBuffer = await sharp(Buffer.from(response.data))[config.Advanced.Save_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
        // Saves images to disk if the setting is enabled, otherwise only send them to Discord
        if (saveToDiskCheck()) {
            const filePath = `./Outputs/txt2img_${randomID.get()}_.${config.Advanced.Save_Images_As}`;
            await fs.promises.writeFile(filePath, saveBuffer);
            console.log(`Saved Image: ${filePath}`);
        }

        // Convert the image to the specified format for sending
        // If Save and Send are the same then don't convert it again
        if (config.Advanced.Save_Images_As == config.Advanced.Send_Images_As) {
            imageBuffer.push(saveBuffer);
        } else {
            const sendBuffer = await sharp(Buffer.from(response.data))[config.Advanced.Send_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
            imageBuffer.push(sendBuffer);
        }
    } else {
        throw new Error(`${response.status}: ${response.data.toString()}`);
    }
    return imageBuffer;
}

// Documentation:
// https://platform.stability.ai/docs/api-reference#tag/Edit/paths/~1v2beta~1stable-image~1edit~1search-and-replace/post
async function searchAndReplace(imageFile, search, replace, negative_prompt, userID) {
    let imageBuffer = [];
    console.log("---Searching and replacing image via Stable Diffusion 3.0---");
    console.log("--Sending generation request to StabilityAI with the following parameters: \n" +
        "-Search: " + search + "\n" +
        "-Replace: " + replace + "\n" +
        "-User ID: " + userID + "\n\n");
    //TODO: add the api call and image processing
    const apiUrl = `https://api.stability.ai/v2beta/stable-image/edit/search-and-replace`;

    const formData = new FormData();
    formData.append('prompt', replace);
    formData.append('search_prompt', search);
    formData.append('image', imageFile, { filename: 'image.' + config.Advanced.Send_Images_As, contentType: 'image/' + config.Advanced.Send_Images_As });
    formData.append('output_format', 'png');
    formData.append('negative_prompt', negative_prompt);

    const response = await axios.post(
        apiUrl,
        formData,
        {
            validateStatus: undefined,
            responseType: "arraybuffer",
            headers: {
                Authorization: StabilityAIKey,
                Accept: "image/*",
                ...formData.getHeaders(),
            },
        },
    );

    if (response.status === 200) {
        const saveBuffer = await sharp(Buffer.from(response.data))[config.Advanced.Save_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
        // Saves images to disk if the setting is enabled, otherwise only send them to Discord
        if (saveToDiskCheck()) {
            const filePath = `./Outputs/txt2img_${randomID.get()}_.${config.Advanced.Save_Images_As}`;
            await fs.promises.writeFile(filePath, saveBuffer);
            console.log(`Saved Image: ${filePath}`);
        }

        // Convert the image to the specified format for sending
        // If Save and Send are the same then don't convert it again
        if (config.Advanced.Save_Images_As == config.Advanced.Send_Images_As) {
            imageBuffer.push(saveBuffer);
        } else {
            const sendBuffer = await sharp(Buffer.from(response.data))[config.Advanced.Send_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
            imageBuffer.push(sendBuffer);
        }
    } else {
        throw new Error(`${response.status}: ${response.data.toString()}`);
    }
    return imageBuffer;
}

// Documentation:
// https://platform.stability.ai/docs/api-reference#tag/v1generation/operation/upscaleImage
async function upscaleImage(imageBuffer, width) {
    const engineId = 'esrgan-v1-x2plus';

    // Grab the randomID of the previous generation to be used in the file name to correlate it with 
    // the original image
    console.log("Upscaled image will should have identical Random ID: " + randomID.get());

    // Check if the width if over 2048px
    if (width >= 2048) {
        throw new Error("The image is too large to upscale. Please use an image that is smaller than 2048px tall or wide");
    }
    // Creates the form data that contains the image, width, file type, and authorization
    const formData = new FormData();
    formData.append('image', imageBuffer, { contentType: 'image/png' });
    formData.append('width', imageBuffer.width * 2);

    const response = await fetch(
        `${apiHost}/v1/generation/${engineId}/image-to-image/upscale`,
        {
            method: 'POST',
            headers: {
                Accept: 'image/png',
                Authorization: `${StabilityAIKey}`,
            },
            body: formData,
        }
    );
    if (!response.ok) {
        throw new Error(`Non-200 response: ${await response.text()}`);
    }

    const image = await response.arrayBuffer();
    if (saveToDiskCheck()) {
        fs.writeFileSync(
            `./Outputs/upscaled_${randomID.get()}_0.png`,
            Buffer.from(image)
        );
        console.log(`Saved Image: ./Outputs/upscaled_${randomID.get()}_0.png`);
    }
    const newImageBuffer = [Buffer.from(image)];
    return newImageBuffer;
}

// Function to optimize the prompt using openai's API
async function promptOptimizer(userInput, userID) {
    // Send the prompt to openai's API to optimize it
    console.log("--Optimizing prompt--");
    // Get some values from settings.ini to define the model and the messages to send to openai
    const Prompt_Model = config.Image_command_settings.Prompt_Model;
    const temperature = config.Image_command_settings.Optimizer_Temperature;
    const systemMessage = config.Image_command_settings.System_Message;
    const userMessage = config.Image_command_settings.User_Message;

    // Generate a hashed user ID to send to openai instead of the original user ID
    const hashedUserID = await generateHashedUserId(userID);
    let response = null;

    try {
        response = await openaiChat.chat.completions.create({
            model: Prompt_Model,
            messages: [
                {
                    // Remember that you are responsible for your own generations. This prompt comes with no liability or warranty.
                    "role": "system",
                    "content": systemMessage
                },
                {
                    // Remember that you are responsible for your own generations. This prompt comes with no liability or warranty.
                    "role": "user",
                    "content": userMessage + userInput
                }
            ],
            temperature: Number(temperature),
            max_tokens: 300,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
            // Send the hashed string instead of the original string
            user: toString(hashedUserID),
        });
    } catch (error) {
        console.error(error);
        // Throws another error to be caught when the function is called
        throw new Error(`Error: ${error}`);
    }
    let optimized_Prompt = response.choices[0].message.content;
    // Filter the returned optimized prompt. Just in case the AI is unhappy today
    if (await filterCheck()) {
        optimized_Prompt = await filterString(optimized_Prompt);
    }
    return optimized_Prompt;
}


// Function to adapt the image prompt used for image generation to align with the users input as requested via chat refinement
async function adaptImagePrompt(currentPrompt, chatRefinementRequest, userID) {
    console.log("--Adapting the prompt based on chat request--");
    // Get some values from settings.ini to define the model and the messages to send to openai
    const Prompt_Model = config.Image_command_settings.Prompt_Model;
    const temperature = config.Image_command_settings.Optimizer_Temperature;
    const systemMessage = config.Image_command_settings.ChatRefinementSystemMessage;
    const userMessage = config.Image_command_settings.ChatRefinementUserMessage;

    // Filter the input request
    if (await filterCheck()) chatRefinementRequest = await filterString(chatRefinementRequest);
    // Generate a hashed user ID to send to openai instead of the original user ID
    const hashedUserID = await generateHashedUserId(userID);
    let response = null;
    try {
        response = await openaiChat.chat.completions.create({
            model: Prompt_Model,
            messages: [
                {
                    // Remember that you are responsible for your own generations. This prompt comes with no liability or warranty.
                    "role": "system",
                    "content": systemMessage
                },
                {
                    // Remember that you are responsible for your own generations. This prompt comes with no liability or warranty.
                    "role": "user",
                    "content": userMessage.replace('[sdPrompt]', currentPrompt).replace('[refinementRequest]', chatRefinementRequest)
                }
            ],
            temperature: Number(temperature),
            max_tokens: 300,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
            // Send the hashed string instead of the original string
            user: toString(hashedUserID),
        });
    } catch (error) {
        console.error(error);
        // Throws another error to be caught when the function is called
        throw new Error(`Error: ${error}`);
    }
    // Filter the response if the profanity filter is enabled just in case the ai is having a bad day
    refinedPrompt = response.choices[0].message.content;
    if (await filterCheck()) refinedPrompt = await filterString(response.choices[0].message.content);

    console.log("Original prompt: \n" + currentPrompt + "\n" +
        "Refined prompt:  \n" + refinedPrompt + "\n");

    return refinedPrompt;
}


// Function to check if the profanity filter is enabled or disabled from the settings.ini file
async function filterCheck() {
    const inputFilter = config.Advanced.Filter_Naughty_Words.toLowerCase();

    // Alert console if the profanity filter is enabled or disabled
    if (inputFilter === 'true') {
        return true;
    } else if (inputFilter === 'false') {
        return false;
    } else {
        throw new Error("The Filter_Naughty_Words setting in settings.ini is not set to true or false. Please set it to true or false");
    }
}

// Function to filter the prompt for profanity and other words provided in node_modules/bad-words/lib/lang.json file
// TODO: Add a section to add custom words to the filter in the settings config that will be imported here
async function filterString(input) {
    try {
        console.log("--Filtering string--\n");
        input = (filter.clean(input)).toString();
        // Removes the asterisks that the filter replaces the bad words with. Somehow this is not built into the filter to my knowledge
        input = input.replace(/\*/g, '');
        console.log("-The string after filtering is:\n" + input + "\n");
    } catch (error) {
        console.error(error);
        // Throws another error to be caught when the function is called
        throw new Error(`Error: ${error}`);
    }
    return input;
}

// Function to generate a hashed user ID to send to openai instead of the original user ID
// This is to protect the users privacy and to help incase of policy violations with OpenAI
// TODO: Add a setting to disable this in the settings config file
async function generateHashedUserId(userId) {
    // Get the salt from settings.ini
    const salt = config.Advanced.Salt;
    // Generate the hash
    const hash = Crypto.pbkdf2Sync(userId, salt, 1000, 64, 'sha512');

    // Convert the hash to a hexadecimal string
    const hashedUserId = hash.toString('hex');
    //console.log("Hashed user ID: " + hashedUserId);
    return hashedUserId;
}

// Gets the API balance from StabilityAI
async function getBalance() {
    const url = `https://api.stability.ai/v1/user/balance`
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Authorization: `${StabilityAIKey}`,
        },
    })

    if (!response.ok) {
        throw new Error(`Non-200 response: ${await response.text()}`)
    }

    const balance = await response.json();
    return balance.credits;
}

// Function to inject a message into what is being sent if they are low on API credits
async function lowBalanceMessage() {
    const balance = await getBalance();
    let message = '';
    switch (true) {
        case (balance < 100):
            message = 'Almost out of api credits, please consider sending your bot host a few bucks to keep me running ❤️';
            break;
        case (balance < 300):
            message = 'Consider funding your bot host $1 ❤️';
            break;
        default:
            break;
    }
    return message;
}

// Check if the user wants to save the images to disk or not
async function saveToDiskCheck() {
    const saveImages = config.Advanced.Save_Images.toLowerCase();
    if (saveImages === 'true') {
        return true;
    } else if (saveImages === 'false') {
        return false;
    } else {
        throw new Error("The Save_Images setting in settings.ini is not set to true or false. Please set it to true or false");
    }
}

// Random ID generator for image file names
const randomID = {
    id: null,
    generate: function () {
        this.id = Math.floor(Math.random() * 1000000000);
        console.log("The generated images will have Random ID: " + this.id);
    },
    get: function () {
        if (this.id === null) {
            this.generate();
        }
        return this.id;
    }
};

// Function to validate API keys //
function validateApiKeys(apiKeys) {
    if (apiKeys.Keys.StabilityAI == "") {
        throw new Error("The API key is not set. Please set it in the file");
    }
    if (apiKeys.Keys.OpenAI == "") {
        throw new Error("The API key is not set. Please set it in the file");
    }
}

// Helper function to read and parse ini files
function getIniFileContent(filePath) {
    return ini.parse(fs.readFileSync(filePath, 'utf-8'));
}

// Deletes the original reply and follows up with a new ephemeral one. Mostly used for error handling
async function deleteAndFollowUpEphemeral(interaction, message) {
    await interaction.deleteReply();
    await interaction.followUp({
        content: message,
        ephemeral: true
    });
}

// Follows up with a new ephemeral message. Mostly used for error handling
async function followUpEphemeral(interaction, message) {
    await interaction.followUp({
        content: message,
        ephemeral: true
    });
}

// Follows up with a new message. Mostly used for error handling
async function followUp(interaction, message) {
    await interaction.followUp({
        content: message,
        ephemeral: true
    });
}

// Generates a random seed for image generation
async function genSeed() {
    return Math.floor(Math.random() * 4294967295);
}

function getDimensions(imageModel, dimensionType) {
    let dimensions = '';

    if (imageModel === 'stable-diffusion-xl-1024-v1-0') {
        switch (dimensionType) {
            case 'square':
                dimensions = '1024x1024';
                break;
            case 'tall':
                dimensions = '768x1344';
                break;
            case 'wide':
                dimensions = '1344x768';
                break;
            default:
                dimensions = 'Invalid dimension type';
        }
    } else if (imageModel === 'dall-e-3') {
        switch (dimensionType) {
            case 'square':
                dimensions = '1024x1024';
                break;
            case 'tall':
                dimensions = '1024x1792';
                break;
            case 'wide':
                dimensions = '1792x1024';
                break;
            default:
                dimensions = 'Invalid dimension type';
        }
    } else if (imageModel === 'stable-diffusion-v1-6') {
        switch (dimensionType) {
            case 'square':
                dimensions = '512x512';
                break;
            case 'tall':
                dimensions = '512x896';
                break;
            case 'wide':
                dimensions = '896x512';
                break;
            default:
                dimensions = 'Invalid dimension type';
        }
    } else if (imageModel === 'sd3' || imageModel === 'sd3-turbo') {
        switch (dimensionType) {
            case 'square':
                dimensions = '1:1';
                break;
            case 'tall':
                dimensions = '9:16';
                break;
            case 'wide':
                dimensions = '16:9';
                break;
            default:
                dimensions = 'Invalid dimension type';
        }
    } else {
        dimensions = 'Invalid image model';
    }

    return dimensions;
}

// Automatically disable unneeded prompt optimization for more advanced image models
function autoDisableUnneededPromptOptimization(imageModel) {
    // List of models for which the optimization should be disabled
    const modelsToDisable = ['dall-e-3', 'sd3', 'sd3-turbo'];

    // Check if the current image model is in the list
    if (modelsToDisable.includes(imageModel)) {
        console.log(`Prompt optimization is disabled for the ${imageModel} model`);
        return true;
    } else {
        return false;
    }
}

async function checkSDBalance(imageModel, numberOfImages) {
    if (imageModel != 'dall-e-3') {
        try {
            let pricePerImage = 0;
            switch (imageModel) {
                case 'sd3':
                    pricePerImage = 6.5;
                    break;
                case 'sd3-turbo':
                    pricePerImage = 4;
                    break;
                case 'core':
                    pricePerImage = 3;
                    break;
                case 'sdxl-1.0':
                case 'sd-1.6':
                    pricePerImage = 0.2;
                    break;
                default:
                    pricePerImage = 0;
                    break;
            }
            if (await getBalance() < pricePerImage * numberOfImages) {
                return false;
            }
        } catch (error) {
            console.error(error);
            return false;
        }
    }
    return true;
}

/* End of functions */

// Export the functions
module.exports = {
    generateImage,
    upscaleImage,
    promptOptimizer,
    adaptImagePrompt,
    filterCheck,
    filterString,
    generateHashedUserId,
    getBalance,
    lowBalanceMessage,
    saveToDiskCheck,
    randomID,
    validateApiKeys,
    getIniFileContent,
    deleteAndFollowUpEphemeral,
    followUpEphemeral,
    followUp,
    genSeed,
    getDimensions,
    generateImageToImage,
    autoDisableUnneededPromptOptimization,
    checkSDBalance,
    searchAndReplace,
};
