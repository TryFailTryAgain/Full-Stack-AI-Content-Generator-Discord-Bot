// File: chat.js
// Author: TryFailTryAgain
// Copyright (c) 2024. All rights reserved. For use in Open-Source projects this
// may be freely copied or excerpted with credit to the author.

/* Getting required modules */
const { SlashCommandBuilder } = require('discord.js');

/* Getting required local files */
const { sendChatMessage } = require('../../functions/chatFunctions.js');
const { filterCheckThenFilterString } = require('../../functions/helperFunctions.js');
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
                    { name: '15 minutes', value: 14.8 }, // 15 minutes is the max time allowed for a slash command, 14.8 to give a little buffer
                    { name: 'End chat session now', value: 0 }
                )
                .setRequired(true)
        ),
    /* End of the command framing */

    /* Start of the command functional execution */
    async execute(interaction) {
        console.log("---Chat command executing---");
        // Initialize conversation history
        let conversationHistory = [];

        // Check if the chatbot is currently active in this channel
        const chatActive = interaction.client.chatStates.get(interaction.channel.id) || false;
        // Toggle the chatbot's active state for this channel
        interaction.client.chatStates.set(interaction.channel.id, !chatActive);
        console.log(`-Chatbot is now ${!chatActive ? 'active' : 'inactive'} in channel ${interaction.channel.id}`);
        // Inform the user about the new state of the chatbot
        if (!chatActive) {
            await interaction.reply("Chatbot is now active for ALL users in this channel for the next " + interaction.options.getInteger('time') + " minutes");
        } else {
            await interaction.reply("Chatbot was previously active and will now be disabled within this channel");
        }
        // If the chatbot is now inactive, stop further execution on this thread. The chatInactiveCollector will terminate the original activation thread
        if (chatActive) return;


        // Collects messages from the active channel and sends them to the chatbot service for a response
        // The filter ensures that only messages from non-bot users in active channels are collected
        const filter = m => !m.author.bot && interaction.client.chatStates.get(m.channel.id);
        const collector = interaction.channel.createMessageCollector({ filter, time: interaction.options.getInteger('time') * 60000 });

        collector.on('collect', async m => {
            // Get the user's display name/Nickname for the user within the server
            const member = m.guild.members.cache.get(m.author.id);
            const displayName = member.nickname ? member.nickname : member.user.username;
            // Create the user's message and filter if enabled
            let userMessage = `Message from: ${displayName}. Message: ${m.content}`;
            userMessage = await filterCheckThenFilterString(userMessage);
            let chatResponse = "";

            // Add the user's message to the conversation history
            conversationHistory.push({ "role": "user", "content": userMessage });

            // Send the conversation history to the chatbot service and get the response, Filter the bot's response if filtering is enabled
            try {
                chatResponse = await sendChatMessage(conversationHistory);
            } catch (error) {
                followUp(interaction, "An error occurred while sending/receiving the message to the chatbot service. Please try again later");
                return;
            }
            chatResponse = await filterCheckThenFilterString(chatResponse);

            // Add the filtered bot's response to the conversation history
            conversationHistory.push({ role: "assistant", content: chatResponse });
            // Reply to the user's message with the chatbot's response
            m.reply(chatResponse);
        });

        // When the collector ends, inform the user that the chatbot is now inactive
        collector.on('end', async () => {
            await interaction.followUp("Chatbot time has expired. Chatbot is now inactive in this channel. Please use /chat to activate again");
            // Set the bot's active state to false when the collector ends
            interaction.client.chatStates.set(interaction.channel.id, false);
        });


        //*Create a message collector to listen for the bot's "inactive" message *//
        // This is so we can end the activation /chat call's collector, not just filter it out
        const chatInactiveFilter = m => m.author.bot && m.content === "Chatbot was previously active and will now be disabled within this channel";
        const chatInactiveCollector = interaction.channel.createMessageCollector({ filter: chatInactiveFilter, time: interaction.options.getInteger('time') * 60000 });

        // End the execution of the command if the specific message is collected
        chatInactiveCollector.on('collect', m => {
            console.log("--Bot's 'inactive' message collected. Ending command execution on original bot activation thread--");
            // Stop the message collectors
            collector.stop();
            chatInactiveCollector.stop();
            // Clear the conversation history
            conversationHistory = [];
        });
        //*End of the message collector for the bot's "inactive" message *//
    }
    /* End of the command functional execution */
};
