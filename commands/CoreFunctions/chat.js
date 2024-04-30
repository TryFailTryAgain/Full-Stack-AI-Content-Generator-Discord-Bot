// File: chat.js
// Author: TryFailTryAgain
// Copyright (c) 2024. All rights reserved. For use in Open-Source projects this
// may be freely copied or excerpted with credit to the author.

////* Getting required modules *////
const { SlashCommandBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

////* Getting required local files *////
const { sendChatMessage } = require('../../functions/chatFunctions.js');

// Add all the image functions to the global scope
// Removed the addition of chat functions to the global scope, as we will use them directly

////* End getting required modules and local files *////

module.exports = {
    ////* Frame of the command *////
    cooldown: 1,
    data: new SlashCommandBuilder()
        .setName('chat')
        .setDescription('ChatGPT style chatbot')
        .addStringOption(option =>
            option.setName('input')
                .setDescription('Your chat message')
                .setRequired(true)
        ),
    ////* End of the command framing *////

    ////* Start of the command functional execution *////
    async execute(interaction, client) {
        // Get the user's chat message from the interaction
        const userMessage = interaction.options.getString('input');

        // Defer the reply to give us time to process the chat message
        await interaction.deferReply();

        // Send the chat message to the chatbot service and get the response
        const chatResponse = await sendChatMessage(userMessage);

        // Send the chatbot's response back to the user
        await interaction.editReply(chatResponse);
    }
    ////* End of the command functional execution *////
};
    