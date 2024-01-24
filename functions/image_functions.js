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
/* End getting required modules */

/* Some global variables for ease of access */
const apiHost = 'https://api.stability.ai';

// File paths
const SETTINGS_FILE_PATH = './settings.ini';
const API_KEYS_FILE_PATH = './api_keys.ini';

/* Acquiring Global values */
const config = getIniFileContent(SETTINGS_FILE_PATH);
const apiKeys = getIniFileContent(API_KEYS_FILE_PATH);

// Validate API keys
validateApiKeys(apiKeys);
const StabilityAIKey = apiKeys.Keys.StabilityAI;
const openAIKey = apiKeys.Keys.OpenAI;
const openai = new OpenAI({ apiKey: openAIKey });
// This is a profanity filter that will prevent the bot from passing profanity and other rude words to the generator
// It can be enabled or disabled in the config.json file
const profanityFilterEnabled = filterCheck();
const saveToDiskEnabled = saveToDiskCheck();
console.log(`Profanity filter -- /image == ${profanityFilterEnabled ? 'ENABLED' : 'DISABLED'}`);
console.log(`Save images to disk -- /image == ${saveToDiskEnabled ? 'ENABLED' : 'DISABLED'}`);
/* End of Acquiring values */


/* Functions */
// Documentation:
// https://platform.stability.ai/docs/api-reference#tag/v1generation/operation/textToImage
async function generateImage(userInput, imageModel, dimensions, numberOfImages, cfg, steps, seed, userID) {
    // Creates an empty array to store the image buffers in
    let imageBuffer = [];
    const promises = [];
    // Generates a randomID integer to be used in the file name for identification
    randomID.generate();
    // Get the correct dimensions for the image
    const trueDimensions = getDimensions(imageModel, dimensions);
    // Generate a hashed user ID to send to openai instead of the original user ID
    const hashedUserID = await generateHashedUserId(userID);

    /* OpenAI image generation */
    // Check what Image_Model is configured in settings.ini
    if (imageModel == "dall-e-3") {
        console.log("---Generating image via OpenAI---");
        console.log("\n\n--Sending generation request to OpenAI with the following parameters: \n" +
            "-Prompt: " + userInput + "\n" +
            "-Number of images: " + numberOfImages + "\n" +
            "-Dimensions: " + trueDimensions + "\n" +
            "-Dall-E Model: " + "dall-e-3" + "\n" +
            "-User ID: " + hashedUserID + "\n\n");
        for (let i = 0; i < numberOfImages; i++) {
            // Have image generation run in parallel since with OpenAI we can only make one image request at this time
            const promise = (async () => {
                const response = await openai.images.generate({
                    model: "dall-e-3",
                    prompt: userInput,
                    n: 1,
                    size: trueDimensions,
                    quality: "standard", // "standard" or "hd" TODO: Add this to command options
                    style: "vivid", // "natural" or "vivid  TODO: Add this to command options
                    response_format: "b64_json",
                    user: toString(hashedUserID),
                });
                console.log("--Image #" + (i + 1) + " generation completed--\n");
                const revised_prompt = response.data[0].revised_prompt;
                console.log("-OpenAI Revised String for Image #" + (i + 1) + ": \n" + revised_prompt + "\n");
                const saveBuffer = await sharp((Buffer.from(response.data[0].b64_json, 'base64')))[config.Advanced.Save_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();

                // Saves images to disk if the setting is enabled, otherwise only send them to Discord
                if (saveToDiskCheck()) {
                    fs.writeFileSync(
                        `./Outputs/txt2img_${randomID.get()}_${i + 1}.${config.Advanced.Save_Images_As}`,
                        saveBuffer
                    );
                    console.log(`Saved Image: ./Outputs/txt2img_${randomID.get()}.${config.Advanced.Save_Images_As}`);
                }

                // Convert the image to the specified format for sending
                // If Save and Send are the same then don't convert it again
                if (config.Advanced.Save_Images_As == config.Advanced.Send_Images_As) {
                    imageBuffer.push(saveBuffer);
                } else {
                    const sendBuffer = await sharp(saveBuffer)[config.Advanced.Send_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
                    imageBuffer.push(sendBuffer);
                }
                // Resolve the promises    
            })();
            // Push the promise to the array
            promises.push(promise);
        }
        // Waits for all the promises to resolve before returning the image buffer
        await Promise.allSettled(promises);
        // return the image buffer full of the generated images
        console.log("Image generated and converted to " + config.Advanced.Send_Images_As + " format");
        return imageBuffer;
    }
    /* End OpenAI image generation */

    /* REST API call to StabilityAI */
    console.log("---Generating image---");
    console.log("\n\n--Sending generation request to StabilityAI with the following parameters: \n" +
        "-Prompt: " + userInput + "\n" +
        "-Dimensions: " + trueDimensions + "\n" +
        "-Stable Diffusion Engine: " + imageModel + "\n" +
        "-cfg-scale: " + cfg + "\n" +
        "-Steps: " + steps + "\n" +
        "-Seed: " + seed + "\n\n");

    // Split the dimensions string into height and width
    const [width, height] = trueDimensions.split('x').map(Number);
    console.log("Width: " + width + "   Height: " + height);

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
                    // A generic negative prompt to guide the generation to be higher quality overall. This is a temporary solution
                    // TODO: This should be generated by the AI optimizer but at the moment it is extremely unreliable with gpt 3.5 and
                    //      gpt-4 is not yet perfected and will need a better prompt to guide it.
                    "text": "low resolution, bad quality, warped image, jpeg artifacts, worst quality, lowres, blurry",
                    "weight": -1
                }
            ],
            // Defines the parameters for the image generation specified by the user
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
            console.log("Generation completed response heard!");
            const responseJSON = await response.json();

            for (const [index, image] of responseJSON.artifacts.entries()) {
                // Have image conversion run in parallel
                const promise = (async () => {
                    // Convert the image to the specified format for saving
                    const saveBuffer = await sharp(Buffer.from(image.base64, 'base64'))[config.Advanced.Save_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();

                    // Saves images to disk if the setting is enabled, otherwise only send them to Discord
                    if (saveToDiskCheck()) {
                        fs.writeFileSync(
                            `./Outputs/txt2img_${randomID.get()}_${index + 1}.${config.Advanced.Save_Images_As}`,
                            saveBuffer
                        );
                        console.log(`Saved Image: ./Outputs/txt2img_${randomID.get()}_${index + 1}.${config.Advanced.Save_Images_As}`);
                    }

                    // Convert the image to the specified format for sending
                    // If Save and Send are the same then don't convert it again
                    if (config.Advanced.Save_Images_As == config.Advanced.Send_Images_As) {
                        imageBuffer.push(saveBuffer);
                    } else {
                        const sendBuffer = await sharp(saveBuffer)[config.Advanced.Send_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
                        imageBuffer.push(sendBuffer);
                    }
                })();
                // Push the promise to the array
                promises.push(promise);
            }
        })
        .catch((error) => {
            console.error(error);
            // Throws another error to be caught when the function is called
            throw new Error(`Error: ${error}`);
        });

    // return the image buffer full of the generated images
    // Waits for all the promises to resolve before returning the image buffer
    await Promise.allSettled(promises);
    return imageBuffer;
    /* End REST API call to StabilityAI */
}

