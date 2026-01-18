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
const { generateImageViaDallE3, generateImageViaGPTImageGen1 } = require('./image_providers/OpenAI.js');
const { generateImageViaStabilityAIv1, searchAndReplace } = require('./image_providers/StabilityXL.js');
const { generateImageViaSD3, generateImageToImageViaStabilityAISD3 } = require('./image_providers/SD3.js');
const { generateImageViaReplicate_FluxSchnell } = require('./image_providers/FluxSchnell.js');
const { generateImageViaReplicate_FluxDev, generateImageToImageViaReplicate_FluxDev } = require('./image_providers/FluxDev.js');
const { generateImageViaReplicate_Flux2Dev, generateImageToImageViaReplicate_Flux2Dev, generateMultiReferenceImageViaReplicate_Flux2Dev, generateImageEditViaReplicate_Flux2Dev } = require('./image_providers/Flux2Dev.js');
const { generateImageViaReplicate_Flux2Pro, generateImageToImageViaReplicate_Flux2Pro, generateMultiReferenceImageViaReplicate_Flux2Pro, generateImageEditViaReplicate_Flux2Pro } = require('./image_providers/Flux2Pro.js');
const { generateImageViaReplicate_Flux2Klein4b, generateImageToImageViaReplicate_Flux2Klein4b, generateImageEditViaReplicate_Flux2Klein4b } = require('./image_providers/Flux2Klein4b.js');
const { generateImageViaReplicate_Flux2Klein9bBase, generateImageToImageViaReplicate_Flux2Klein9bBase, generateImageEditViaReplicate_Flux2Klein9bBase } = require('./image_providers/Flux2Klein9bBase.js');
const { generateImageViaReplicate_Flux2Max, generateImageToImageViaReplicate_Flux2Max, generateImageEditViaReplicate_Flux2Max } = require('./image_providers/Flux2Max.js');
const { upscaleImageViaReplicate_esrgan } = require('./image_providers/ReplicateESRGAN.js');
const { generateImageViaReplicate_Seedream3 } = require('./image_providers/Seedream3.js');
const { generateImageViaReplicate_Imagen4Fast } = require('./image_providers/Imagen4Fast.js');
const { generateImageViaReplicate_Imagen4 } = require('./image_providers/Imagen4.js');
const { generateImageViaReplicate_Imagen4Ultra } = require('./image_providers/Imagen4Ultra.js');
const { generateImageEditViaReplicate_FluxKontextPro } = require('./image_providers/FluxKontextPro.js');
const { generateImageEditViaReplicate_FluxKontextDev } = require('./image_providers/FluxKontextDev.js');
const { generateImageViaReplicate_Seedream45, generateImageToImageViaReplicate_Seedream45, generateImageEditViaReplicate_Seedream45 } = require('./image_providers/Seedream45.js');
const { generateImageViaReplicate_NanaBananaPro, generateImageToImageViaReplicate_NanaBananaPro, generateImageEditViaReplicate_NanaBananaPro } = require('./image_providers/NanaBananaPro.js');
const { moderateContent } = require('./moderation.js');

const openaiChatBaseURL = process.env.ADVCONF_OPENAI_CHAT_BASE_URL;
const openaiChat = new OpenAI({ apiKey: process.env.API_KEY_OPENAI_CHAT });
openaiChat.baseURL = openaiChatBaseURL;

// Moderation and save images settings
const moderationEnabled = (process.env.MODERATION_OPENAI_MODERATION || 'false').trim().toLowerCase() === 'true';
console.log(`OpenAI Moderation -- /image == ${moderationEnabled ? 'ENABLED' : 'DISABLED'}`);
console.log(`Save images to disk -- /image == ${saveToDiskCheck() ? 'ENABLED' : 'DISABLED'}`);

/* Functions */

