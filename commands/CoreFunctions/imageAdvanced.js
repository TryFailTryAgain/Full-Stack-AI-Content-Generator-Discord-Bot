/* 
 * File: imageAdvanced.js
 * Author: TryFailTryAgain
 * Copyright (c) 2024. All rights reserved. For use in Open-Source projects this
 * may be freely copied or excerpted with credit to the author.
 */

/* Getting required modules */
const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, Events } = require('discord.js');
const helperFunctions = require('../../functions/helperFunctions.js');
const fs = require('fs');
const ini = require('ini');
const { config } = require('../../functions/config.js');
const { generateImage, generateImageToImage } = require('../../functions/image_functions.js');
const { collectUserInput, collectImageAndPrompt, collectImage } = require('../../functions/helperFunctions.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('image-advanced')
        .setDescription('Generates an image from your prompts using advanced options!'),

    /* Start of the command functional execution */
    async execute(interaction) {

        // Declare variables to hold selected values
        let selectedProvider = null;
        let selectedActionType = null;
        let selectedModel = null;

        // Respond to the command to prevent Discord timeout
        await interaction.deferReply();

        // Fetch available providers from settings.ini
        const providers = config.Image_Advanced_command_settings.Providers.split(',').map(provider => provider.trim());
        let options = {};

        providers.forEach(provider => {
            options[provider] = {};
            const providerKey = provider.trim();

            // Filter keys that start with the provider's name
            const actionKeys = Object.keys(config.Image_Advanced_command_settings).filter(key =>
                key.startsWith(`${providerKey}_`)
            );

            actionKeys.forEach(key => {
                const actionType = key.replace(`${providerKey}_`, '').trim(); // e.g., 'text2img', 'img2img'
                const models = config.Image_Advanced_command_settings[key]
                    .split(',')
                    .map(model => model.trim());

                // Remove duplicate models
                const uniqueModels = [...new Set(models)];

                options[provider][actionType] = uniqueModels;
            });
        });

        // Create the initial selection menu for model providers
        const providerOptions = providers.map(provider => ({
            label: provider.length <= 25 ? provider : provider.substring(0, 25),
            value: provider
        }));

        const providerSelectMenu = new StringSelectMenuBuilder()
            .setCustomId('select-provider')
            .setPlaceholder('Select a model provider')
            .addOptions(providerOptions);

        const row = new ActionRowBuilder().addComponents(providerSelectMenu);

        // Send the initial selection menu to the user
        await interaction.editReply({
            content: 'Please select a model provider:',
            components: [row]
        });

        // Set up the interaction handlers
        const collector = interaction.channel.createMessageComponentCollector({ time: 180000 });

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) return;

            if (i.customId === 'select-provider') {
                selectedProvider = i.values[0];

                // Fetch available actions for the selected provider
                const actionOptions = Object.keys(options[selectedProvider] || {}).map(type => ({
                    label: `${type}`.substring(0, 25),
                    value: type
                }));

                const actionSelectMenu = new StringSelectMenuBuilder()
                    .setCustomId('select-action-type')
                    .setPlaceholder('Select an action')
                    .addOptions(actionOptions);

                const actionRow = new ActionRowBuilder().addComponents(actionSelectMenu);

                await i.update({
                    content: `You selected: ${selectedProvider}\nPlease select the action you wish to perform:`,
                    components: [actionRow]
                });
            } else if (i.customId === 'select-action-type') {
                selectedActionType = i.values[0];

                // Fetch available models for the selected action type and provider
                const availableModels = options[selectedProvider][selectedActionType];
                const modelOptions = (availableModels || []).map(model => ({
                    label: model.substring(0, 25),
                    value: model
                }));

                const modelSelectMenu = new StringSelectMenuBuilder()
                    .setCustomId('select-model')
                    .setPlaceholder('Select a model')
                    .addOptions(modelOptions);

                const modelRow = new ActionRowBuilder().addComponents(modelSelectMenu);

                await i.update({
                    content: `Provider: ${selectedProvider}\nAction: ${selectedActionType}\nPlease select a model:`,
                    components: [modelRow]
                });
            } else if (i.customId === 'select-model') {
                selectedModel = i.values[0];

                // Proceed to collect additional inputs based on action type
                await i.update({
                    content: `Provider: ${selectedProvider}\nAction: ${selectedActionType}\nModel: ${selectedModel}\n`,
                    components: []
                });

                await handleActionType(interaction, selectedActionType, selectedModel);
                collector.stop();
            }
        });

        /* Function to handle different action types */
        async function handleActionType(interaction, actionType, model) {
            try {
                if (actionType.toLowerCase() === 'text2img') {
                    // Handle text-to-image generation
                    const prompt = await collectUserInput(interaction, 'Please enter your prompt for image generation:');
                    // Optional: Collect additional parameters like dimensions, number of images, etc.

                    // Call generateImage from image_functions.js
                    const images = await generateImage({
                        userInput: prompt,
                        negativePrompt: '', // Optionally collect negative prompt
                        imageModel: model,
                        dimensions: 'square', // Default or collect from user
                        numberOfImages: 1, // Default or collect from user
                        cfg: null, // Optional parameters
                        steps: null,
                        seed: null,
                        userID: interaction.user.id
                    });

                    // Send the generated images to the user
                    await sendImages(interaction, images);

                } else if (actionType.toLowerCase() === 'img2img') {
                    // Handle image-to-image generation
                    const { imageURL, prompt } = await collectImageAndPrompt(interaction, 'Please send the base image and enter your prompt below it in one single message:');

                    // Call generateImageToImage from image_functions.js
                    const images = await generateImageToImage({
                        image: imageURL,
                        userInput: prompt,
                        negativePrompt: '', // Optionally collect negative prompt
                        Image2Image_Model: model,
                        strength: 0.6, // Default or collect from user
                        seed: null,
                        userID: interaction.user.id
                    });

                    // Send the generated images to the user
                    await sendImages(interaction, images);

                } else if (actionType.toLowerCase() === 'upscale') {
                    // Handle image upscaling
                    const imageURL = await collectImage(interaction, 'Please upload the image you wish to upscale:');

                    // Call upscaleImage from image_functions.js
                    const images = await upscaleImage({
                        image: imageURL,
                        upscaleModel: model,
                        userID: interaction.user.id
                    });

                    // Send the upscaled image to the user
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