//Documentation
// https://platform.stability.ai/docs/api-reference#tag/v1generation/operation/imageToImage
async function generateImageToImage(imageFile, userInput, img2imgStrength, cfg, steps, seed, userID) {
    let imageBuffer = [];
    const jpegBuffer = await sharp(imageFile).jpeg().toBuffer();
    // Generate a hashed user ID to send to openai instead of the original user ID
    const hashedUserID = await generateHashedUserId(userID);

    const formData = new FormData();
    formData.append('init_image', jpegBuffer);
    formData.append('init_image_mode', "IMAGE_STRENGTH");
    formData.append('image_strength', img2imgStrength);
    formData.append('steps', steps);
    formData.append('seed', seed);
    formData.append('cfg_scale', cfg);
    formData.append('samples', 1);
    formData.append('text_prompts[0][text]', userInput)
    formData.append('text_prompts[0][weight]', 1);
    formData.append('text_prompts[1][text]', 'low resolution, bad quality, warped image, jpeg artifacts, worst quality, lowres, blurry')
    formData.append('text_prompts[1][weight]', -1);

    const response = await fetch(
        "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/image-to-image",
        {
            method: 'POST',
            headers: {
                ...formData.getHeaders(),
                Accept: 'application/json',
                Authorization: StabilityAIKey.toString(),
                'Stability-Client-ID': hashedUserID,
            },
            body: formData,
        }
    );

    if (!response.ok) {
        throw new Error(`Non-200 response: ${await response.text()}`)
    }
    const responseJSON = await response.json();

    imageBuffer = await Promise.all(responseJSON.artifacts.map(async (image, index) => {
        const saveBuffer = await sharp(Buffer.from(image.base64, 'base64'))[config.Advanced.Save_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
        if (saveToDiskCheck()) {
            fs.writeFileSync(
                `./Outputs/img2img_${randomID.get()}_${index + 1}.${config.Advanced.Save_Images_As}`,
                saveBuffer
            );
            console.log(`Saved Image: ./Outputs/img2img_${randomID.get()}_${index + 1}.${config.Advanced.Save_Images_As}`);
        }
        // Converts the image to the specified format for sending
        // If Save and Send are the same then don't convert it again
        if (config.Advanced.Save_Images_As == config.Advanced.Send_Images_As) {
            return saveBuffer;
        } else {
            const sendBuffer = await sharp(saveBuffer)[config.Advanced.Send_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
            return sendBuffer;
        }
    }));

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
    formData.append('image', new Blob([imageBuffer[0]], { type: 'image/png' }));
    formData.append('width', imageBuffer[0].width * 2);

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
        response = await openai.chat.completions.create({
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
        response = await openai.chat.completions.create({
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
    const url = `${apiHost}/v1/user/balance`
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
        case (balance < 50):
            message = 'Almost out of api credits, please consider sending your bot host a few bucks to keep me running ❤️';
            break;
        case (balance < 200):
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
    } else {
        dimensions = 'Invalid image model';
    }

    return dimensions;
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
};