// The generateImage and generateImageToImage functions remain here to orchestrate the calls to provider-specific functions
async function generateImage({ userInput, negativePrompt, imageModel, dimensions, numberOfImages, cfg, steps, seed, userID }) {
    // Creates an empty array to store the image buffers in
    let imageBuffer = [];

    // Moderate the user input before proceeding
    const userInputModResult = await moderateContent({ text: userInput });
    if (userInputModResult.flagged) {
        throw new Error("The provided image prompt was flagged by the moderation system.");
    }
    userInput = userInputModResult.cleanedText;

    // Moderate the negative prompt if provided
    if (negativePrompt) {
        const negativePromptModResult = await moderateContent({ text: negativePrompt });
        if (negativePromptModResult.flagged) {
            throw new Error("The provided negative prompt was flagged by the moderation system.");
        }
        negativePrompt = negativePromptModResult.cleanedText;
    }

    // Get the correct dimensions for the image
    const trueDimensions = getDimensions(imageModel, dimensions);
    // Generate a hashed user ID to send to openai instead of the original user ID
    const hashedUserID = await generateHashedUserId(userID);

    switch (imageModel) {
        case 'gpt-image-1':
            imageBuffer = await generateImageViaGPTImageGen1({
                userInput: userInput,
                trueDimensions: trueDimensions,
                numberOfImages: numberOfImages,
                userID: hashedUserID,
                quality: process.env.ADVCONF_IMAGE_QUALITY || "auto",
                moderation: process.env.ADVCONF_IMAGE_MODERATION || "auto"
            });
            break;
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
        case "black-forest-labs/flux-schnell":
            imageBuffer = await generateImageViaReplicate_FluxSchnell({
                userInput: userInput,
                imageModel: imageModel,
                numberOfImages: numberOfImages,
                trueDimensions: trueDimensions,
                output_format: "png",
                output_quality: 100,
                disable_safety_checker: !Boolean(process.env.ADVCONF_REPLICATE_IMAGE_SAFTY_CHECK),
            });
            break;
        case "black-forest-labs/flux-dev":
            imageBuffer = await generateImageViaReplicate_FluxDev({
                userInput: userInput,
                imageModel: imageModel,
                numberOfImages: numberOfImages,
                trueDimensions: trueDimensions,
                output_format: "png",
                output_quality: 100,
                disable_safety_checker: !Boolean(process.env.ADVCONF_REPLICATE_IMAGE_SAFTY_CHECK),
                seed: seed,
            });
            break;
        case "black-forest-labs/flux-2-dev":
            imageBuffer = await generateImageViaReplicate_Flux2Dev({
                userInput: userInput,
                imageModel: imageModel,
                numberOfImages: numberOfImages,
                trueDimensions: trueDimensions,
                output_format: "png",
                output_quality: 100,
                disable_safety_checker: !Boolean(process.env.ADVCONF_REPLICATE_IMAGE_SAFTY_CHECK),
                seed: seed,
                go_fast: true,
            });
            break;
        case "black-forest-labs/flux-2-pro":
            imageBuffer = await generateImageViaReplicate_Flux2Pro({
                userInput: userInput,
                imageModel: imageModel,
                numberOfImages: numberOfImages,
                trueDimensions: trueDimensions,
                output_format: "png",
                output_quality: 100,
                seed: seed,
                resolution: process.env.FLUX2PRO_RESOLUTION || '1 MP',
                safety_tolerance: process.env.FLUX2PRO_SAFETY_TOLERANCE ? Number(process.env.FLUX2PRO_SAFETY_TOLERANCE) : 2,
            });
            break;
        case 'bytedance/seedream-3':
            imageBuffer = await generateImageViaReplicate_Seedream3({
                userInput: userInput,
                seed: seed,
                aspect_ratio: trueDimensions
            });
            break;
        case 'google/imagen-4-fast':
            imageBuffer = await generateImageViaReplicate_Imagen4Fast({
                userInput: userInput,
                aspect_ratio: trueDimensions
            });
            break;
        case 'google/imagen-4':
            imageBuffer = await generateImageViaReplicate_Imagen4({
                userInput: userInput,
                aspect_ratio: trueDimensions
            });
            break;
        case 'google/imagen-4-ultra':
            imageBuffer = await generateImageViaReplicate_Imagen4Ultra({
                userInput: userInput,
                aspect_ratio: trueDimensions
            });
            break;
        case 'bytedance/seedream-4.5':
            imageBuffer = await generateImageViaReplicate_Seedream45({
                userInput: userInput,
                aspect_ratio: trueDimensions,
                size: '2K',
                sequential_image_generation: 'disabled',
            });
            break;
        case 'google/nano-banana-pro':
            imageBuffer = await generateImageViaReplicate_NanaBananaPro({
                userInput: userInput,
                aspect_ratio: trueDimensions,
                resolution: '2K',
                output_format: 'png',
                safety_filter_level: (process.env.ADVCONF_REPLICATE_IMAGE_SAFTY_CHECK === 'false') ? 'block_only_high' : 'block_medium_and_above'
            });
            break;
        case 'black-forest-labs/flux-2-klein-4b':
            imageBuffer = await generateImageViaReplicate_Flux2Klein4b({
                userInput: userInput,
                imageModel: imageModel,
                numberOfImages: numberOfImages,
                trueDimensions: trueDimensions,
                output_format: 'png',
                output_quality: 100,
                disable_safety_checker: !Boolean(process.env.ADVCONF_REPLICATE_IMAGE_SAFTY_CHECK),
                seed: seed,
                go_fast: false,
            });
            break;
        case 'black-forest-labs/flux-2-klein-9b-base':
            imageBuffer = await generateImageViaReplicate_Flux2Klein9bBase({
                userInput: userInput,
                imageModel: imageModel,
                numberOfImages: numberOfImages,
                trueDimensions: trueDimensions,
                output_format: 'png',
                output_quality: 100,
                disable_safety_checker: !Boolean(process.env.ADVCONF_REPLICATE_IMAGE_SAFTY_CHECK),
                seed: seed,
                go_fast: true,
                guidance: 4,
            });
            break;
        case 'black-forest-labs/flux-2-max':
            imageBuffer = await generateImageViaReplicate_Flux2Max({
                userInput: userInput,
                imageModel: imageModel,
                numberOfImages: numberOfImages,
                trueDimensions: trueDimensions,
                output_format: 'webp',
                output_quality: 80,
                seed: seed,
                ...(process.env.FLUX2MAX_RESOLUTION && { resolution: process.env.FLUX2MAX_RESOLUTION }),
                ...(process.env.FLUX2MAX_SAFETY_TOLERANCE && { safety_tolerance: Number(process.env.FLUX2MAX_SAFETY_TOLERANCE) }),
            });
            break;
        default:
            throw new Error(`Unsupported image model for text to image generation: ${imageModel}`);
    }

    return imageBuffer;
}

