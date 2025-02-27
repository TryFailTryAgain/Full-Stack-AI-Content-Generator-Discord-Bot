// File: image_functions.js
// Author: TryFailTryAgain
// Copyright (c) 2024. All rights reserved.

// Getting required modules
const fs = require('fs');
const OpenAI = require('openai');

// Import the helper functions
const helperFunctions = require('./helperFunctions.js');
const image = require('../commands/CoreFunctions/image.js');
// Add all the helper functions to the global scope
for (let key in helperFunctions) {
    global[key] = helperFunctions[key];
}

// Import provider-specific functions
const { generateImageViaDallE3 } = require('./image_providers/OpenAI.js');
const { generateImageViaStabilityAIv1, searchAndReplace } = require('./image_providers/StabilityXL.js');
const { generateImageViaSD3, generateImageToImageViaStabilityAISD3 } = require('./image_providers/SD3.js');
const { generateImageViaReplicate_Juggernaut } = require('./image_providers/Juggernaut.js');
const { generateImageViaReplicate_FluxSchnell } = require('./image_providers/FluxSchnell.js');
const { generateImageViaReplicate_FluxDev, generateImageToImageViaReplicate_FluxDev } = require('./image_providers/FluxDev.js');
const { upscaleImageViaReplicate_esrgan } = require('./image_providers/ReplicateESRGAN.js');

const openaiChatBaseURL = process.env.ADVCONF_OPENAI_CHAT_BASE_URL;
const openaiChat = new OpenAI({ apiKey: process.env.API_KEY_OPENAI_CHAT });
openaiChat.baseURL = openaiChatBaseURL;

// Profanity filter and save images setting
console.log(`Profanity filter -- /Chat == ${filterCheck() ? 'ENABLED' : 'DISABLED'}`);
console.log(`Save images to disk -- /image == ${saveToDiskCheck() ? 'ENABLED' : 'DISABLED'}`);

/* Functions */

// The generateImage and generateImageToImage functions remain here to orchestrate the calls to provider-specific functions
async function generateImage({ userInput, negativePrompt, imageModel, dimensions, numberOfImages, cfg, steps, seed, userID }) {
    // Creates an empty array to store the image buffers in
    let imageBuffer = [];
    // Get the correct dimensions for the image
    const trueDimensions = getDimensions(imageModel, dimensions);
    // Generate a hashed user ID to send to openai instead of the original user ID
    const hashedUserID = await generateHashedUserId(userID);

    switch (imageModel) {
        case "dall-e-3":
            imageBuffer = await generateImageViaDallE3({
                userInput: userInput,
                trueDimensions: trueDimensions,
                numberOfImages: numberOfImages,
                userID: hashedUserID
            });
            break;
        case "stable-diffusion-v1-6":
        case "stable-diffusion-xl-1024-v1-0":
            imageBuffer = await generateImageViaStabilityAIv1({
                userInput: userInput,
                negativePrompt: negativePrompt,
                trueDimensions: trueDimensions,
                imageModel: imageModel,
                numberOfImages: numberOfImages,
                cfg: cfg,
                steps: steps,
                seed: seed,
                userID: hashedUserID
            });
            break;
        case "sd3.5-large":
        case "sd3.5-large-turbo":
        case "sd3.5-medium":
            imageBuffer = await generateImageViaSD3({
                userInput: userInput,
                negativePrompt: negativePrompt,
                trueDimensions: trueDimensions,
                imageModel: imageModel,
                numberOfImages: numberOfImages
            });
            break;
        case imageModel.match(/^lucataco\/juggernaut-xl-v9:/)?.input:
            imageBuffer = await generateImageViaReplicate_Juggernaut({
                userInput: userInput,
                negativePrompt: negativePrompt,
                imageModel: imageModel,
                trueDimensions: trueDimensions,
                numberOfImages: numberOfImages,
                cfg: cfg,
                steps: steps,
                disable_safety_checker: !Boolean(process.env.ADVCONF_IMAGE_SAFTY_CHECK)
            });
            break;
        case "black-forest-labs/flux-schnell":
            imageBuffer = await generateImageViaReplicate_FluxSchnell({
                userInput: userInput,
                imageModel: imageModel,
                numberOfImages: numberOfImages,
                trueDimensions: trueDimensions,
                output_format: "webp",
                output_quality: 100,
                disable_safety_checker: !Boolean(process.env.ADVCONF_IMAGE_SAFTY_CHECK),
            });
            break;
        case "black-forest-labs/flux-dev":
            imageBuffer = await generateImageViaReplicate_FluxDev({
                userInput: userInput,
                imageModel: imageModel,
                numberOfImages: numberOfImages,
                trueDimensions: trueDimensions,
                output_format: "webp",
                output_quality: 100,
                disable_safety_checker: !Boolean(process.env.ADVCONF_IMAGE_SAFTY_CHECK),
                seed: seed,
                //prompt_strength: null,
                //num_inference_steps: null
            });
            break;
        default:
            throw new Error(`Unsupported image model for text to image generation: ${imageModel}`);
    }

    return imageBuffer;
}

