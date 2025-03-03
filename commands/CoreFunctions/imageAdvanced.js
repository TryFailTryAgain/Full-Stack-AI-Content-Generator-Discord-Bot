/* 
 * File: imageAdvanced.js
 * Author: TryFailTryAgain
 * Copyright (c) 2024. All rights reserved. For use in Open-Source projects this
 * may be freely copied or excerpted with credit to the author.
 */

/* Getting required modules */
const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, Events } = require('discord.js');
const fs = require('fs');
const { generateImage, generateImageToImage } = require('../../functions/image_functions.js');
const { collectUserInput, collectImageAndPrompt, collectImage } = require('../../functions/helperFunctions.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('image-advanced')
        .setDescription('Generates an image from your prompts using advanced options!'),

    async execute(interaction) {

        let selectedActionType = null;
        let selectedModel = null;

        await interaction.deferReply();

        // Creates action dynamicly based on provided models and settings
        const advSettings = {
            'text2img': process.env.IMAGE_ADV_TEXT2IMG_MODELS,
            'img2img': process.env.IMAGE_ADV_IMG2IMG_MODELS,
            'upscale': process.env.IMAGE_ADV_UPSCALE_MODELS
        };

        // Creates the initial selection menu for action types
        const actionOptions = Object.keys(advSettings).map(type =>
            new StringSelectMenuOptionBuilder()
                .setLabel(type.charAt(0).toUpperCase() + type.slice(1))
                .setDescription(`Generate images using ${type} method`)
                .setValue(type)
        );

        const actionSelectMenu = new StringSelectMenuBuilder()
            .setCustomId('select-action-type')
            .setPlaceholder('Select an action')
            .addOptions(actionOptions);

        const row = new ActionRowBuilder().addComponents(actionSelectMenu);

        await interaction.editReply({
            content: 'Please select an action:',
            components: [row]
        });

        const collector = interaction.channel.createMessageComponentCollector({ time: 180000 });

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) return;

            if (i.customId === 'select-action-type') {
                selectedActionType = i.values[0];
                // Get models for selected action type from environment variables
                const models = advSettings[selectedActionType]
                    .split(',')
                    .map(model => model.trim());
                const uniqueModels = [...new Set(models)];

                const modelOptions = uniqueModels.map(model =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(model.length <= 25 ? model : model.substring(0, 25))
                        .setDescription(`Use ${model.split('/').pop()} model`)
                        .setValue(model)
                );

                const modelSelectMenu = new StringSelectMenuBuilder()
                    .setCustomId('select-model')
                    .setPlaceholder('Select a model')
                    .addOptions(modelOptions);

                const modelRow = new ActionRowBuilder().addComponents(modelSelectMenu);

                await i.update({
                    content: `Action: ${selectedActionType}\nPlease select a model:`,
                    components: [modelRow]
                });
            } else if (i.customId === 'select-model') {
                selectedModel = i.values[0];

                await i.update({
                    content: `Action: ${selectedActionType}\nModel: ${selectedModel}\n`,
                    components: []
                });

                await handleActionType(interaction, selectedActionType, selectedModel);
                collector.stop();
            }
        });

        /* Functions to handle different action types */
        async function handleActionType(interaction, actionType, model) {
            try {
                if (actionType.toLowerCase() === 'text2img') {
                    const prompt = await collectUserInput(interaction, 'Please enter your prompt for image generation:');
                    const images = await generateImage({
                        userInput: prompt,
                        negativePrompt: '',
                        imageModel: model,
                        dimensions: 'square',
                        numberOfImages: 1,
                        cfg: null,
                        steps: null,
                        seed: null,
                        userID: interaction.user.id
                    });
                    await sendImages(interaction, images);

                } else if (actionType.toLowerCase() === 'img2img') {
                    const { imageURL, prompt } = await collectImageAndPrompt(interaction, 'Please send the base image and enter your prompt below it in one single message:');
                    const images = await generateImageToImage({
                        image: imageURL,
                        userInput: prompt,
                        negativePrompt: '',
                        Image2Image_Model: model,
                        strength: 0.6,
                        seed: null,
                        userID: interaction.user.id
                    });
                    await sendImages(interaction, images);

                } else if (actionType.toLowerCase() === 'upscale') {
                    const imageURL = await collectImage(interaction, 'Please upload the image you wish to upscale:');
                    const images = await upscaleImage({
                        image: imageURL,
                        upscaleModel: model,
                        userID: interaction.user.id
                    });
                    await sendImages(interaction, images);

                } else {
                    await interaction.followUp({ content: 'Unsupported action type.', ephemeral: true });
                }
            } catch (error) {
                console.error('Error handling action type:', error);
                if (error.code === 20009) {
                    await interaction.followUp({ content: 'Your image contains explicit content that can not be displayed in this SFW channel. Try another channel or a DM', ephemeral: true });
                } else {
                    await interaction.followUp({ content: 'An unexpected error occurred. Please try again and report any bugs to help improve me!', ephemeral: true });
                }
            }
        }
    }
    /* End of the command functional execution */
};