async function generateImageToImage({ images, image, userInput, negativePrompt, Image2Image_Model, strength, seed, userID }) {
    let imageBuffer = [];
    // Support both single image (legacy) and multiple images
    const inputImages = images || (image ? [image] : []);
    
    // Moderate the user input before proceeding
    const userInputModResult = await moderateContent({ text: userInput });
    if (userInputModResult.flagged) {
        throw new Error("The provided instructions were flagged by the moderation system.");
    }
    userInput = userInputModResult.cleanedText;

    // Moderate the negative prompt if provided
    if (negativePrompt) {
        const negativePromptModResult = await moderateContent({ text: negativePrompt });
        if (negativePromptModResult.flagged) {
            throw new Error("The provided negative prompt was flagged by the moderation system.");
        }
        negativePrompt = negativePromptModResult.cleanedText;
    }
    
    // Check images for moderation
    for (const img of inputImages) {
        const imgModResult = await moderateContent({ image: img });
        if (imgModResult.flagged) {
            throw new Error("The provided image was flagged by the moderation system.");
        }
    }

    switch (Image2Image_Model) {
        case 'sd3.5-large':
        case 'sd3.5-large-turbo':
        case 'sd3.5-medium':
            // SD3 only supports single image, use first one
            const trueDimensions = getDimensions(Image2Image_Model, 'square'); // Assuming 'square' as default dimension type
            imageBuffer = await generateImageToImageViaStabilityAISD3({
                userInput: userInput,
                negativePrompt: negativePrompt,
                imageModel: Image2Image_Model,
                strength: strength,
                image: inputImages[0],
                numberOfImages: 1 // Assuming 1 as default number of images
            });
            break;
        case 'black-forest-labs/flux-dev':
            // Flux Dev only supports single image, use first one
            imageBuffer = await generateImageToImageViaReplicate_FluxDev({
                image: inputImages[0],
                userInput: userInput,
                strength: strength,
                disable_safety_checker: !Boolean(process.env.ADVCONF_REPLICATE_IMAGE_SAFTY_CHECK),
            });
            break;
        case 'black-forest-labs/flux-2-dev':
            // Flux 2 Dev supports multiple input images (up to 8)
            imageBuffer = await generateImageToImageViaReplicate_Flux2Dev({
                images: inputImages,
                userInput: userInput,
                strength: strength,
                disable_safety_checker: !Boolean(process.env.ADVCONF_REPLICATE_IMAGE_SAFTY_CHECK),
                go_fast: true,
                output_format: "png",
                output_quality: 100,
            });
            break;
        case 'black-forest-labs/flux-2-pro':
            // Flux 2 Pro supports multiple input images (up to 8)
            imageBuffer = await generateImageToImageViaReplicate_Flux2Pro({
                images: inputImages,
                userInput: userInput,
                strength: strength,
                output_format: "png",
                output_quality: 100,
                seed: seed,
                resolution: process.env.FLUX2PRO_RESOLUTION || '1 MP',
                safety_tolerance: process.env.FLUX2PRO_SAFETY_TOLERANCE ? Number(process.env.FLUX2PRO_SAFETY_TOLERANCE) : 2,
            });
            break;
        case 'bytedance/seedream-4.5':
            // Seedream 4.5 supports multiple input images (up to 8)
            imageBuffer = await generateImageToImageViaReplicate_Seedream45({
                images: inputImages,
                userInput: userInput,
                size: '2K',
                aspect_ratio: 'match_input_image',
                sequential_image_generation: 'disabled',
            });
            break;
        case 'google/nano-banana-pro':
            // Nano Banana Pro supports multiple input images (up to 8)
            imageBuffer = await generateImageToImageViaReplicate_NanaBananaPro({
                images: inputImages,
                userInput: userInput,
                resolution: '2K',
                output_format: 'png',
                safety_filter_level: (process.env.ADVCONF_REPLICATE_IMAGE_SAFTY_CHECK === 'false') ? 'block_only_high' : 'block_medium_and_above'
            });
            break;
        case 'black-forest-labs/flux-2-klein-4b':
            // Flux 2 Klein 4B supports multiple input images (up to 5)
            imageBuffer = await generateImageToImageViaReplicate_Flux2Klein4b({
                images: inputImages,
                userInput: userInput,
                disable_safety_checker: !Boolean(process.env.ADVCONF_REPLICATE_IMAGE_SAFTY_CHECK),
                go_fast: false,
                output_format: 'png',
                output_quality: 100,
            });
            break;
        case 'black-forest-labs/flux-2-klein-9b-base':
            // Flux 2 Klein 9B Base supports multiple input images (up to 5)
            imageBuffer = await generateImageToImageViaReplicate_Flux2Klein9bBase({
                images: inputImages,
                userInput: userInput,
                disable_safety_checker: !Boolean(process.env.ADVCONF_REPLICATE_IMAGE_SAFTY_CHECK),
                go_fast: true,
                guidance: 4,
                output_format: 'png',
                output_quality: 100,
            });
            break;
        case 'black-forest-labs/flux-2-max':
            // Flux 2 Max supports multiple input images (up to 8)
            imageBuffer = await generateImageToImageViaReplicate_Flux2Max({
                images: inputImages,
                userInput: userInput,
                output_format: 'webp',
                output_quality: 80,
                ...(process.env.FLUX2MAX_RESOLUTION && { resolution: process.env.FLUX2MAX_RESOLUTION }),
                ...(process.env.FLUX2MAX_SAFETY_TOLERANCE && { safety_tolerance: Number(process.env.FLUX2MAX_SAFETY_TOLERANCE) }),
            });
            break;
        default:
            throw new Error(`Unsupported image model for image-to-image generation: ${Image2Image_Model}`);
    }

    return imageBuffer;
}