async function generateImageToImage({ image, userInput, negativePrompt, Image2Image_Model, strength, seed, userID }) {
    let imageBuffer = [];

    switch (Image2Image_Model) {
        case 'sd3.5-large':
        case 'sd3.5-large-turbo':
        case 'sd3.5-medium':
            const trueDimensions = getDimensions(Image2Image_Model, 'square'); // Assuming 'square' as default dimension type
            imageBuffer = await generateImageToImageViaStabilityAISD3({
                userInput: userInput,
                negativePrompt: negativePrompt,
                imageModel: Image2Image_Model,
                strength: strength,
                image: image,
                numberOfImages: 1 // Assuming 1 as default number of images
            });
            break;
        case 'black-forest-labs/flux-dev':
            imageBuffer = await generateImageToImageViaReplicate_FluxDev({
                image: image,
                userInput: userInput,
                strength: strength,
                disable_safety_checker: !Boolean(process.env.ADVCONF_IMAGE_SAFTY_CHECK),
            });
            break;
        default:
            throw new Error(`Unsupported image model for image-to-image generation: ${Image2Image_Model}`);
    }

    return imageBuffer;
}

// TODO: Implement generateImageEdit function
async function generateImageEdit({ image, instructions, imageModel, userID }) {
    return -1;
}

async function upscaleImage(imageBuffer, upscaleModel) {
    let upscaledImageBuffer = [];

    switch (upscaleModel) {
        case 'nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa':
            upscaledImageBuffer = await upscaleImageViaReplicate_esrgan({ imageBuffer });
            break;
        default:
            throw new Error(`Unsupported upscale model: ${upscaleModel}`);
    }

    return upscaledImageBuffer;
}

async function promptOptimizer(userInput, userID) {
    // Send the prompt to openai's API to optimize it
    console.log("--Optimizing prompt--");
    // Get some values from settings.ini to define the model and the messages to send to openai
    const Prompt_Model = process.env.IMAGE_PROMPT_MODEL;
    const temperature = process.env.IMAGE_OPTIMIZER_TEMPERATURE;
    const systemMessage = process.env.IMAGE_SYSTEM_MESSAGE;
    const userMessage = process.env.IMAGE_USER_MESSAGE;

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
    optimized_Prompt = await filterCheckThenFilterString(optimized_Prompt);
    return optimized_Prompt;
}


