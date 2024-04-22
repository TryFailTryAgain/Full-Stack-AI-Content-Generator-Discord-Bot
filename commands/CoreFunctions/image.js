// File: image.js
// Author: TryFailTryAgain
// Copyright (c) 2023. All rights reserved. For use in Open-Source projects this
// may be freely copied or excerpted with credit to the author.

/* Getting required modules */
const { SlashCommandBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

/* Getting required local files */
const imageFunctions = require('../../functions/image_functions.js');
const ImageChatModal = require('../../components/imageChatModal.js');
// Add all the image functions to the global scope
for (let key in imageFunctions) {
    global[key] = imageFunctions[key];
}
/* End getting required modules */

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
        .addStringOption(option =>
            option.setName('negative-prompt')
                .setDescription('What you dont want in the image')
                .setMaxLength(500)
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('disable-optimization')
                .setDescription('Disables the AI Optimization of the input prompt.')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('dimensions')
                .setDescription('The dimensions of the image')
                .addChoices(
                    { name: 'Square', value: 'square' },
                    { name: 'Wide', value: 'wide' },
                    { name: 'Tall', value: 'tall' },
                )
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('number-of-images')
                .setDescription('Number of images to generate')
                .setMinValue(1)
                .setMaxValue(9)
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('image-model')
                .setDescription('The engine to use for generating the image')
                .addChoices(
                    { name: 'SD 3.0', value: 'sd3' },
                    { name: 'SD 3.0 Turbo', value: 'sd3-turbo' },
                    { name: 'Dall-E 3', value: 'dall-e-3' },
                    { name: 'SDXL 1.0', value: 'stable-diffusion-xl-1024-v1-0' },
                    { name: 'SD 1.6', value: 'stable-diffusion-v1-6' },
                )
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('cfg-scale')
                .setDescription('ONLY available with image model SDXL and SD1.6 - How closely to follow the prompt')
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('steps')
                .setDescription('ONLY available with image model SDXL and SD1.6 - How many steps to refine the image')
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
                .setDescription('ONLY available with image model SD3/turbo, SDXL and SD1.6 - The seed number to use for the image')
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
        let originalUserInput = interaction.options.getString('prompt');
        let negativePrompt = interaction.options.getString('negative-prompt') || "low resolution, bad quality, warped image, jpeg artifacts, worst quality, lowres, blurry";
        let disableOptimizePrompt = interaction.options.getBoolean('disable-optimization') || false;
        let dimensions = interaction.options.getString('dimensions') || 'square';
        let numberOfImages = interaction.options.getInteger('number-of-images') || 1;
        let imageModel = interaction.options.getString('image-model') || 'sd3';
        let cfgScale = interaction.options.getInteger('cfg-scale') || 6;
        let steps = interaction.options.getInteger('steps') || 40;
        let seed = interaction.options.getInteger('seed') || await genSeed();

        // Split out the width to check if it is over X during upscaling
        let width = parseInt(dimensions.split('x')[0]);

        // Prompt filtering
        try {
            if (await filterCheck()) {
                originalUserInput = await filterString(originalUserInput);
            }
        } catch (error) {
            console.error(error);
            deleteAndFollowUpEphemeral(interaction, "An error occurred while filtering the prompt. Please try again");
            return;
        }

        // Create a dynamic variable for the user input so it can be optimized or changed later but we retain the original.
        let userInput = originalUserInput;

        /* Image generation */

        // If not using OpenAI, check Stability if out of API credits
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
                        pricePerImage = 0.2;
                        break;
                    case 'sd-1.6':
                        pricePerImage = 0.2;
                        break;
                    default:
                        pricePerImage = 0;
                        break;
                }
                if (await getBalance() < pricePerImage * numberOfImages) {
                    deleteAndFollowUpEphemeral(interaction, 'Out of API credits! Please consider donating to your server to keep this bot running!');
                    return;
                }
            } catch (error) {
                console.error(error);
                deleteAndFollowUpEphemeral(interaction, "An error occurred while fetching the API balance. Please try again");
                return;
            }
        }
        // Optimize the prompt unless the user has specifically asked not to
        let optimized_Prompt = null;
        if (!disableOptimizePrompt) {
            try {
                optimized_Prompt = await promptOptimizer(originalUserInput, interaction.user.id);
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
            imageBuffer = await generateImage(userInput, negativePrompt, imageModel, dimensions, numberOfImages, cfgScale, steps, seed, interaction.user.id);
        } catch (error) {
            console.error(error);
            // check for returned error for Stability and OpenAI, respectively
            if (error.message.includes("Invalid prompts detected") || error.message.includes("Your request was rejected")) {
                deleteAndFollowUpEphemeral(interaction, "Invalid/Banned prompt detected. Please try again with a different prompt");
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
                .setCustomId('25similarity')
                .setLabel('25% Similarity')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🧬'),
            new ButtonBuilder()
                .setCustomId('50similarity')
                .setLabel('50% Similarity')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🧬'),
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

        // Edit the reply to show the generated image and the buttons
        let apiCreditReply = 'Image Generated! Consider funding me to cover API fees❤️';
        if (imageModel != 'dall-e-3') {
            apiCreditReply = await lowBalanceMessage();
        }
        const reply = await interaction.editReply({
            content: apiCreditReply,
            files: attachments,
            components: [row],
        });


        /* Regenerate button handling */
        // Create an interaction collector to listen for button interactions
        // The maximum amount of time that a message is modifiable is 15 minutes.
        //      This is a limitation of discord as their webhooks will only stay valid for 15 minutes.
        //      We will set the collector to 14.5 minutes to give us a little bit of time to finish any requests and update the reply
        const collectorFilter = i => i.customId === 'regenerate' && i.user.id === interaction.user.id;
        const collector = reply.createMessageComponentCollector({ filter: collectorFilter, time: 870_000 }); // 14.5 minutes, see first collector comment

        // When the button is clicked, regenerate the image and update the reply
        collector.on('collect', async i => {
            // Disable the buttons to prevent double actions
            row.components.forEach(component => component.setDisabled(true));
            // Update to show the disabled button but keep everything else as is
            // This may be a silly implementation but it works and the other methods I tried... work less
            await i.update({
                components: [row],
            });
            // Check if out of Stability AI API credits
            try {
                if (imageModel != 'dall-e-3') {
                    if (await getBalance() < 0.23 * numberOfImages) { //current SDXL price is 0.23-0.5 credits per image at 40 steps
                        followUpEphemeral(interaction, "Out of API credits! Please consider donating to your server to keep this bot running!");
                    }
                }
            } catch (error) {
                console.error(error);
                followUpEphemeral(interaction, "An error occurred while fetching the API balance. Please try again");
                return;
            }
            // Generate a new seed for new images
            seed = await genSeed();

            // TODO regenerate the user prompt if the user has not disabled the optimization
            if (!disableOptimizePrompt) {
                try {
                    optimized_Prompt = await promptOptimizer(originalUserInput, interaction.user.id);
                } catch (error) {
                    console.error(error);
                    deleteAndFollowUpEphemeral(interaction, "An error occurred while optimizing the prompt. Please try again");
                    return;
                }
                // Sets the user input to the new optimized prompt
                userInput = optimized_Prompt;
            }

            // Regenerate the image and update the reply
            try {
                imageBuffer = await generateImage(userInput, negativePrompt, imageModel, dimensions, numberOfImages, cfgScale, steps, seed, interaction.user.id);
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
            // Re enable the buttons now that we have the new image to update with
            row.components.forEach(component => component.setDisabled(false));

            await i.editReply({
                content: await lowBalanceMessage(),
                files: attachments,
                components: [row],
            });
        });
        /* End of regenerate button handling */

        /* 25% Similarity button handling */
        // Builds the collector for the 25% similarity button
        const similarity25CollectorFilter = i => i.customId === '25similarity' && i.user.id === interaction.user.id;
        const similarity25Collector = reply.createMessageComponentCollector({ filter: similarity25CollectorFilter, time: 870_000 }); // 14.5 minutes, see first collector comment

        // When the 25% similarity button is clicked, regenerate the image with 25% similarity and update the reply
        similarity25Collector.on('collect', async i => {
            // Disables the buttons to prevent more clicks
            row.components.forEach(component => component.setDisabled(true));
            // Update to show the disabled button but keep everything else as is
            await i.update({
                components: [row],
            });

            // Check if out of API credits
            try {
                if (await getBalance() < 0.2) { //current price is a flat 0.2 credits per image
                    followUpEphemeral(interaction, "Out of API credits! Please consider donating to your server to keep this bot running!");
                }
            } catch (error) {
                console.error(error);
                followUpEphemeral(interaction, "An error occurred while fetching the API balance. Please try again");
                return;
            }
            // Regenerate the image with 25% similarity and update the reply
            try {
                imageBuffer = await generateImageToImage(imageBuffer[0], userInput, negativePrompt, 0.75, seed, interaction.user.id);
            }
            catch (error) {
                console.error(error);
                followUpEphemeral(interaction, "An error occurred while generating the 25% similarity image. Please try again");
                return;
            }

            // Slot the new images into the attachments array at the beginning so they are displayed first
            for (let i = 0; i < imageBuffer.length; i++) {
                attachments.unshift(new AttachmentBuilder(imageBuffer[i]));
            }

            // Limit the number of attachments to 9 as it keeps them in a grid.
            // Discord also has a limit of max 10 attachments per message
            let informIfTruncated = '';
            if (attachments.length > 9) {
                attachments = attachments.slice(0, 9); // End marker is excluded with .slice() so this returns the first 9 images 0 - 8
                informIfTruncated = 'Oldest images have been truncated. Only the newest 9 images are shown due to a discord limitation\n';
            }

            // Re enable the buttons now that we have the new image to update with
            row.components.forEach(component => component.setDisabled(false));
            // Sends the new image to discord
            await i.editReply({
                content: '⬅️New Images first \n➡️Original Images last \n' + informIfTruncated + await lowBalanceMessage(),
                files: attachments,
                components: [row],
            });
        });
        /* End of 25% similarity button handling */

        /* 50% Similarity button handling */
        // Builds the collector for the 50% similarity button
        const similarity50CollectorFilter = i => i.customId === '50similarity' && i.user.id === interaction.user.id;
        const similarity50Collector = reply.createMessageComponentCollector({ filter: similarity50CollectorFilter, time: 870_000 }); // 14.5 minutes, see first collector comment

        // When the 50% similarity button is clicked, regenerate the image with 50% similarity and update the reply
        similarity50Collector.on('collect', async i => {
            // Disables the buttons to prevent more clicks
            row.components.forEach(component => component.setDisabled(true));
            // Update to show the disabled button but keep everything else as is
            await i.update({
                components: [row],
            });

            // Check if out of API credits
            try {
                if (await getBalance() < 0.2) { //current price is a flat 0.2 credits per image
                    followUpEphemeral(interaction, "Out of API credits! Please consider donating to your server to keep this bot running!");
                }
            } catch (error) {
                console.error(error);
                followUpEphemeral(interaction, "An error occurred while fetching the API balance. Please try again");
                return;
            }
            // Regenerate the image with 50% similarity and update the reply
            try {
                imageBuffer = await generateImageToImage(imageBuffer[0], userInput, negativePrompt, 0.50, seed, interaction.user.id);
            }
            catch (error) {
                console.error(error);
                followUpEphemeral(interaction, "An error occurred while generating the 50% similarity image. Please try again");
                return;
            }

            // Slot the new images into the attachments array at the beginning so they are displayed first
            for (let i = 0; i < imageBuffer.length; i++) {
                attachments.unshift(new AttachmentBuilder(imageBuffer[i]));
            }

            // Limit the number of attachments to 9 as it keeps them in a grid.
            // Discord also has a limit of max 10 attachments per message
            let informIfTruncated = '';
            if (attachments.length > 9) {
                attachments = attachments.slice(0, 9); // End marker is excluded with .slice() so this returns the first 9 images 0 - 8
                informIfTruncated = 'Oldest images have been truncated. Only the newest 9 images are shown due to a discord limitation\n';
            }

            // Re enable the buttons now that we have the new image to update with
            row.components.forEach(component => component.setDisabled(false));
            // Sends the new image to discord
            await i.editReply({
                content: '⬅️New Images first \n➡️Original Images last \n' + informIfTruncated + await lowBalanceMessage(),
                files: attachments,
                components: [row],
            });
        }
        );
        /* End of 50% similarity button handling */


        /* Upscale button handling */
        // Builds the collector for the upscale button
        const upscaleCollectorFilter = i => i.customId === 'upscale' && i.user.id === interaction.user.id;
        const upscaleCollector = reply.createMessageComponentCollector({ filter: upscaleCollectorFilter, time: 870_000 }); // 14.5 minutes, see first collector comment

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
                imageBuffer = await upscaleImage(imageBuffer[0], width);
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
        const chatRefinementCollector = reply.createMessageComponentCollector({ filter: chatRefinementCollectorFilter, time: 870_000 }); // 14.5 minutes, see first collector comment

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

                // Adapt the image differently depending on the image model as Dall-e 3 does not have a seed method.
                //    TODO: This could potentially be the best solution for Stability ai too but I have not tested it yet
                if (imageModel == 'dall-e-3') {
                    try {
                        // TODO: ad the ability to change the modification strength via the modal. Currently defaults to: 0.5
                        // Generate a similar image using img2img from Stability.ai
                        imageBuffer = await generateImageToImage(imageBuffer[0], userInput, negativePrompt, 0.50, seed, interaction.user.id);
                    } catch (error) {
                        console.error(error);
                        followUpEphemeral(interaction, "An error occurred while generating the refined image. Please try again");
                        return;
                    }
                } else {
                    // Pass all the parameters to the image generation function with identical seed so images are closer to the original
                    try {
                        imageBuffer = await generateImage(userInput, negativePrompt, imageModel, dimensions, numberOfImages, cfgScale, steps, seed, interaction.user.id);
                    } catch (error) {
                        console.error(error);
                        followUpEphemeral(interaction, "An error occurred while generating the refined image. Please try again");
                        return;
                    }
                }

                // Slot the new images into the attachments array at the beginning so they are displayed first
                for (let i = 0; i < imageBuffer.length; i++) {
                    attachments.unshift(new AttachmentBuilder(imageBuffer[i]));
                }

                // Limit the number of attachments to 9 as it keeps them in a grid.
                // Discord also has a limit of max 10 attachments per message
                let informIfTruncated = '';
                if (attachments.length > 9) {
                    attachments = attachments.slice(0, 9); // End marker is excluded with .slice() so this returns the first 9 images 0 - 8
                    informIfTruncated = 'Oldest images have been truncated. Only the newest 9 images are shown due to a discord limitation\n';
                }

                // Re enable the buttons now that we have the new image to update with
                row.components.forEach(component => component.setDisabled(false));
                // Sends the new image to discord
                await i.editReply({
                    content: '⬅️New Images first \n➡️Original Images last \n' + informIfTruncated + await lowBalanceMessage(),
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