// TODO: Implement generateImageEdit function
async function generateImageEdit({ images, image, instructions, ImageEdit_Model, userID }) {
    let imageBuffer = [];
    // Support both single image (legacy) and multiple images
    const inputImages = images || (image ? [image] : []);
    
    // Moderate the instructions before proceeding
    const modResult = await moderateContent({ text: instructions });
    if (modResult.flagged) {
        throw new Error("The provided instructions were flagged by the moderation system.");
    }
    // Use cleaned text from moderation
    instructions = modResult.cleanedText;
    
    // Check images for moderation
    for (const img of inputImages) {
        const imgModResult = await moderateContent({ image: img });
        if (imgModResult.flagged) {
            throw new Error("The provided image was flagged by the moderation system.");
        }
    }
    
    switch (ImageEdit_Model) {
        case 'black-forest-labs/flux-kontext-pro':
            // Flux Kontext Pro
            imageBuffer = await generateImageEditViaReplicate_FluxKontextPro({
                images: inputImages,
                userInput: instructions,
                aspect_ratio: 'match_input_image'
            });
            break;
        case 'black-forest-labs/flux-kontext-dev':
            // Flux Kontext Dev
            imageBuffer = await generateImageEditViaReplicate_FluxKontextDev({
                images: inputImages,
                userInput: instructions,
                aspect_ratio: 'match_input_image',
                disable_safety_checker: !Boolean(process.env.ADVCONF_REPLICATE_IMAGE_SAFTY_CHECK),
                go_fast: false
            });
            break;
        case 'black-forest-labs/flux-2-dev':
            // Flux 2 Dev supports multiple input images (up to 8)
            imageBuffer = await generateImageEditViaReplicate_Flux2Dev({
                images: inputImages,
                userInput: instructions,
                aspect_ratio: 'match_input_image',
                disable_safety_checker: !Boolean(process.env.ADVCONF_REPLICATE_IMAGE_SAFTY_CHECK),
                go_fast: true,
                output_format: 'png',
                output_quality: 100
            });
            break;
        case 'black-forest-labs/flux-2-pro':
            // Flux 2 Pro supports multiple input images (up to 8)
            imageBuffer = await generateImageEditViaReplicate_Flux2Pro({
                images: inputImages,
                userInput: instructions,
                aspect_ratio: 'match_input_image',
                output_format: 'png',
                output_quality: 100,
                seed: undefined,
                resolution: process.env.FLUX2PRO_RESOLUTION || '1 MP',
                safety_tolerance: process.env.FLUX2PRO_SAFETY_TOLERANCE ? Number(process.env.FLUX2PRO_SAFETY_TOLERANCE) : 2,
            });
            break;
        case 'bytedance/seedream-4.5':
            // Seedream 4.5 supports multiple input images (up to 8)
            imageBuffer = await generateImageEditViaReplicate_Seedream45({
                images: inputImages,
                userInput: instructions,
                size: '2K',
                aspect_ratio: 'match_input_image'
            });
            break;
        case 'google/nano-banana-pro':
            // Nano Banana Pro supports multiple input images (up to 8)
            imageBuffer = await generateImageEditViaReplicate_NanaBananaPro({
                images: inputImages,
                userInput: instructions,
                resolution: '2K',
                output_format: 'png',
                safety_filter_level: (process.env.ADVCONF_REPLICATE_IMAGE_SAFTY_CHECK === 'false') ? 'block_only_high' : 'block_medium_and_above'
            });
            break;
        case 'black-forest-labs/flux-2-klein-4b':
            // Flux 2 Klein 4B supports multiple input images (up to 5)
            imageBuffer = await generateImageEditViaReplicate_Flux2Klein4b({
                images: inputImages,
                userInput: instructions,
                aspect_ratio: 'match_input_image',
                disable_safety_checker: !Boolean(process.env.ADVCONF_REPLICATE_IMAGE_SAFTY_CHECK),
                go_fast: false,
                output_format: 'png',
                output_quality: 100
            });
            break;
        case 'black-forest-labs/flux-2-klein-9b-base':
            // Flux 2 Klein 9B Base supports multiple input images (up to 5)
            imageBuffer = await generateImageEditViaReplicate_Flux2Klein9bBase({
                images: inputImages,
                userInput: instructions,
                aspect_ratio: 'match_input_image',
                disable_safety_checker: !Boolean(process.env.ADVCONF_REPLICATE_IMAGE_SAFTY_CHECK),
                go_fast: true,
                guidance: 4,
                output_format: 'png',
                output_quality: 100
            });
            break;
        case 'black-forest-labs/flux-2-max':
            // Flux 2 Max supports multiple input images (up to 8)
            imageBuffer = await generateImageEditViaReplicate_Flux2Max({
                images: inputImages,
                userInput: instructions,
                aspect_ratio: 'match_input_image',
                output_format: 'webp',
                output_quality: 80,
                ...(process.env.FLUX2MAX_RESOLUTION && { resolution: process.env.FLUX2MAX_RESOLUTION }),
                ...(process.env.FLUX2MAX_SAFETY_TOLERANCE && { safety_tolerance: Number(process.env.FLUX2MAX_SAFETY_TOLERANCE) }),
            });
            break;
        default:
            throw new Error(`Unsupported image edit model: ${ImageEdit_Model}`);
    }
    return imageBuffer;
}