// Function to adapt the image prompt used for image generation to align with the users input as requested via chat refinement
async function adaptImagePrompt(currentPrompt, refinementRequest, userID) {
    console.log("--Adapting the prompt based on user refinement request--");

    const Prompt_Model = process.env.IMAGE_PROMPT_MODEL;
    const temperature = process.env.IMAGE_OPTIMIZER_TEMPERATURE;
    const systemMessage = process.env.IMAGE_CHAT_REFINEMENT_SYSTEM_MESSAGE;
    const userMessageTemplate = process.env.IMAGE_CHAT_REFINEMENT_USER_MESSAGE;

    // Filter the refinement request
    refinementRequest = await filterCheckThenFilterString(refinementRequest);
    const hashedUserID = await generateHashedUserId(userID);

    let response = null;
    try {
        response = await openaiChat.chat.completions.create({
            model: Prompt_Model,
            messages: [
                {
                    "role": "system",
                    "content": systemMessage
                },
                {
                    "role": "user",
                    "content": userMessageTemplate.replace('[originalPrompt]', currentPrompt).replace('[refinementRequest]', refinementRequest)
                }
            ],
            temperature: Number(temperature),
            max_tokens: 300,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
            user: String(hashedUserID),
        });
    } catch (error) {
        console.error('Error refining prompt:', error);
        throw error;
    }

    let refinedPrompt = response.choices[0].message.content.trim();
    console.log("Refined prompt prior to filtering:\n", refinedPrompt);
    // Extract the prompt between <START_PROMPT> and <END_PROMPT>
    const promptMatch = refinedPrompt.match(/<PROMPT>([\s\S]+?)<\/PROMPT>/);
    if (promptMatch && promptMatch[1]) {
        refinedPrompt = promptMatch[1].trim();
    } else {
        console.error('Refined prompt markers not found.');
        throw new Error('Failed to extract refined prompt.');
    }

    refinedPrompt = await filterCheckThenFilterString(refinedPrompt);

    console.log("Refined prompt:\n", refinedPrompt);
    return refinedPrompt;
}

// Check if the user wants to save the images to disk or not
async function saveToDiskCheck() {
    const saveImages = process.env.ADVCONF_SAVE_IMAGES.toLowerCase();
    if (saveImages === 'true') {
        return true;
    } else if (saveImages === 'false') {
        return false;
    } else {
        throw new Error("The Save_Images setting in settings.ini is not set to true or false. Please set it to true or false");
    }
}

// Function to validate API keys //
function validateApiKeys(apiKeys) {
    if (apiKeys.Keys.StabilityAI == "") {
        throw new Error("The API key is not set. Please set it in the file");
    }
    if (apiKeys.Keys.OpenAI == "") {
        throw new Error("The API key is not set. Please set it in the file");
    }
}

// Generates a random seed for image generation
async function genSeed() {
    return Math.floor(Math.random() * 4294967295);
}

function getDimensions(imageModel, dimensionType) {
    const dimensionsMap = {
        'stable-diffusion-xl-1024-v1-0': {
            'square': '1024x1024',
            'tall': '768x1344',
            'wide': '1344x768'
        },
        'dall-e-3': {
            'square': '1024x1024',
            'tall': '1024x1792',
            'wide': '1792x1024'
        },
        'stable-diffusion-v1-6': {
            'square': '512x512',
            'tall': '512x896',
            'wide': '896x512'
        },
        'sd3.5-large': {
            'square': '1:1',
            'tall': '9:16',
            'wide': '16:9'
        },
        'sd3.5-large-turbo': {
            'square': '1:1',
            'tall': '9:16',
            'wide': '16:9'
        },
        'sd3.5-medium': {
            'square': '1:1',
            'tall': '9:16',
            'wide': '16:9'
        },
        'lucataco/juggernaut-xl-v9:bea09cf018e513cef0841719559ea86d2299e05448633ac8fe270b5d5cd6777e': {
            'square': '1024x1024',
            'tall': '768x1344',
            'wide': '1344x768'
        },
        'black-forest-labs/flux-schnell': {
            'square': '1:1',
            'tall': '9:16',
            'wide': '16:9'
        },
        'black-forest-labs/flux-dev': {
            'square': '1:1',
            'tall': '9:16',
            'wide': '16:9'
        },
    };

    return (dimensionsMap[imageModel] || {})[dimensionType] || 'Invalid dimension type';
}

// Automatically disable unneeded prompt optimization for more advanced image models
function autoDisableUnneededPromptOptimization(imageModel) {
    // List of models for which the optimization should be disabled
    const modelsToDisable = ['dall-e-3', 'sd3-large', 'sd3-large-turbo'];

    // Check if the current image model is in the list
    if (modelsToDisable.includes(imageModel)) {
        console.log(`Prompt optimization is disabled for the ${imageModel} model`);
        return true;
    } else {
        return false;
    }
}

/* End of functions */

module.exports = {
    generateImage,
    upscaleImage,
    promptOptimizer,
    adaptImagePrompt,
    saveToDiskCheck,
    validateApiKeys,
    genSeed,
    getDimensions,
    generateImageToImage,
    autoDisableUnneededPromptOptimization,
    searchAndReplace,
    generateImageEdit,
};
