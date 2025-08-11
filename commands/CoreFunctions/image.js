// File: image.js
// Author: TryFailTryAgain
// Copyright (c) 2024. All rights reserved.
// See the LICENSE file for additional details

const { SlashCommandBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

//* Getting required local files *//
const imageFunctions = require('../../functions/image_functions.js');
const helperFunctions = require('../../functions/helperFunctions.js');

// Add all the helper functions to the global scope
for (let key in helperFunctions) {
    global[key] = helperFunctions[key];
}

// Add all the image functions to the global scope
for (let key in imageFunctions) {
    global[key] = imageFunctions[key];
}

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

        // Get user input and settings
        let originalUserInput = interaction.options.getString('prompt');
        let dimensions = interaction.options.getString('dimensions') || 'square';
        let imageModel = process.env.IMAGE_MODEL;

        // Filter the user input for profanity or banned words
        let userInput = await filterCheckThenFilterString(originalUserInput);

        let imageBuffer = null;
        try {
            // Generate the image based on user input
            imageBuffer = await generateImage({
                userInput: userInput,
                imageModel: imageModel,
                dimensions: dimensions,
                userID: interaction.user.id,
                numberOfImages: 1
            });
        } catch (error) {
            console.error(error);
            if (error.message.includes('flagged')) {
                await deleteAndFollowUpEphemeral(interaction, "Your prompt was flagged by the moderation system. This may be logged for review.");
                return;
            }
            await deleteAndFollowUpEphemeral(interaction, "An error occurred while generating the image. Please try again");
            return;
        }

        // Prepare image attachments for the reply
        let attachments = [];
        for (let i = 0; i < imageBuffer.length; i++) {
            attachments.push(new AttachmentBuilder(imageBuffer[i]));
        }

        // Create action buttons for user interaction. Max 5 per row
        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('regenerate')
                .setLabel('Next Image')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('➕'),
            new ButtonBuilder()
                .setCustomId('magic')
                .setLabel('Creative Re-Imagine')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✨'),
            new ButtonBuilder()
                .setCustomId('refine')
                .setLabel('Refine Image')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔧'),
            /* Disabled as the 'refine' button serves as a far superior option
                new ButtonBuilder()
                .setCustomId('25similarity')
                .setLabel('New 25% Similar')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🧬'),
            new ButtonBuilder()
                .setCustomId('50similarity')
                .setLabel('New 50% Similar')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🧬'),
            */
        );
        // Second action row for additional options. Max 5 per row
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('upscale')
                .setLabel('Upscale')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔍'),
            new ButtonBuilder()
                .setCustomId('advanced')
                .setLabel('Advanced Options')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('⚙️'),

        );

        // Send initial reply with the generated image and action buttons
        const reply = await interaction.editReply({
            content: 'Consider funding your bot host to cover API fees❤️',
            files: attachments,
            components: [row1, row2],
        });

        // Set up interaction collector for button clicks
        const collectorFilter = i => ['regenerate', '25similarity', '50similarity', 'upscale', 'advanced', 'magic', 'refine'].includes(i.customId) && i.user.id === interaction.user.id;
        const collector = reply.createMessageComponentCollector({ filter: collectorFilter, time: 870_000 });

        // Function to handle button interactions
        async function handleButtonInteraction(i, action, skipUpdate = false) {
            if (!skipUpdate) {
                // Disable all buttons while processing
                row1.components.forEach(component => component.setDisabled(true));
                row2.components.forEach(component => component.setDisabled(true));
                await i.update({ components: [row1, row2] });
            }

            try {
                await action();
            } catch (error) {
                console.error(error);
                followUpEphemeral(interaction, "An error occurred. Please try again");
                return;
            }

            if (!skipUpdate) {
                // Enable the buttons again and update the reply
                row1.components.forEach(component => component.setDisabled(false));
                row2.components.forEach(component => component.setDisabled(false));
                await i.editReply({
                    content: '⬅️New Images first \n➡️Original Images last \n',
                    files: attachments,
                    components: [row1, row2],
                });
            }
        }

        // Handle button interactions
        collector.on('collect', async i => {
            switch (i.customId) {
                case 'regenerate':
                    await handleButtonInteraction(i, async () => {
                        // Generate a new image
                        imageBuffer = await generateImage({
                            userInput: userInput,
                            imageModel: imageModel,
                            userID: interaction.user.id,
                            numberOfImages: 1,
                            dimensions: dimensions
                        });
                        attachments.unshift(new AttachmentBuilder(imageBuffer[0]));
                    });
                    break;

                case '25similarity':
                    await handleButtonInteraction(i, async () => {
                        // Generate an image 25% similar to the previous
                        imageBuffer = await generateImageToImage({
                            image: imageBuffer[0],
                            userInput: userInput,
                            negativePrompt: "",
                            Image2Image_Model: process.env.IMAGE_IMAGE2IMAGE_MODEL,
                            strength: 0.75,
                            userID: interaction.user.id
                        });
                        attachments.unshift(new AttachmentBuilder(imageBuffer[0]));
                    });
                    break;

                case '50similarity':
                    await handleButtonInteraction(i, async () => {
                        // Generate an image 50% similar to the previous
                        imageBuffer = await generateImageToImage({
                            image: imageBuffer[0],
                            userInput: userInput,
                            negativePrompt: "",
                            Image2Image_Model: process.env.IMAGE_IMAGE2IMAGE_MODEL,
                            strength: 0.5,
                            userID: interaction.user.id
                        });
                        attachments.unshift(new AttachmentBuilder(imageBuffer[0]));
                    });
                    break;

                case 'upscale':
                    await handleButtonInteraction(i, async () => {
                        // Upscale the current image
                        console.log("Upscale button pressed");
                        const upscaleModel = process.env.IMAGE_UPSCALE_MODEL;
                        const upscaledImageBuffer = await upscaleImage(imageBuffer[0], upscaleModel);
                        attachments.unshift(new AttachmentBuilder(upscaledImageBuffer));
                    });
                    break;

                case 'magic':
                    await handleButtonInteraction(i, async () => {
                        // Optimize the prompt and generate a new image
                        const optimizedPrompt = await promptOptimizer(userInput, interaction.user.id);
                        imageBuffer = await generateImage({
                            userInput: optimizedPrompt,
                            imageModel: imageModel,
                            userID: interaction.user.id,
                            numberOfImages: 1,
                            dimensions: dimensions
                        });
                        attachments.unshift(new AttachmentBuilder(imageBuffer[0]));
                    });
                    break;

                case 'refine':
                    // Show modal to refine the prompt
                    const modal = new ModalBuilder()
                        .setCustomId('refineModal')
                        .setTitle('Refine Image Prompt');

                    const refinementInput = new TextInputBuilder()
                        .setCustomId('refinementInput')
                        .setLabel('Describe what you want to change')
                        .setStyle(TextInputStyle.Paragraph)
                        .setMaxLength(500)
                        .setRequired(true);

                    const modalRow = new ActionRowBuilder().addComponents(refinementInput);
                    modal.addComponents(modalRow);

                    // Show the modal without disabling buttons
                    await i.showModal(modal);
                    break;

                case 'advanced':
                    await handleButtonInteraction(i, async () => {
                        // Placeholder for advanced options
                        await i.editReply({
                            content: 'Consider funding your bot host to cover API fees and keep new features coming❤️',
                            files: attachments,
                            components: [row1, row2],
                        });
                        followUpEphemeral(interaction, "Currently in development! Will be functional soon!");
                    });
                    break;

                default:
                    console.error(`Unknown customId: ${i.customId}`);
                    break;
            }
        });

        // Handle modal submission for editing the image
        interaction.client.on('interactionCreate', async modalInteraction => {
            if (!modalInteraction.isModalSubmit()) return;
            if (modalInteraction.customId !== 'refineModal') return;
            if (modalInteraction.user.id !== interaction.user.id) return;

            // Acknowledge the modal submission
            await modalInteraction.deferUpdate();

            // Disable all buttons while processing
            row1.components.forEach(component => component.setDisabled(true));
            row2.components.forEach(component => component.setDisabled(true));

            // Update the message to disable buttons
            await interaction.editReply({ components: [row1, row2] });

            const refinementRequest = modalInteraction.fields.getTextInputValue('refinementInput');
            try {

                imageBuffer = await generateImageEdit({
                    image: imageBuffer[0],
                    instructions: refinementRequest,
                    userID: interaction.user.id,
                    ImageEdit_Model: process.env.IMAGE_IMAGEEDIT_MODEL
                });
                attachments.unshift(new AttachmentBuilder(imageBuffer[0]));

                // Enable the buttons again and update the reply
                row1.components.forEach(component => component.setDisabled(false));
                row2.components.forEach(component => component.setDisabled(false));

                await interaction.editReply({
                    content: '⬅️New Images first \n➡️Original Images last \n',
                    files: attachments,
                    components: [row1, row2],
                });
            } catch (error) {
                console.error(error);
                await modalInteraction.followUp({ content: "An error occurred while refining the image prompt.", ephemeral: true });
                return;
            }
        });

        // Disable buttons when the collector ends
        collector.on('end', async () => {
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
