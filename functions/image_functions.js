// File: image_functions.js
// Author: TryFailTryAgain
// Copyright (c) 2024. All rights reserved. For use in Open-Source projects this
// may be freely copied or excerpted with credit to the author.

/* Getting required modules */
const fs = require('fs');
const OpenAI = require('openai');
const sharp = require('sharp');
const FormData = require('form-data');
const axios = require('axios');
const Replicate = require('replicate');

// Import the helper functions
const helperFunctions = require('./helperFunctions.js');
const image = require('../commands/CoreFunctions/image.js');
// Add all the helper functions to the global scope
for (let key in helperFunctions) {
    global[key] = helperFunctions[key];
}
/* End getting required modules */

// File paths
const SETTINGS_FILE_PATH = './settings.ini';
const API_KEYS_FILE_PATH = './api_keys.ini';

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
console.log(`Profanity filter -- /Chat == ${filterCheck() ? 'ENABLED' : 'DISABLED'}`);
console.log(`Save images to disk -- /image == ${saveToDiskCheck() ? 'ENABLED' : 'DISABLED'}`);


/* Functions */
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
        case "sd3-large":
        case "sd3-large-turbo":
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
                seed: seed,
                disable_safety_checker: !Boolean(config.Advanced.Image_Safety_Check)
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
                disable_safety_checker: !Boolean(config.Advanced.Image_Safety_Check),
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
                disable_safety_checker: !Boolean(config.Advanced.Image_Safety_Check),
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
        case 'sd3-large':
            imageBuffer = await generateImageToImageViaStabilityAI(image, userInput, negativePrompt, strength, seed, userID);
            break;
        case 'black-forest-labs/flux-dev':
            imageBuffer = await generateImageToImageViaReplicate_FluxDev({
                image: image,
                userInput: userInput,
                strength: strength,
                disable_safety_checker: !Boolean(config.Advanced.Image_Safety_Check),
            });
            break;
        default:
            throw new Error(`Unsupported image model for image-to-image generation: ${Image2Image_Model}`);
    }

    return imageBuffer;
}

async function generateImageViaReplicate_FluxDev({ userInput, imageModel, numberOfImages, trueDimensions, output_format, output_quality, disable_safety_checker, seed, prompt_strength, num_inference_steps }) {
    const replicate = new Replicate({
        auth: apiKeys.Keys.Replicate,
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
            const saveBuffer = await sharp(Buffer.from(arrayBuffer))[config.Advanced.Save_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();

            const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);
            imageBuffer.push(processedBuffer);
        }
        return imageBuffer;

    } catch (error) {
        console.error('Error generating image with Replicate Flux Dev:', error);
        throw error;
    }
}

async function generateImageToImageViaReplicate_FluxDev({ image, userInput, strength, disable_safety_checker }) {
    let imageBuffer = [];
    const replicate = new Replicate({
        auth: apiKeys.Keys.Replicate,
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
            const saveBuffer = await sharp(Buffer.from(arrayBuffer))[config.Advanced.Save_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();

            const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);
            imageBuffer.push(processedBuffer);
        }
        return imageBuffer;

    } catch (error) {
        console.error('Error generating image with Replicate Flux Dev:', error);
        throw error;
    }
}

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
        return imageBuffer;

    } catch (error) {
        console.error('Error generating image with Replicate:', error);
        throw error;
    }
}

// Function to generate an image via Replicate Juggernaut XL v9
async function generateImageViaReplicate_Juggernaut({ userInput, negativePrompt, imageModel, trueDimensions, numberOfImages, steps, seed, disable_safety_checker }) {
    const replicate = new Replicate({
        auth: apiKeys.Keys.Replicate,
    });

    console.log('\n---Generating image via Replicate Juggernaut XL v9---');
    console.log('-User Input:', userInput);
    console.log('-Negative Prompt:', negativePrompt);
    console.log('-Image Model:', imageModel);
    console.log('-True Dimensions:', trueDimensions);
    console.log('-Number of Images:', numberOfImages);

    try {
        const prediction = await replicate.run(
            imageModel,
            {
                input: {
                    prompt: userInput,
                    negative_prompt: negativePrompt !== undefined ? negativePrompt : '',
                    steps: steps,
                    width: parseInt(trueDimensions.split('x')[0]),
                    height: parseInt(trueDimensions.split('x')[1]),
                    scheduler: "DPM++SDE",
                    num_outputs: parseInt(numberOfImages),
                    guidance_scale: 2,
                    apply_watermark: true,
                    num_inference_steps: 5,
                    seed: parseInt(seed),
                    disable_safety_checker: disable_safety_checker
                }
            }
        );
        //console.log('Replicate prediction output:\n', prediction);
        let imageBuffer = [];
        for (let i = 0; i < prediction.length; i++) {
            const imageUrl = prediction[i];
            const response = await fetch(imageUrl);
            const arrayBuffer = await response.arrayBuffer();
            const saveBuffer = await sharp(Buffer.from(arrayBuffer))[config.Advanced.Save_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();

            const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);
            imageBuffer.push(processedBuffer);
        }
        return imageBuffer;

    } catch (error) {
        console.error('Error generating image with Replicate:', error);
        throw error;
    }
}

// Function to generate an image via Dall-E-3
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
    console.log("RETURNING");
    return imageBuffer;
}

// Function to generate an image via StabilityAI v1
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
            Authorization: StabilityAIKey,
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
                    const saveBuffer = await sharp(Buffer.from(image.base64, 'base64'))[config.Advanced.Save_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
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
    return imageBuffer;
}

// Function to generate an image via Stable Diffusion 3.0
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
        };

        if (imageModel == "sd3-large") { // Only append to supported models
            payload.negative_prompt = negativePrompt;
        }

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
    return imageBuffer;
}

