// File: image.js
// Author: TryFailTryAgain
// Copyright (c) 2023. All rights reserved. For use in Open-Source projects this
// may be freely copied or excerpted with credit to the author.

/* Getting required modules */
const { SlashCommandBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const ini = require('ini');
const Filter = require('bad-words');
const filter = new Filter({ placeHolder: '*' }); // Modify the character used to replace bad words
const Crypto = require('crypto');
const OpenAI = require('openai');
const sharp = require('sharp');
/* End getting required modules */

/* Getting required local files */
const ImageChatModal = require('../../components/imageChatModal.js');
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


module.exports = {
    /* Frame of the command */
    cooldown: 1,
    data: new SlashCommandBuilder()
        .setName('image')
        .setDescription('Generates an image from your prompts!')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('The prompt/idea for the image')
                .setMaxLength(500)
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option.setName('disable-optimization')
                .setDescription('Disables the AI Optimization of the input prompt.')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('dimensions')
                .setDescription('The dimensions of the image. Only affect default SDXL. Default: 1024x1024 aka 1:1')
                .addChoices(
                    { name: '1024 x 1024', value: '1024x1024' },
                    { name: '1152 x 896', value: '1152x896' },
                    { name: '896 x 1152', value: '896x1152' },
                    { name: '1216 x 832', value: '1216x832' },
                    { name: '832 x 1216', value: '832x1216' },
                    { name: '1344 x 768', value: '1344x768' },
                    { name: '768 x 1344', value: '768x1344' },
                    { name: '1536 x 640', value: '1536x640' },
                    { name: '640 x 1536', value: '640x1536' },
                )
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('number-of-images')
                .setDescription('How many images to generate. Default: 1')
                .setMinValue(1)
                .setMaxValue(9)
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('stable-diffusion-model')
                .setDescription('The engine to use for generating the image. Default: SDXL 1.0')
                .setRequired(false)
                .addChoices(
                    { name: 'SDXL 1.0', value: 'stable-diffusion-xl-1024-v1-0' },
                    { name: 'SD 1.6', value: 'stable-diffusion-v1-6' },
                )
        )
        .addIntegerOption(option =>
            option.setName('cfg-scale')
                .setDescription('How closely to follow the prompt. Default:7 from 1-10')
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('steps')
                .setDescription('How many steps to refine the image. More is not always better Default:35')
                .setMinValue(1)
                .setMaxValue(60)
                .addChoices(
                    { name: '15', value: 15 },
                    { name: '25', value: 25 },
                    { name: '30', value: 30 },
                    { name: '40', value: 40 },
                    { name: '50', value: 50 },
                    { name: '60', value: 60 },
                )
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('seed')
                .setDescription('The seed number to use for the image. Defaults to random')
                .setMinValue(1)
                .setMaxValue(4294967295)
                .setRequired(false)
        ),

    /* End of the command framing */

    /* Start of the command functional execution */
    async execute(interaction, client) {
        // Responds to the command to prevent discord timeout and this will display that the bot is thinking
        // Editing with .editReply will remove the loading message and replace it with the new message
        await interaction.deferReply();

        // Gets the user input and other options from the command then optionally filters it if settings.ini - Filter_Naughty_Words is set to true
        // Defaults are set if the user does not provide them
        let userInput = interaction.options.getString('prompt');
        let disableOptimizePrompt = interaction.options.getBoolean('disable-optimization') || false;
        let dimensions = interaction.options.getString('dimensions') || '1024x1024';
        let numberOfImages = interaction.options.getInteger('number-of-images') || 1;
        let sdEngine = interaction.options.getString('stable-diffusion-model') || 'stable-diffusion-xl-1024-v1-0';
        let cfgScale = interaction.options.getInteger('cfg-scale') || 7;
        let steps = interaction.options.getInteger('steps') || 40;
        let seed = interaction.options.getInteger('seed') || await genSeed();
        // Detects if SD 1.6 is selected but the resolution was not manually set. Override its default to 512x512 as it is terrible at 1024x1024
        if (sdEngine == 'stable-diffusion-v1-6' && dimensions == '1024x1024') {
            dimensions = '512x512';
        }
        // Split out the width to check if it is over X during upscaling
        let width = parseInt(dimensions.split('x')[0]);

        // Prompt filtering
        try {
            if (await filterCheck()) {
                userInput = await filterString(userInput);
            }
        } catch (error) {
            console.error(error);
            deleteAndFollowUpEphemeral(interaction, "An error occurred while filtering the prompt. Please try again");
            return;
        }

        /* Image generation */

        // Check if out of API credits
        try {
            if (await getBalance() < 0.23 * numberOfImages) { //current SDXL price is 0.23 credits per image at 40 steps
                deleteAndFollowUpEphemeral(interaction, 'Out of API credits! Please consider donating to your server to keep this bot running!');
                return;
            }
        } catch (error) {
            console.error(error);
            deleteAndFollowUpEphemeral(interaction, "An error occurred while fetching the API balance. Please try again");
            return;
        }
        // Optimize the prompt unless the user has specifically asked not to
        let optimized_Prompt = null;
        if (!disableOptimizePrompt) {
            try {
                optimized_Prompt = await promptOptimizer(userInput, interaction.user.id);
            } catch (error) {
                console.error(error);
                deleteAndFollowUpEphemeral(interaction, "An error occurred while optimizing the prompt. Please try again");
                return;
            }
            // Sets the user input to the new optimized prompt
            userInput = optimized_Prompt;
        }

        // Generate the image
        let imageBuffer = null;
        try {
            imageBuffer = await generateImage(userInput, dimensions, numberOfImages, sdEngine, cfgScale, steps, seed);
        } catch (error) {
            console.error(error);
            if (error.message.includes("Invalid prompts detected")) {
                deleteAndFollowUpEphemeral(interaction, "Invalid prompts detected. Please try again with alternative wording");
            } else {
                deleteAndFollowUpEphemeral(interaction, "An error occurred while generating the image. Please try again");
            }
            return;
        }
        // Adds the generated images to the message attachments that will be returned to discord
        let attachments = [];
        for (let i = 0; i < imageBuffer.length; i++) {
            attachments.push(new AttachmentBuilder(imageBuffer[i]));
        }
        /* End of image generation */

        // Makes the ActionRow and adds the regen, upscale, and chat refinement buttons to it
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('regenerate')
                .setLabel('Regenerate')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔄'),
            new ButtonBuilder()
                .setCustomId('upscale')
                .setLabel('Upscale')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔍'),
            new ButtonBuilder()
                .setCustomId('chatRefinement')
                .setLabel('Chat Refinement')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('💬')
        );
        // Check if multiple images were generated in the request as we can only upscale one at a time
        // If > 1 are generated, Disable the upscale button
        // TODO: Either add an /Upscale command and allow the user to supply an image or add a selector to select which image to upscale
        if (numberOfImages > 1) {
            row.components[1].setDisabled(true);
            //row.components[2].setDisabled(true);
        }

        // Edit the reply to show the generated image and the buttons
        const reply = await interaction.editReply({
            content: await lowBalanceMessage(),
            files: attachments,
            components: [row],
        });


        /* Regenerate button handling */
        // Create an interaction collector to listen for button interactions
        const collectorFilter = i => i.customId === 'regenerate' && i.user.id === interaction.user.id;
        const collector = reply.createMessageComponentCollector({ filter: collectorFilter, time: 7_200_000 }); // 2 hours

        // When the button is clicked, regenerate the image and update the reply
        collector.on('collect', async i => {
            // Disable the buttons to prevent double actions
            row.components.forEach(component => component.setDisabled(true));
            // Update to show the disabled button but keep everything else as is
            // This may be a silly implementation but it works and the other methods I tried... work less
            await i.update({
                components: [row],
            });
            // Check if out of API credits
            try {
                if (await getBalance() < 0.23 * numberOfImages) { //current SDXL price is 0.23-0.5 credits per image at 40 steps
                    followUpEphemeral(interaction, "Out of API credits! Please consider donating to your server to keep this bot running!");
                }
            } catch (error) {
                console.error(error);
                followUpEphemeral(interaction, "An error occurred while fetching the API balance. Please try again");
                return;
            }
            // Generate a new seed for new images
            seed = await genSeed();
            // Regenerate the image and update the reply
            try {
                imageBuffer = await generateImage(userInput, dimensions, numberOfImages, sdEngine, cfgScale, steps, seed);
            } catch (error) {
                console.error(error);
                followUpEphemeral(interaction, "An error occurred while regenerating the image. Please try again");
                return;
            }
            // Updates the width back the the base that was defined for the next upscale for checking the max width
            width = parseInt(dimensions.split('x')[0]);
            // Clears out the old attachments and build a new one with new images to be sent to discord
            attachments = [];
            for (let i = 0; i < imageBuffer.length; i++) {
                attachments.push(new AttachmentBuilder(imageBuffer[i]));
            }
            // Check if multiple images were generated in the request as we can only upscale or refine one at a time
            // TODO: see above todo after action row creation
            row.components[1].setDisabled(numberOfImages > 1);
            // Re-enable the buttons that aren't affected by the number of images now that we have the new image to update with
            row.components[0].setDisabled(false);
            row.components[2].setDisabled(false);

            await i.editReply({
                content: await lowBalanceMessage(),
                files: attachments,
                components: [row],
            });
        });
        /* End of regenerate button handling */


        /* Upscale button handling */
        // Builds the collector for the upscale button
        const upscaleCollectorFilter = i => i.customId === 'upscale' && i.user.id === interaction.user.id;
        const upscaleCollector = reply.createMessageComponentCollector({ filter: upscaleCollectorFilter, time: 7_200_000 }); // 2 hours

        // When the upscale button is clicked, upscale the most recent image and update the reply
        upscaleCollector.on('collect', async i => {
            // Disables the buttons to prevent more clicks
            row.components.forEach(component => component.setDisabled(true));
            // Update to show the disabled button but keep everything else as is
            await i.update({
                components: [row],
            });

            // Check if out of API credits
            try {
                if (await getBalance() < 0.2) { //current esrgan price is a flat 0.2 credits per image
                    followUpEphemeral(interaction, "Out of API credits! Please consider donating to your server to keep this bot running!");
                }
            } catch (error) {
                console.error(error);
                followUpEphemeral(interaction, "An error occurred while fetching the API balance. Please try again");
                return;
            }
            // Upscale the most recent image and update the reply
            try {
                imageBuffer = await upscaleImage(imageBuffer, width);
                // Double the width for the next upscale for max width check
                width = width * 2;
            } catch (error) {
                console.error(error);
                await interaction.followUp({
                    content: error.message,
                    ephemeral: true
                });
                return;
            }
            // clears out the old attachments and build a new one with the image to be sent to discord
            attachments = [];
            for (let i = 0; i < imageBuffer.length; i++) {
                attachments.push(new AttachmentBuilder(imageBuffer[i]));
            }
            // Re-enables the buttons now that we have the new image to update with
            row.components.forEach(component => component.setDisabled(false));
            // Updates the reply with the new image
            await i.editReply({
                content: "Upscaled to " + width + "px wide! " + await lowBalanceMessage(),
                files: attachments,
                components: [row],
            });
        });
        /* End of upscale button handling */


        /* Chat refinement button handling */
        // Create the modal
        const chatRefineModal = ImageChatModal.createImageChatModal();

        // Builds the collector for the chat refinement button
        const chatRefinementCollectorFilter = i => i.customId === 'chatRefinement' && i.user.id === interaction.user.id;
        const chatRefinementCollector = reply.createMessageComponentCollector({ filter: chatRefinementCollectorFilter, time: 7_200_000 }); // 2 hours

        // When the chat refinement button is clicked, open the modal and handle the submission
        chatRefinementCollector.on('collect', async (i) => {
            try {
                // Show the modal first
                await i.showModal(chatRefineModal);
                // Disables the buttons to prevent more clicks
                row.components.forEach(component => component.setDisabled(true));
                // .editReply() is used here instead of .update() because the modal being shown counts as out first interaction and .update() will throw
                //      an error as the interaction has already been responded to
                await i.editReply({
                    components: [row],
                });

                // Wait for the modal submit interaction
                const chatRefinementRequest = await ImageChatModal.waitForModalSubmit(i);
                console.log(chatRefinementRequest);

                // set the userInput aka the prompt to the new adapted prompt
                userInput = await adaptImagePrompt(userInput, chatRefinementRequest, i.user.id);
                // Pass all the parameters to the image generation function with identical seed so images are closer to the original
                try {
                    imageBuffer = await generateImage(userInput, dimensions, numberOfImages, sdEngine, cfgScale, steps, seed);
                } catch (error) {
                    console.error(error);
                    followUpEphemeral(interaction, "An error occurred while generating the refined image. Please try again");
                    return;
                }
                // // clears out the old attachments and build a new one with the image to be sent to discord
                // attachments = [];

                // Slot the new images into the attachments array at the beginning so they are displayed first
                for (let i = 0; i < imageBuffer.length; i++) {
                    attachments.unshift(new AttachmentBuilder(imageBuffer[i]));
                }
                // Re enable the buttons now that we have the new image to update with
                row.components.forEach(component => component.setDisabled(false));
                // Sends the new image to discord
                await i.editReply({
                    content: '⬅️New Images first \n Original Images last➡️ \n' + await lowBalanceMessage(),
                    files: attachments,
                    components: [row],
                });
            } catch (error) {
                // Handle errors, such as a timeout or other issues
                console.error(error);
                followUpEphemeral(interaction, "An error occurred while processing the chat refinement request. Please try again or contact the bot host if this persists");
            }
        });

        // When the collectors time runs out, disable the buttons
        collector.on('end', async () => {
            row.components.forEach(component => component.setDisabled(true));
            try {
                await interaction.editReply({
                    components: [row],
                });
            } catch (error) {
                console.error(error);
                // Assuming `followUpEphemeral` is a custom function to send a follow-up message
                followUpEphemeral(interaction, "An error occurred while disabling the buttons. Please try again or contact the bot host if this persists");
            }
        });
    }
};

