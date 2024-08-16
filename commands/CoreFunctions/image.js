// File: image.js
// Author: TryFailTryAgain
// Copyright (c) 2024. All rights reserved. For use in Open-Source projects this
// may be freely copied or excerpted with credit to the author.
// See the LICENSE file for additional details

const { SlashCommandBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

////* Getting required local files *////
const imageFunctions = require('../../functions/image_functions.js');
// Import the helper functions
const helperFunctions = require('../../functions/helperFunctions.js');
// Add all the helper functions to the global scope
for (let key in helperFunctions) {
    global[key] = helperFunctions[key];
}
// Add all the image functions to the global scope
for (let key in imageFunctions) {
    global[key] = imageFunctions[key];
}

// Get the settings from the settings.ini file
const config = getIniFileContent('./settings.ini');

module.exports = {
    cooldown: 1,
    data: new SlashCommandBuilder()
        .setName('image')
        .setDescription('Generates an image from your prompt!')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('The prompt/idea for the image')
                .setMaxLength(500)
                .setRequired(true)
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
        ),

    async execute(interaction, client) {
        await interaction.deferReply();

        let originalUserInput = interaction.options.getString('prompt');
        let dimensions = interaction.options.getString('dimensions') || 'square';
        let imageModel = config.Image_command_settings.Image_Model;
        let seed = await genSeed();

        // Filter the user input for profanity or other banned words if the setting is enabled
        // The filter is HIGHLY recommended to keep enabled and to add to it with additional words in
        // the node_modules/bad-words/lib/lang.json file
        let userInput = await filterCheckThenFilterString(originalUserInput);

        let imageBuffer = null;
        try {
            imageBuffer = await generateImage({
                userInput: userInput,
                imageModel: imageModel,
                dimensions: dimensions,
                seed: seed,
                userID: interaction.user.id,
                numberOfImages: 1
            })
        } catch (error) {
            console.error(error);
            deleteAndFollowUpEphemeral(interaction, "An error occurred while generating the image. Please try again");
            return;
        }

        let attachments = [];
        for (let i = 0; i < imageBuffer.length; i++) {
            attachments.push(new AttachmentBuilder(imageBuffer[i]));
        }

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('regenerate')
                .setLabel('Regenerate')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔄'),
            new ButtonBuilder()
                .setCustomId('magic')
                .setLabel('Magic')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✨'),
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
        );
        // A second action row is needed as each has a 5 button limit
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('advanced')
                .setLabel('Advanced Options')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('⚙️')
        );

        const reply = await interaction.editReply({
            content: 'Consider funding your bot host to cover API fees❤️',
            files: attachments,
            components: [row1, row2],
        });

        const collectorFilter = i => (i.customId === 'regenerate' || i.customId === '25similarity' || i.customId === '50similarity' || i.customId === 'upscale' || i.customId === 'advanced' || i.customId === 'magic') && i.user.id === interaction.user.id;
        const collector = reply.createMessageComponentCollector({ filter: collectorFilter, time: 870_000 });

        async function handleButtonInteraction(i, action) {
            // Disable all buttons while processing
            row1.components.forEach(component => component.setDisabled(true));
            row2.components.forEach(component => component.setDisabled(true));
            await i.update({ components: [row1, row2] });

            try {
                await action();
            } catch (error) {
                console.error(error);
                followUpEphemeral(interaction, "An error occurred. Please try again");
                return;
            }

            // Limit the number of attachments to 9 as it keeps them in a grid.
            // Discord also has a limit of max 10 attachments per message
            if (attachments.length > 9) {
                attachments = attachments.slice(0, 9);
            }
            // Enable the buttons again
            row1.components.forEach(component => component.setDisabled(false));
            row2.components.forEach(component => component.setDisabled(false));
            await i.editReply({
                content: '⬅️New Images first \n➡️Original Images last \n',
                files: attachments,
                components: [row1, row2],
            });
        }

        collector.on('collect', async i => {
            switch (i.customId) {
                case 'regenerate':
                    await handleButtonInteraction(i, async () => {
                        seed = await genSeed();
                        imageBuffer = await generateImage({
                            userInput: userInput,
                            imageModel: imageModel,
                            seed: seed,
                            userID: interaction.user.id,
                            numberOfImages: 1,
                            dimensions: dimensions
                        });
                        attachments.unshift(new AttachmentBuilder(imageBuffer[0]));
                    });
                    break;

                case '25similarity':
                    await handleButtonInteraction(i, async () => {
                        imageBuffer = await generateImageToImage({
                            image: imageBuffer[0],
                            userInput: userInput,
                            negativePrompt: "",
                            Image2Image_Model: config.Image_command_settings.Image2Image_Model,
                            strength: 0.75,
                            seed: seed,
                            userID: interaction.user.id
                        });
                        attachments.unshift(new AttachmentBuilder(imageBuffer[0]));
                    });
                    break;

                case '50similarity':
                    await handleButtonInteraction(i, async () => {
                        imageBuffer = await generateImageToImage({
                            image: imageBuffer[0],
                            userInput: userInput,
                            negativePrompt: "",
                            Image2Image_Model: config.Image_command_settings.Image2Image_Model,
                            strength: 0.5,
                            seed: seed,
                            userID: interaction.user.id
                        });
                        attachments.unshift(new AttachmentBuilder(imageBuffer[0]));
                    });
                    break;

                case 'upscale':
                    await handleButtonInteraction(i, async () => {
                        console.log("Upscale button pressed");
                        const upscaleModel = config.Image_command_settings.Upscale_Model;
                        const upscaledImageBuffer = await upscaleImage(imageBuffer[0], upscaleModel);
                        attachments.unshift(new AttachmentBuilder(upscaledImageBuffer));
                    });
                    break;

                case 'magic':
                    await handleButtonInteraction(i, async () => {
                        const optimizedPrompt = await promptOptimizer(userInput, interaction.user.id);
                        imageBuffer = await generateImage({
                            userInput: optimizedPrompt,
                            imageModel: imageModel,
                            seed: seed,
                            userID: interaction.user.id,
                            numberOfImages: 1,
                            dimensions: dimensions
                        });
                        attachments.unshift(new AttachmentBuilder(imageBuffer[0]));
                    });
                    break;

                case 'advanced':
                    row.components.forEach(component => component.setDisabled(false));
                    await i.editReply({
                        content: 'Consider funding your bot host to cover API fees and keep new features coming❤️',
                        files: attachments,
                        components: [row],
                    });
                    followUpEphemeral(interaction, "Currently in development! Will be functional soon!");
                    break;

                default:
                    console.error(`Unknown customId: ${i.customId}`);
                    break;
            }
        });

        collector.on('end', async () => {
            // Disable all buttons after the collector ends
            row1.components.forEach(component => component.setDisabled(true));
            row2.components.forEach(component => component.setDisabled(true));
            try {
                await interaction.editReply({ components: [row1, row2] });
            } catch (error) {
                console.error(error);
                followUpEphemeral(interaction, "An error occurred while disabling the buttons. Please try again or contact the bot host if this persists");
            }
        });
    }
};
