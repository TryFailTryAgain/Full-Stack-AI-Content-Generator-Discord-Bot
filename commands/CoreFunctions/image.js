// File: image.js
// Author: TryFailTryAgain
// Copyright (c) 2023. All rights reserved. For use in Open-Source projects this
// may be freely copied or excerpted with credit to the author.

/* Getting required modules */
const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const ini = require('ini');
const Filter = require('bad-words');
const filter = new Filter();
/* End getting required modules */

/* Some global variables for ease of access */
const apiHost = process.env.API_HOST || 'https://api.stability.ai';

/* Acquiring values */
// Parse the api_keys.ini file to get the API key for StabilityAI 
const apiKeys = ini.parse(fs.readFileSync('./api_keys.ini', 'utf-8'));
const StabilityAIKey = apiKeys.Keys.StabilityAI;
if (StabilityAIKey == "") {
    throw new Error("The Stability.ai API key is not set. Please set it in the api_keys.ini file");
}

// This is a profanity filter that will prevent the bot from passing profanity and other rude words to the generator
// It can be enabled or disabled in the config.json file
//parse the settings.ini file to get the value of Filter_Naughty_Words
const config = ini.parse(fs.readFileSync('./settings.ini', 'utf-8'));
const inputFilter = config.Advanced.Filter_Naughty_Words;
// Alert console if the profanity filter is enabled or disabled
if (inputFilter == 'true' || inputFilter == 'True' || inputFilter == 'TRUE') {
    console.log("Profanity filter -- /image == ENABLED");

} else if (inputFilter == 'false' || inputFilter == 'False' || inputFilter == 'FALSE'){
    console.log("Profanity filter -- /image == DISABLED");
} else {
    throw new Error("The Filter_Naughty_Words setting in settings.ini is not set to true or false. Please set it to true or false");
}

// Check if images should be saved to disk or not from settings.ini
const saveImages = config.Advanced.Save_Images;
if (saveImages == 'true' || saveImages == 'True' || saveImages == 'TRUE') {
    console.log("Save images to disk -- /image == ENABLED");
} else if (saveImages == 'false' || saveImages == 'False' || saveImages == 'FALSE'){
    console.log("Save images to disk -- /image == DISABLED");
} else {
    throw new Error("The Save_Images setting in settings.ini is not set to true or false. Please set it to true or false");
}
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
                .setMaxLength(200)
                .setRequired(true)
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
                    { name: 'SD 1.5', value: 'stable-diffusion-v1-5' },
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
                .setDescription('How many steps to refine the image. More is not always better Default:30')
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
        ),

    /* End of the command framing */

    /* Start of the command functional execution */
    async execute(interaction) {
        // Responds to the command to prevent discord timeout and this will display that the bot is thinking
        // Editing with .editReply will remove the loading message and replace it with the new message
        await interaction.deferReply();

        // Gets the user input and other options from the command then optionally filters it if settings.ini - Filter_Naughty_Words is set to true
        // Defaults are set if the user does not provide them
        let userInput = interaction.options.getString('prompt');
        let dimensions = interaction.options.getString('dimensions') || '1024x1024';
        let numberOfImages = interaction.options.getInteger('number-of-images') || 1;
        let sdEngine = interaction.options.getString('stable-diffusion-model') || 'stable-diffusion-xl-1024-v1-0';
        let cfgScale = interaction.options.getInteger('cfg-scale') || 7;
        let steps = interaction.options.getInteger('steps') || 30;
        // Detects if SD 1.5 is selected but the resolution was not manually set. Override its default to 512x512 as it is terrible at 1024x1024
        if (sdEngine == 'stable-diffusion-v1-5' && dimensions == '1024x1024') {
            dimensions = '512x512';
        }

        // Prompt filtering
        try {
            if (inputFilter == 'true' || inputFilter == 'True' || inputFilter == 'TRUE') {
                console.log("Filtering prompt...");
                userInput = (filter.clean(userInput)).toString();
                console.log("The user input after filtering is: " + userInput);
            } else {
                console.log("The user input is: " + userInput);
            }
        } catch (error) {
            console.error(error);
            await interaction.deleteReply();
            await interaction.followUp({
                content: "An error occurred while processing the prompt. \n Maybe you typed something you should'nt have? Please try again.",
                ephemeral: true
            });
            // Exit the function early if there is an error
            return;
        }

        //TODO: Add some prompt optimization using openai's API to improve the prompt for better image generation

        /* Image generation */

        // Check if out of API credits
        try {
            if (await getBalance() < 2 * numberOfImages) { //current SDXL price is 1.6-2 credits per image
                await interaction.deleteReply();
                await interaction.followUp({
                    content: 'Out of API credits! Please consider donating to your server to keep this bot running!',
                    ephemeral: true
                });
            }
        } catch (error) {
            console.error(error);
            await interaction.deleteReply();
            await interaction.followUp({
                content: "An error occurred while fetching the API balance. Please try again",
                ephemeral: true
            });
            return;
        }

        console.log("Sending generation request to StabilityAI with the following parameters: \n" +
            "Prompt: " + userInput + "\n" +
            "Dimensions: " + dimensions + "\n" +
            "Stable Diffusion Engine: " + sdEngine + "\n" +
            "cfg-scale: " + cfgScale + "\n" +
            "Steps: " + steps + "\n");
        let imageBuffer = null;
        try {
            imageBuffer = await generateImage(userInput, dimensions, numberOfImages, sdEngine, cfgScale, steps);
        } catch (error) {
            console.error(error);
            await interaction.deleteReply();
            await interaction.followUp({
                content: "An error occurred while generating the image. Please try again",
                ephemeral: true
            });
            return;
        }
        let attachments = [];
        for (let i = 0; i < imageBuffer.length; i++) {
            attachments.push(new AttachmentBuilder(imageBuffer[i]));
          }


        // Replies to the user with the generated image by editing the previous reply
        await interaction.editReply({
            // TODO: Make this dynamically get the file name
            content: await lowBalance(),
            files: attachments,
        });
        /* End of image generation */
    }
};