// NOT currently functional
async function generateImageToImageViaStabilityAI(image, userInput, negativePrompt, strength, seed, userID) {
    const apiUrl = 'https://api.stability.ai/v2beta/stable-image/generate/sd3';
    let imageBuffer = [];
    if (negativePrompt == "") negativePrompt = "bad quality, low resolution, low quality, blurry, lowres, jpeg artifacts, warped image, worst quality";

    // Log the parameters to the console
    console.log('\n---Generating image-to-image via StabilityAI APIv2---');
    console.log('-User Input:', userInput);
    console.log('-Negative Prompt:', negativePrompt);
    console.log('-Strength:', strength);
    console.log('-Seed:', seed);
    console.log('-User ID:', userID);

    const payload = {
        model: 'sd3-large',
        prompt: userInput,
        negative_prompt: negativePrompt,
        image: image.toString('base64'),
        output_format: "png",
        mode: "image-to-image",
        strength: strength,
        seed: seed,
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

    return imageBuffer;
}

// Documentation:
// https://platform.stability.ai/docs/api-reference#tag/Edit/paths/~1v2beta~1stable-image~1edit~1search-and-replace/post
async function searchAndReplace(image, search, replace, negative_prompt, userID) {
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
    formData.append('image', image, { filename: 'image.' + config.Advanced.Send_Images_As, contentType: 'image/' + config.Advanced.Send_Images_As });
    formData.append('output_format', 'png');
    formData.append('negative_prompt', negative_prompt);

    const response = await fetch(apiUrl, {
        method: 'POST',
        body: formData,
        headers: {
            Authorization: StabilityAIKey,
            Accept: "image/*",
            ...formData.getHeaders(),
        },
    });
    const arrayBuffer = await response.arrayBuffer();

    if (response.ok) {
        const saveBuffer = await sharp(Buffer.from(arrayBuffer))[config.Advanced.Save_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
        // Saves images to disk if the setting is enabled, otherwise only send them to Discord
        const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);
        imageBuffer.push(processedBuffer);
    } else {
        throw new Error(`${response.status}: ${response.data.toString()}`);
    }
    return imageBuffer;
}

async function upscaleImage(imageBuffer, upscaleModel) {
    let upscaledImageBuffer = [];

    switch (upscaleModel) {
        case 'nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa':
            upscaledImageBuffer = await upscaleImageViaReplicate_esrgan({ imageBuffer: imageBuffer });
            break;
        default:
            throw new Error(`Unsupported upscale model: ${upscaleModel}`);
    }

    return upscaledImageBuffer;
}

// Documentation
// https://replicate.com/nightmareai/real-esrgan
async function upscaleImageViaReplicate_esrgan({ imageBuffer, scaleFactor = 2, face_enhance = false }) {
    const replicate = new Replicate({
        auth: apiKeys.Keys.Replicate,
    });

    console.log('\n---Upscaling image via Replicate ESRGAN---');
    console.log('Scaling factor: ', scaleFactor);
    console.log('Face enhance: ', face_enhance);

    try {
        // Convert image buffer to a data URI
        const imageDataUri = `data:image/png;base64,${(await sharp(imageBuffer).png().toBuffer()).toString('base64')}`;

        const input = {
            image: imageDataUri,
            scale: scaleFactor, // Adjust up to 10x
            face_enhance: face_enhance,
        };

        const prediction = await replicate.run('nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa', { input });
        const imageUrl = prediction;
        const response = await fetch(imageUrl);
        const arrayBuffer = await response.arrayBuffer();
        const saveBuffer = await sharp(Buffer.from(arrayBuffer))[config.Advanced.Save_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();

        const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);
        return processedBuffer;

    } catch (error) {
        console.error('Error upscaling image with Replicate ESRGAN:', error);
        throw error;
    }
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
    optimized_Prompt = await filterCheckThenFilterString(optimized_Prompt);
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
    chatRefinementRequest = await filterCheckThenFilterString(chatRefinementRequest);
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
    refinedPrompt = await filterCheckThenFilterString(response.choices[0].message.content);

    console.log("Original prompt: \n" + currentPrompt + "\n" +
        "Refined prompt:  \n" + refinedPrompt + "\n");

    return refinedPrompt;
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
        'sd3-large': {
            'square': '1:1',
            'tall': '9:16',
            'wide': '16:9'
        },
        'sd3-large-turbo': {
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

async function checkSDBalance(imageModel, numberOfImages) {
    if (imageModel != 'dall-e-3') {
        try {
            let pricePerImage = 0;
            switch (imageModel) {
                case 'sd3-large':
                    pricePerImage = 6.5;
                    break;
                case 'sd3-large-turbo':
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
                    return true;
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

async function checkThenSave_ReturnSendImage(saveBuffer) {
    if (saveToDiskCheck()) {
        fs.writeFileSync(
            `./Outputs/txt2img_${generateRandomHex()}.${config.Advanced.Save_Images_As}`,
            saveBuffer
        );
    }
    if (config.Advanced.Save_Images_As == config.Advanced.Send_Images_As) {
        return saveBuffer;
    } else {
        const sendBuffer = await sharp(saveBuffer)[config.Advanced.Send_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
        return sendBuffer;
    }
}

module.exports = {
    generateImage,
    upscaleImage,
    promptOptimizer,
    adaptImagePrompt,
    getBalance,
    lowBalanceMessage,
    saveToDiskCheck,
    validateApiKeys,
    genSeed,
    getDimensions,
    generateImageToImage,
    autoDisableUnneededPromptOptimization,
    checkSDBalance,
    searchAndReplace,
};
