// File: chat.js
// Author: TryFailTryAgain
// Copyright (c) 2024. All rights reserved. For use in Open-Source projects this
// may be freely copied or excerpted with credit to the author.

/* Getting required modules */
const { SlashCommandBuilder } = require('discord.js');

/* Getting required local files */
const { startChatCollector, stopChatCollector } = require('../../collectors/chatCollector.js');
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
                    { name: 'Until /chat is called again', value: -1 },
                    { name: 'End chat session now', value: 0 }
                )
                .setRequired(true)
        ),
    /* End of the command framing */

    /* Start of the command functional execution */
    async execute(interaction) {
        console.log("---/Chat command executing---");

        // Check if the chatbot is currently active in this channel. End the collector and return if it is
        const chatActive = interaction.client.chatStates.get(interaction.channel.id) || false;
        if (chatActive) {
            stopChatCollector(interaction.channel.id);
            interaction.client.chatStates.set(interaction.channel.id, false);
            await interaction.reply("Chatbot was already active! Disabling now for this channel. Reactive with /Chat again");
            return;
        } else if (interaction.options.getInteger('time') === 0) {
            await interaction.reply("Chatbot is not active in this channel. Use /Chat + a time frame to activate the chat");
            return;
        }

        //Handel activating the chat
        console.log("Activating chatbot in channel: " + interaction.channel.id);
        interaction.client.chatStates.set(interaction.channel.id, true);
        // Start the chat collector
        startChatCollector(interaction, interaction.options.getInteger('time'));
        await interaction.reply("Chatbot is now active for ALL users in this channel for the next " + interaction.options.getInteger('time') + " minutes");

    }
    /* End of the command functional execution */
};