async function generateImage(userInput, dimensions, numberOfImages, sdEngine, cfg, steps) {
    /* REST API call to StabilityAI */
    //Checks settings.ini for image logging to be enabled or disabled


    console.log("Generating image...");
    // Creates an empty array to store the image buffers in
    let imageBuffer = [];
    // Generates a randomID integer to be used in the file name for identification
    const randomID = Math.floor(Math.random() * 1000000000);
    console.log("The generated images will have Random ID: " + randomID);
    // Split the dimensions string into height and width
    const [width, height] = dimensions.split('x').map(Number);
    console.log("Width: " + width + "   Height: " + height);

    await fetch(`${apiHost}/v1/generation/${sdEngine}/text-to-image`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `${StabilityAIKey}`,
        },
        body: JSON.stringify({
            text_prompts: [
                {
                    text: userInput,
                },
            ],
            // Defines the parameters for the image generation specified by the user
            cfg_scale: cfg,
            width: width,
            height: height,
            steps: steps,
            samples: numberOfImages,
        }),
    })
        .then(async (response) => {
            if (!response.ok) {
                throw new Error(`Non-200 response: ${await response.text()}`);
            }
            console.log("Generation completed response heard!");
            const responseJSON = await response.json();

            responseJSON.artifacts.forEach((image, index) => {
                // Saves images to disk if the setting is enabled, otherwise only send them to discord
                if (inputFilter == 'true' || inputFilter == 'True' || inputFilter == 'TRUE') {
                fs.writeFileSync(
                    `./Outputs/txt2img_${randomID}_${index}.png`,
                    Buffer.from(image.base64, 'base64')
                );
                console.log(`Saved Image: ./Outputs/txt2img_${randomID}_${index}.png`);
                }
                // Pushes the image buffer to the buffer array to be returned
                imageBuffer.push(Buffer.from(image.base64, 'base64'));
            });
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

async function lowBalance() {
    const balance = await getBalance();
    let message = '';
    switch (true) {
        case (balance < 100):
            message = 'Almost out of api credits, please consider sending your server host a few bucks to keep me running <3';
            break;
        case (balance < 400):
            message = 'Consider funding your server host $1 <3';
            break;
        case (balance >= 600):
            break;
    }
    return message;
}