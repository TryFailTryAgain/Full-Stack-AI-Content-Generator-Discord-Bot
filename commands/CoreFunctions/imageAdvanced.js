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

/* Getting required local files */
const SETTINGS_FILE_PATH = './settings.ini';
const config = ini.parse(fs.readFileSync(SETTINGS_FILE_PATH, 'utf-8'));


module.exports = {
    data: new SlashCommandBuilder()
        .setName('image-advanced')
        .setDescription('Generates an image from your prompts using advanced options!'),
 
    /* Start of the command functional execution */
    async execute(interaction) {
    
        /* TODO: Implement the advanced image generation command */
        // UNTIL finished sends a message to the user that the command is not yet implemented
        await interaction.reply({
            content: 'Thank you for trying out this command, it soon will be a fantastic tool, but at the current time it\'s still under construction. \nPlease try again later and keep an eye out for bot updates!',
            ephemeral: true
        });
        return;
        /* End of temporary TODO block*/


        // Declare variables to hold selected values
        let selectedProvider = null;
        let selectedActionType = null;
        let selectedModel = null;

        // Responds to the command to prevent discord timeout and this will display that the bot is thinking
        await interaction.deferReply();

        // Fetch available providers from settings.ini
        const providers = config.Image_Advanced_command_settings.Providers.split(',').map(provider => provider.trim());
        let options = {};

        providers.forEach(provider => {
            options[provider] = {};
            const providerKey = provider.toLowerCase();
            // Filter keys in the config to find model types for the current provider
            const actions = Object.keys(config.Image_Advanced_command_settings).filter(key => {
                console.log(`Processing key: ${key}`);

                // Convert the key to lowercase and check if it starts with the provider key
                const isProviderAction = key.toLowerCase().startsWith(providerKey) && key.toLowerCase();
                // Return true if the key is a model type, otherwise false
                return isProviderAction;
            });

            console.log(`Provider: ${provider}, Actions: ${actions}`);

            actions.forEach(type => {
                const typeKey = type.replace(providerKey)
                options[provider][typeKey] = config.Image_Advanced_command_settings[type].split(',').map(model => model.trim());
                console.log(`Type: ${type}, Type Key: ${typeKey}, Models: ${options[provider][typeKey]}`);
            });
        });
        console.log("models: ", options);

        // Create the initial selection menu for model providers
        const providerOptions = providers.map(provider => ({
            label: provider < 25 ? provider : provider.substring(0, 25),
            value: provider
        }));
        console.log("providerOptions: ", providerOptions);

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

        // Set up the interaction handler for the selection menu
        const providerFilter = i => i.customId === 'select-provider' && i.user.id === interaction.user.id;
        const providerCollector = interaction.channel.createMessageComponentCollector({ filter: providerFilter, time: 60000 });

        providerCollector.on('collect', async i => {
            selectedProvider = i.values[0];
            //await i.update({ content: `You selected: ${selectedProvider}`, components: [] });

            // Fetch available options for the selected provider and present the next selection menu
            const actionOptions = Object.keys(options[selectedProvider] || {}).map(type => {
                const label = `${type} models`.length > 25 ? `${type} models`.substring(0, 25) : `${type} models`;
                const value = type;
                console.log(`Model Option - Label: ${label}, Value: ${value}`);
                return { label, value };
            });
            console.log("actionOptions: ", actionOptions);

            const actionSelectMenu = new StringSelectMenuBuilder()
                .setCustomId('select-action-type')
                .setPlaceholder('Select an action')
                .addOptions(actionOptions);

            const actionRow = new ActionRowBuilder().addComponents(actionSelectMenu);

            await i.update({
                content: `You selected: ${selectedProvider}\nPlease select the action you wish to perform:`,
                components: [actionRow]
            });
        });

        // Set up the interaction handler for the model selection menu
        const actionFilter = i => i.customId === 'select-action-type' && i.user.id === interaction.user.id;
        const actionCollector = interaction.channel.createMessageComponentCollector({ filter: actionFilter, time: 60000 });

        actionCollector.on('collect', async i => {
            selectedActionType = i.values[0];
            //await i.update({ content: `You selected: ${selectedActionType} action`, components: [] });

            // Fetch available models for the selected action type and provider
            const availableModels = options[selectedProvider][selectedActionType];
            const ModelOptions = (availableModels || []).map(model => ({
                label: model.length > 25 ? model.substring(0, 25) : model,
                value: model
            }));

            const modelSelectionMenu = new StringSelectMenuBuilder()
                .setCustomId('select-model')
                .setPlaceholder('Select a model')
                .addOptions(ModelOptions);

            const modelRow = new ActionRowBuilder().addComponents(modelSelectionMenu);

            await i.update({
                content: `Provider: ${selectedProvider}\nAction: ${selectedActionType}\nPlease select a model:`,
                components: [modelRow]
            });
        });
        // Set up the interaction handler for the final model selection menu
        const modelFilter = i => i.customId === 'select-model' && i.user.id === interaction.user.id;
        const modelCollector = interaction.channel.createMessageComponentCollector({ filter: modelFilter, time: 60000 });

        modelCollector.on('collect', async i => {
            selectedModel = i.values[0];
            await i.update({
                content: `Provider: ${selectedProvider}\nAction: ${selectedActionType}\nModel: ${selectedModel}`,
                components: []
            });
            const image = await generateImage({
                userInput: userInput,
                negativePrompt: negativePrompt,
                imageModel: selectedModel,
                dimensions: dimensions,
                numberOfImages: numberOfImages,
                cfg: cfg,
                steps: steps,
                seed: seed,
                userID: userID
            });
            // await interaction.followUp({ files: [image] });
        });

    }
    /* End of the command functional execution */
};
