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
    async execute(interaction) {
        console.log("---Chat command executing---");
        //Build the conversation history array to store all incoming and outgoing messages
        const conversationHistory = [];
        // Store the user's message to the conversation history
        conversationHistory.push({"role": "user", "content": interaction.options.getString('input')});
        // Defer the reply to give us time to process the chat message
        await interaction.deferReply();

    
        // Send the chat message to the chatbot service and get the response
        const chatResponse = await sendChatMessage(conversationHistory);

        conversationHistory.push({ role: "assistant", "content": chatResponse });

        // Send the chatbot's response back to the user
        console.log("-Sending chat response to Discord-");
        const sentMessage = await interaction.editReply(chatResponse);

        // if it is in the same channel as the bot's message, and if the author is the same as the command user
        const filter = m => m.author.id === interaction.user.id;
        const collector = interaction.channel.createMessageCollector({ filter, time: 60_000 });

        collector.on('collect', m => {
            console.log(`Received message from user: ${m.content}`);
            conversationHistory.push({ role: "user", "content": m.content });
            sendChatMessage(conversationHistory).then(chatResponse => {
                conversationHistory.push({ role: "assistant", "content": chatResponse });
                m.reply(chatResponse);
            });
            
        });

        collector.on('end', collected => {
            console.log(`Collected ${collected.size} items`);
        });
    }
    ////* End of the command functional execution *////
};