/* Functions */
// Documentation:
// https://platform.stability.ai/docs/api-reference#tag/v1generation/operation/textToImage
async function generateImage(userInput, dimensions, numberOfImages, sdEngine, cfg, steps, seed) {
    /* REST API call to StabilityAI */
    //Checks settings.ini for image logging to be enabled or disabled
    console.log("---Generating image---");
    console.log("\n\n---Sending generation request to StabilityAI with the following parameters: \n" +
        "-Prompt: " + userInput + "\n" +
        "-Dimensions: " + dimensions + "\n" +
        "-Stable Diffusion Engine: " + sdEngine + "\n" +
        "-cfg-scale: " + cfg + "\n" +
        "-Steps: " + steps + "\n" +
        "-Seed: " + seed + "\n\n");

    // Creates an empty array to store the image buffers in
    let imageBuffer = [];
    // Generates a randomID integer to be used in the file name for identification
    randomID.generate();
    // Split the dimensions string into height and width
    const [width, height] = dimensions.split('x').map(Number);
    console.log("Width: " + width + "   Height: " + height);

    await fetch(`${apiHost}/v1/generation/${sdEngine}/text-to-image`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `${StabilityAIKey}`,
            'Stability-Client-ID': `Full-Stack-AI-Content-Generator-Discord-Bot`,
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
                    "text": "low resolution, bad art, worst quality, lowres, blurry",
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
                // Convert the image to the specified format for saving
                const saveBuffer = await sharp(Buffer.from(image.base64, 'base64'))[config.Advanced.Save_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();

                // Saves images to disk if the setting is enabled, otherwise only send them to Discord
                if (saveToDiskCheck()) {
                    fs.writeFileSync(
                        `./Outputs/txt2img_${randomID.get()}_${index}.${config.Advanced.Save_Images_As}`,
                        saveBuffer
                    );
                    console.log(`Saved Image: ./Outputs/txt2img_${randomID.get()}_${index}.${config.Advanced.Save_Images_As}`);
                }

                // Convert the image to the specified format for sending
                // If Save and Send are the same then don't convert it again
                if (config.Advanced.Save_Images_As == config.Advanced.Send_Images_As) {
                    imageBuffer.push(saveBuffer);
                } else {
                    const sendBuffer = await sharp(saveBuffer)[config.Advanced.Send_Images_As]({ quality: parseInt(config.Advanced.Jpeg_Quality) }).toBuffer();
                    imageBuffer.push(sendBuffer);
                }
            }
        })
        .catch((error) => {
            console.error(error);
            // Throws another error to be caught when the function is called
            throw new Error(`Error: ${error}`);
        });

    // return the image buffer full of the generated images
    return imageBuffer;
    /* End REST API call to StabilityAI */
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
    console.log("Optimizing prompt...");
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
    console.log("Adapting the prompt based on chat request...");
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
        console.log("---Filtering string...\n");
        input = (filter.clean(input)).toString();
        // Removes the asterisks that the filter replaces the bad words with. Somehow this is not built into the filter to my knowledge
        input = input.replace(/\*/g, '');
        console.log("---The string after filtering is:\n" + input + "\n");
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
/* End of functions */