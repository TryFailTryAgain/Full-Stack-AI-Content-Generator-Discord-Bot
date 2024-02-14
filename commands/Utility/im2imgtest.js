// File: img2imgtest.js
// Author: TryFailTryAgain
// Copyright (c) 2023. All rights reserved. For use in Open-Source projects this
// may be freely copied or excerpted with credit to the author.

/* Getting required modules */
const { SlashCommandBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const sharp = require('sharp');
const fs = require('fs');
/* Getting required local files */
const imageFunctions = require('../../functions/image_functions.js');
const ImageChatModal = require('../../components/imageChatModal.js');// Add all the image functions to the global scope
for (let key in imageFunctions) {
    global[key] = imageFunctions[key];
}
/* End getting required modules */

module.exports = {
    /* Frame of the command */
    cooldown: 1,
    data: new SlashCommandBuilder()
        .setName('img2imgtest')
        .setDescription('Generates an image from your prompts!'),

    /* End of the command framing */

    /* Start of the command functional execution */
    async execute(interaction, client) {

        // Responds to the command to prevent discord timeout and this will display that the bot is thinking
        // Editing with .editReply will remove the loading message and replace it with the new message
        await interaction.deferReply();
        const dimensions = 'square'; // The dimensions of the image to be generated
        const steps = 20; // The number of steps to run the model for
        const seed = 0; // The seed to use for the model
        const cfgScale = 6; // The scale of the model
        const imageModel = 'stability'; // The model to use for the image generation
        const userInput = 'pixel art style'; // The prompt that the user entered
        const uid = "default"
        // Generate the image
        let imageBuffer = null;

        // This is an example that we can submit ann image from a file or from a base64 converted string and a buffer
        let img = fs.readFileSync('./Outputs/input.png');
        let base64 = img.toString('base64');
        const base64Image = Buffer.from(base64, 'base64');

        try {
            // TODO: ad the ability to change the modification strength via the modal. Currently defaults to: 0.5
            // Generate a similar image using img2img from Stability.ai
            imageBuffer = await generateImageToImage(base64Image, userInput, 0.3, cfgScale, steps, seed, uid);
        } catch (error) {
            console.error(error);
            followUpEphemeral(interaction, "An error occurred while generating the refined image. Please try again");
            return;
        }
        // Adds the generated images to the message attachments that will be returned to discord
        let attachments = [];
        for (let i = 0; i < imageBuffer.length; i++) {
            attachments.push(new AttachmentBuilder(imageBuffer[i]));
        }
        /* End of image generation */

        // Edit the reply to show the generated image and the buttons
        let apiCreditReply = 'Heres a check message';
        await interaction.editReply({
            content: apiCreditReply,
            files: attachments,
        });
    }
};