async function upscaleImage(imageBuffer, upscaleModel) {
    let upscaledImageBuffer = [];
    // Moderate the image before proceeding
    const modResult = await moderateContent({ image: imageBuffer });
    if (modResult.flagged) {
        throw new Error("The provided image was flagged by the moderation system.");
    }

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

    // Moderate user input before processing
    const modResult = await moderateContent({ text: userInput });
    if (modResult.flagged) {
        throw new Error("The provided text was flagged by the moderation system.");
    }
    // Use cleaned text from moderation
    userInput = modResult.cleanedText;
    
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
    
    // Moderate the optimized prompt from the AI. Just in case the AI is unhappy today
    const optimizedModResult = await moderateContent({ text: optimized_Prompt });
    if (optimizedModResult.flagged) {
        throw new Error("The AI-generated optimized prompt was flagged by the moderation system.");
    }
    // Use cleaned text from moderation
    optimized_Prompt = optimizedModResult.cleanedText;
    return optimized_Prompt;
}


// Function to adapt the image prompt used for image generation to align with the users input as requested via chat refinement
async function adaptImagePrompt(currentPrompt, refinementRequest, userID) {
    console.log("--Adapting the prompt based on user refinement request--");

    const Prompt_Model = process.env.IMAGE_PROMPT_MODEL;
    const temperature = process.env.IMAGE_OPTIMIZER_TEMPERATURE;
    const systemMessage = process.env.IMAGE_CHAT_REFINEMENT_SYSTEM_MESSAGE;
    const userMessageTemplate = process.env.IMAGE_CHAT_REFINEMENT_USER_MESSAGE;

    // Moderate the refinement request before processing
    const modResult = await moderateContent({ text: refinementRequest });
    if (modResult.flagged) {
        throw new Error("The refinement request was flagged by the moderation system.");
    }
    // Use cleaned text from moderation
    refinementRequest = modResult.cleanedText;

    // Generate a hashed user ID to send to openai instead of the original user ID
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
    console.log("Refined prompt prior to moderation:\n", refinedPrompt);
    // Extract the prompt between <START_PROMPT> and <END_PROMPT>
    const promptMatch = refinedPrompt.match(/<PROMPT>([\s\S]+?)<\/PROMPT>/);
    if (promptMatch && promptMatch[1]) {
        refinedPrompt = promptMatch[1].trim();
    } else {
        console.error('Refined prompt markers not found.');
        throw new Error('Failed to extract refined prompt.');
    }

    // Moderate the AI-generated refined prompt
    const refinedModResult = await moderateContent({ text: refinedPrompt });
    if (refinedModResult.flagged) {
        throw new Error("The AI-generated refined prompt was flagged by the moderation system.");
    }
    // Use cleaned text from moderation
    refinedPrompt = refinedModResult.cleanedText;

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
        'stable-diffusion-xl-1024-v1-0': { 'square': '1024x1024', 'tall': '768x1344', 'wide': '1344x768' },
        'dall-e-3': { 'square': '1024x1024', 'tall': '1024x1792', 'wide': '1792x1024' },
        'stable-diffusion-v1-6': { 'square': '512x512', 'tall': '512x896', 'wide': '896x512' },
        'sd3.5-large': { 'square': '1:1', 'tall': '9:16', 'wide': '16:9' },
        'sd3.5-large-turbo': { 'square': '1:1', 'tall': '9:16', 'wide': '16:9' },
        'sd3.5-medium': { 'square': '1:1', 'tall': '9:16', 'wide': '16:9' },
        'black-forest-labs/flux-schnell': { 'square': '1:1', 'tall': '9:16', 'wide': '16:9' },
        'black-forest-labs/flux-dev': { 'square': '1:1', 'tall': '9:16', 'wide': '16:9' },
        'black-forest-labs/flux-2-dev': { 'square': '1:1', 'tall': '9:16', 'wide': '16:9', 'custom': 'custom' },
        'black-forest-labs/flux-2-pro': { 'square': '1:1', 'tall': '9:16', 'wide': '16:9', 'custom': 'custom' },
        'bytedance/seedream-3': { 'square': '1:1', 'tall': '9:16', 'wide': '16:9' },
        'google/imagen-4-fast': { 'square': '1:1', 'tall': '9:16', 'wide': '16:9' },
        'google/imagen-4': { 'square': '1:1', 'tall': '9:16', 'wide': '16:9' },
        'google/imagen-4-ultra': { 'square': '1:1', 'tall': '9:16', 'wide': '16:9' },
        'bytedance/seedream-4.5': { 'square': '1:1', 'tall': '9:16', 'wide': '16:9' },
        'google/nano-banana-pro': { 'square': '1:1', 'tall': '9:16', 'wide': '16:9', '4:3': '4:3', '3:4': '3:4' },
        'black-forest-labs/flux-2-klein-4b': { 'square': '1:1', 'tall': '9:16', 'wide': '16:9' },
        'black-forest-labs/flux-2-klein-9b-base': { 'square': '1:1', 'tall': '9:16', 'wide': '16:9' },
        'black-forest-labs/flux-2-max': { 'square': '1:1', 'tall': '9:16', 'wide': '16:9', 'custom': 'custom' }
    };
    if (!dimensionsMap[imageModel]) {
        throw new Error(`Unsupported image model for text to image generation: ${imageModel}`);
    }
    const dims = dimensionsMap[imageModel];
    return dims[dimensionType] || 'Invalid dimension type';
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
