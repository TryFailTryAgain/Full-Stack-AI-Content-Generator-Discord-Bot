// File: image.js
// Author: TryFailTryAgain
// Copyright (c) 2023. All rights reserved. For use in Open-Source projects this
// may be freely copied or excerpted with credit to the author.

/* Getting required modules */
const { SlashCommandBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const ini = require('ini');
const Filter = require('bad-words');
const filter = new Filter({ placeHolder: '*' });
const OpenAI = require('openai');
/* End getting required modules */

/* Some global variables for ease of access */
const apiHost = process.env.API_HOST || 'https://api.stability.ai';

/* Acquiring Global values */
//parse the settings.ini file to get the values
const config = ini.parse(fs.readFileSync('./settings.ini', 'utf-8'));

// Parse the api_keys.ini file to get the API key for StabilityAI and OpenAI
const apiKeys = ini.parse(fs.readFileSync('./api_keys.ini', 'utf-8'));
const StabilityAIKey = apiKeys.Keys.StabilityAI;
if (StabilityAIKey == "") {
    throw new Error("The Stability.ai API key is not set. Please set it in the api_keys.ini file");
}
const openAIKey = apiKeys.Keys.OpenAI;
if (openAIKey == "") {
    throw new Error("The OpenAI API key is not set. Please set it in the api_keys.ini file");
}
const openai = new OpenAI({apiKey: openAIKey});

// This is a profanity filter that will prevent the bot from passing profanity and other rude words to the generator
// It can be enabled or disabled in the config.json file
if (filterCheck()) {
    console.log("Profanity filter -- /image == ENABLED");
} else {
    console.log("Profanity filter -- /image == DISABLED");
}
// Check if images should be saved to disk or not from settings.ini
if (saveToDiskCheck()) {
    console.log("Save images to disk -- /image == ENABLED");
}
else {
    console.log("Save images to disk -- /image == DISABLED");
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
        .addBooleanOption(option =>
            option.setName('stylize-prompt')
                .setDescription('Stylize-prompt the prompt using the automatic prompt stylize')
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
        let optimizePrompt = interaction.options.getBoolean('stylize-prompt');
        let dimensions = interaction.options.getString('dimensions') || '1024x1024';
        let numberOfImages = interaction.options.getInteger('number-of-images') || 1;
        let sdEngine = interaction.options.getString('stable-diffusion-model') || 'stable-diffusion-xl-1024-v1-0';
        let cfgScale = interaction.options.getInteger('cfg-scale') || 7;
        let steps = interaction.options.getInteger('steps') || 35;
        // Detects if SD 1.5 is selected but the resolution was not manually set. Override its default to 512x512 as it is terrible at 1024x1024
        if (sdEngine == 'stable-diffusion-v1-5' && dimensions == '1024x1024') {
            dimensions = '512x512';
        }
        // Split out the width to check if it is over X during upscaling
        let width = parseInt(dimensions.split('x')[0]);
        // Prompt filtering
        if (await filterCheck()) {
            try {
                userInput = await filterString(userInput);
            } catch (error) {
                console.error(error);
                await interaction.deleteReply();
                await interaction.followUp({
                    content: "An error occurred while filtering the prompt. Please try again",
                    ephemeral: true
                });
                return;
            }
        }

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
        // Optimize the prompt if the user has selected to do so
        let optimized_Prompt = null;
        if (optimizePrompt) {
            try {
                optimized_Prompt = await promptOptimizer(userInput);
                console.log("The optimized prompt before filtering is:\n" + optimized_Prompt);
            } catch (error) {
                console.error(error);
                await interaction.deleteReply();
                await interaction.followUp({
                    content: "An error occurred while optimizing the prompt. Please try again",
                    ephemeral: true
                });
                return;
            }
            // Filter the returned optimized prompt. Just in case the AI is unhappy today
            if (await filterCheck()) {
                try {
                    optimized_Prompt = await filterString(optimized_Prompt);
                    console.log("\nThe optimized prompt after filtering is:\n" + optimized_Prompt);
                } catch (error) {
                    console.error(error);
                    await interaction.deleteReply();
                    await interaction.followUp({
                        content: "An error occurred while filtering the prompt after optimization. Please try again",
                        ephemeral: true
                    });
                    return;
                }
            }
            // Sets the user input to the new optimized prompt
            userInput = optimized_Prompt;
        }

        console.log("\n\nSending generation request to StabilityAI with the following parameters: \n" +
            "Prompt: " + userInput + "\n" +
            "Dimensions: " + dimensions + "\n" +
            "Stable Diffusion Engine: " + sdEngine + "\n" +
            "cfg-scale: " + cfgScale + "\n" +
            "Steps: " + steps + "\n\n");
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


        // Makes the ActionRow and adds the regen and upscale buttons to it
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
                .setEmoji('🔍')
        );
        // Check if multiple images were generated in the request as we can only upscale one at a time
        // If > 1 are generated, Disable the upscale button
        // TODO: Either add an /Upscale command and allow the user to supply an image or add a selector to select which image to upscale
        if (numberOfImages > 1) {
            row.components[1].setDisabled(true);
        }


        // Edit the reply to show the generated image and the button
        const reply = await interaction.editReply({
            content: await lowBalanceMessage(),
            files: attachments,
            components: [row],
        });

        /* Regenerate button handling */
        // Create an interaction collector to listen for button interactions
        const collectorFilter = i => i.customId === 'regenerate' && i.user.id === interaction.user.id;
        const collector = reply.createMessageComponentCollector({ filter: collectorFilter, time: 300_000 });

        // When the button is clicked, regenerate the image and update the reply
        collector.on('collect', async i => {
            // Disable the buttons to prevent double actions
            row.components[0].setDisabled(true);
            row.components[1].setDisabled(true);
            // Update to show the disabled button but keep everything else as is
            // This may be a silly implementation but it works and the other methods I tried... work less
            await i.update({
                components: [row],
            });
            // Check if out of API credits
            try {
                if (await getBalance() < 2 * numberOfImages) { //current SDXL price is 1.6-2 credits per image
                    await interaction.followUp({
                        content: 'Out of API credits! Please consider donating to your server to keep this bot running!',
                        ephemeral: true
                    });
                }
            } catch (error) {
                console.error(error);
                await interaction.followUp({
                    content: "An error occurred while fetching the API balance. Please try again",
                    ephemeral: true
                });
                return;
            }
            // Regenerate the image and update the reply
            try {
                imageBuffer = await generateImage(userInput, dimensions, numberOfImages, sdEngine, cfgScale, steps);
            } catch (error) {
                console.error(error);
                await interaction.followUp({
                    content: "An error occurred while regenerating the image.",
                    ephemeral: true
                });
                return;
            }
            // Updates the width back the the base that was defined for the next upscale for checking the max width
            width = parseInt(dimensions.split('x')[0]);
            // Clears out the old attachments and build a new one with new images to be sent to discord
            attachments = [];
            for (let j = 0; j < imageBuffer.length; j++) {
                attachments.push(new AttachmentBuilder(imageBuffer[j]));
            }
            // Re-enable the button now that we have the new image to update with
            row.components[0].setDisabled(false);
            // Check if multiple images were generated in the request as we can only upscale one at a time
            // TODO: see above todo after action row creation
            if (numberOfImages > 1) {
                row.components[1].setDisabled(true);
            } else {
                row.components[1].setDisabled(false);
            }
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
        const upscaleCollector = reply.createMessageComponentCollector({ filter: upscaleCollectorFilter, time: 300_000 });

        // When the upscale button is clicked, upscale the most recent image and update the reply
        upscaleCollector.on('collect', async i => {
            // Disables the buttons to prevent more clicks
            row.components[0].setDisabled(true);
            row.components[1].setDisabled(true);
            // Update to show the disabled button but keep everything else as is
            await i.update({
                components: [row],
            });

            // Check if out of API credits
            try {
                if (await getBalance() < 0.2) { //current esrgan price is a flat 0.2 credits per image
                    await interaction.followUp({
                        content: 'Out of API credits! Please consider donating to your server to keep this bot running!',
                        ephemeral: true
                    });
                }
            } catch (error) {
                console.error(error);
                await interaction.followUp({
                    content: "An error occurred while fetching the API balance. Please try again",
                    ephemeral: true
                });
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
            for (let j = 0; j < imageBuffer.length; j++) {
                attachments.push(new AttachmentBuilder(imageBuffer[j]));
            }
            // Re-enables the buttons now that we have the new image to update with
            row.components[0].setDisabled(false);
            row.components[1].setDisabled(false);
            // Updates the reply with the new image
            await i.editReply({
                content: "Upscaled to " + width + "px wide! " + await lowBalanceMessage(),
                files: attachments,
                components: [row],
            });
        });

        // When the collectors time runs out, disable the buttons
        collector.on('end', async () => {
            row.components[0].setDisabled(true);
            row.components[1].setDisabled(true);
            await interaction.editReply({
                components: [row],
            });
        });
        /* End of upscale button handling */
    }
};
/* End of image generation */

/* Functions */
// Documentation:
// https://platform.stability.ai/docs/api-reference#tag/v1generation/operation/textToImage
async function generateImage(userInput, dimensions, numberOfImages, sdEngine, cfg, steps) {
    /* REST API call to StabilityAI */
    //Checks settings.ini for image logging to be enabled or disabled
    console.log("Generating image...");
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
                // Saves images to disk if the setting is enabled, otherwise only send them to Discord
                if (saveToDiskCheck()) {
                    fs.writeFileSync(
                        `./Outputs/txt2img_${randomID.get()}_${index}.png`,
                        Buffer.from(image.base64, 'base64')
                    );
                    console.log(`Saved Image: ./Outputs/txt2img_${randomID.get()}_${index}.png`);
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

// Documentation:
// https://platform.stability.ai/docs/api-reference#tag/v1generation/operation/upscaleImage
async function upscaleImage(imageBuffer, width) {
    const engineId = 'esrgan-v1-x2plus';

    // Grab the randomID of the previous generation to be used in the file name to correlate it with 
    // the original image
    console.log("Upscaled image will should have identical Random ID: " + randomID.get());

    // Check if the width if over 2048px
    if (width >= 2048) {
        throw new Error("The image is too large to upscale. Please use an image that is 2048px or smaller");
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

async function filterCheck() {
    const inputFilter = config.Advanced.Filter_Naughty_Words;
    // Alert console if the profanity filter is enabled or disabled
    if (inputFilter == 'true' || inputFilter == 'True' || inputFilter == 'TRUE') {
        return true;

    } else if (inputFilter == 'false' || inputFilter == 'False' || inputFilter == 'FALSE') {
        return false;
    } else {
        throw new Error("The Filter_Naughty_Words setting in settings.ini is not set to true or false. Please set it to true or false");
    }
}

async function filterString(input) {
    try {
        console.log("Filtering string...\n String: " + input);
        input = (filter.clean(input)).toString();
        // Removes the asterisks that the filter replaces the bad words with. Somehow this is not built into the filter to my knowledge
        input = input.replace(/\*/g, '');
        console.log("The string after filtering is:\n" + input);
    } catch (error) {
        console.error(error);
        // Throws another error to be caught when the function is called
        throw new Error(`Error: ${error}`);
    }
    return input;
}

// Function to optimize the prompt using openai's API

async function promptOptimizer(userInput) {
    // Send the prompt to openai's API to optimize it
    // TODO: Move system and user messages to settings.ini
    console.log("Optimizing prompt...");
    let response = null;
    try {
        response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                {
                    // Credit to @night from FlowGPT.com for this prompt. It was the first to appear when searching for a prompt, so here it is. 
                    // It may or may not be the best, I have not tested, but it is very popular so maybe. 
                    // Remember that you are responsible for your own generations. This prompt comes with no liability or warranty.
                    "role": "system",
                    "content": "You are an AI text-to-image prompt generator, your primary role is to generate detailed, dynamic, and stylized prompts for image generation. Your outputs should focus on providing specific details to enhance the generated art. Respond with no other content than the image prompts\n\nFocus on emphasizing key elements like characters, objects, environments, or clothing to provide more details, as details can be lost in AI-generated art.\n\n- Ensure that all relevant tagging categories are covered.\n- Add unique touches to each output, making it lengthy, detailed, and stylized.\n- Show, dont tell; instead of tagging -exceptional artwork- provide precise details.\n- Ensure the output is returned as a string with no wrapping characters or other details.\n\n"
                },
                {
                    // Credit to @night from FlowGPT.com for this prompt. It was the first to appear when searching for a prompt, so here it is. 
                    // It may or may not be the best, I have not tested, but it is very popular so maybe.
                    // Remember that you are responsible for your own generations. This prompt comes with no liability or warranty.
                    "role": "user",
                    "content": "You are a Stable Diffusion prompt stylizer that only responds with image prompts like in the provided examples. Next you will be provided with some example tags and example prompt completions and then asked to complete the user request. Tag placement is essential. Ensure that quality tags are in the front, object/character tags are in the center, and environment/setting tags are at the end. Depending on the context, emphasize important elements, like body parts, hair color, or the style of the image.\n\n--- Tag examples ---\n```\nCharacter/subject tags:\nman, woman, pale green eyes, black short hair, tan skin, Godzilla, robot, warrior\n\nMedium tags:\nsketch, oil painting, illustration, digital art, photo-realistic, realistic, splash art, comic book style, unity, CGI, Octane render, hyper-realistic, photograph\n\nBackground environment tags:\nintricate garden, flowers, roses, trees, leaves, table, chair, teacup, forest, subway\n\nColor tags:\nmonochromatic, warm colors, cool colors, pastel colors\n\nAtmospheric tags:\ncheerful, vibrant, dark, eerie, enchanted, gloomy, clear skies\n\nEmotion tags:\nsad, happy, smiling, gleeful, surprised, stunned\n\nComposition tags:\nside view, looking at viewer, extreme close-up, diagonal shot, dynamic angle\n```\n--- Final output examples ---\n```\nExample 1:\nUser submitted request: A close up of a woman playing the piano at night\nPrompt:  photo-realistic, photograph, a woman with long wavy brown hair, piercing green eyes, playing grand piano, indoors, moonlight, elegant black dress, large window, blueish moonbeam, somber atmosphere, subtle reflection, extreme close-up, side view, gleeful, richly textured wallpaper, vintage candelabrum, glowing candles\n\nExample 2:\nUser submitted request: Medieval knight battling a dragon with a mace and plate armor, cgi style, dramatic, dynamic angle\nPrompt: CGI, Octane 3d render, fierce medieval knight, full plate armor, crested helmet, blood-red plume, clashing swords, spiky mace in hand, dynamic angle, fire-lit battlefield, battling fierce dragon, scales shimmering, sharp teeth, mighty wings, castle ruins in the background, billowing smoke, warm colors, intense emotion, vibrant, looking at viewer, mid-swing\n\nExample 3:\nUser submitted request: A business man in a blue suit, lost in a magical forest\nPrompt:  illustration, detailed, curious and confused man in a blue suit, fairy tale setting, enchanted forest, luminous mushrooms, colorful birds, path winding, sunlight filtering, dappled shadows, pastel colors, magical atmosphere, diagonal shot, looking up in wonder\n```\nComplete this user request\nUser submitted request: " + userInput + "\nPrompt: "
                }
            ],
            temperature: 1,
            max_tokens: 160,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
        });
    } catch (error) {
        console.error(error);
        // Throws another error to be caught when the function is called
        throw new Error(`Error: ${error}`);
    }
    return response.choices[0].message.content;

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

async function lowBalanceMessage() {
    const balance = await getBalance();
    let message = '';
    switch (true) {
        case (balance < 100):
            message = 'Almost out of api credits, please consider sending your server host a few bucks to keep me running <3';
            break;
        case (balance < 200):
            message = 'Consider funding your server host $1 <3';
            break;
        default:
            break;
    }
    return message;
}

async function saveToDiskCheck() {
    const saveImages = config.Advanced.Save_Images;
    if (saveImages == 'true' || saveImages == 'True' || saveImages == 'TRUE') {
        return true;
    } else if (saveImages == 'false' || saveImages == 'False' || saveImages == 'FALSE') {
        return false;
    } else {
        throw new Error("The Save_Images setting in settings.ini is not set to true or false. Please set it to true or false");
    }
}

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
/* End of functions */