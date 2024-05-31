// File: chat.js
// Author: TryFailTryAgain
// Copyright (c) 2024. All rights reserved. For use in Open-Source projects this
// may be freely copied or excerpted with credit to the author.

/* Getting required modules */
const { SlashCommandBuilder } = require('discord.js');

/* Getting required local files */
const { sendChatMessage } = require('../../functions/chatFunctions.js');
const { filterString, filterCheck } = require('../../functions/helperFunctions.js');
/* End getting required modules and local files */

module.exports = {
    /* Frame of the command */
    cooldown: 1,
data: new SlashCommandBuilder()
    .setName('chat')
    .setDescription('ChatGPT style chatbot')
    .addIntegerOption(option => 
        option.setName('time')
        .setDescription('Chat duration')
        .addChoices(
            { name: '5 minutes', value: 5 },
            { name: '10 minutes', value: 10 },
            { name: '15 minutes', value: 15 },
            { name: 'End chat session now', value: 0 }
        )
        .setRequired(true)
    ),
    /* End of the command framing */

    /* Start of the command functional execution */
    async execute(interaction) {
        // Log the execution of the chat command
        console.log("---Chat command executing---");

        // Check if the chatbot is currently active in this channel
        const chatActive = interaction.client.chatStates.get(interaction.channel.id) || false;
        // Toggle the chatbot's active state for this channel
        interaction.client.chatStates.set(interaction.channel.id, !chatActive);

        console.log(`-Chatbot is now ${!chatActive ? 'active' : 'inactive'} in channel ${interaction.channel.id}`);
        // Inform the user about the new state of the chatbot
        if (!chatActive) {
            await interaction.reply("Chatbot is now active for ALL users in this channel for the next " + interaction.options.getInteger('time') + " minutes");
        } else {
            await interaction.reply("Chatbot is now inactive in this channel");
        }

        // If the chatbot is now inactive, stop further execution on this thread
        if (chatActive) return;

        // Initialize conversation history
        let conversationHistory = [];

        // Create a message collector to listen for messages in the channel
        // The filter ensures that only messages from non-bot users in active channels are collected
        const filter = m => !m.author.bot && interaction.client.chatStates.get(m.channel.id);
        const collector = interaction.channel.createMessageCollector({ filter, time: interaction.options.getInteger('time') * 60000});

        // Handle collected messages
        collector.on('collect', async m => {
            const member = m.guild.members.cache.get(m.author.id);
            const displayName = member.nickname ? member.nickname : member.user.username;
            const userMessage = `Message from: ${displayName}. Message: ${m.content}`;

            // Check if filtering is enabled
            const isFilterEnabled = await filterCheck();
            const filteredUserMessage = isFilterEnabled ? await filterString(userMessage) : userMessage;

            // Add the filtered user's message to the conversation history
            conversationHistory.push({ "role": "user", "content": filteredUserMessage });

            // Send the conversation history to the chatbot service and get the response
            const chatResponse = await sendChatMessage(conversationHistory);

            // Filter the bot's response if filtering is enabled
            const filteredChatResponse = isFilterEnabled ? await filterString(chatResponse) : chatResponse;

            // Add the filtered bot's response to the conversation history
            conversationHistory.push({ role: "assistant", content: filteredChatResponse });
            // Reply to the user's message with the chatbot's response
            m.reply(chatResponse);
        });

        // When the collector ends, inform the user that the chatbot is now inactive
        collector.on('end', async collected => {
            await interaction.followUp("Chatbot time has expired. Chatbot is now inactive in this channel. Please use /chat to activate again");
        });

        // Create a message collector to listen for the bot's "inactive" message
        // This is so we can end the activation /chat call's collector, not just filter it out
        const chatInactiveFilter = m => m.author.bot && m.content === "Chatbot is now inactive in this channel";
        const chatInactiveCollector = interaction.channel.createMessageCollector({ filter: chatInactiveFilter, time: interaction.options.getInteger('time') * 60000});

        // End the execution of the command if the specific message is collected
        chatInactiveCollector.on('collect', m => {
            console.log("--Bot's 'inactive' message collected. Ending command execution on original bot activation thread--");
            // Stop the message collectors
            collector.stop();
            chatInactiveCollector.stop();
            // Clear the conversation history
            conversationHistory = [];
        });
    }
    /* End of the command functional execution */
};
