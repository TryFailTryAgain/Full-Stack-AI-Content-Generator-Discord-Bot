// File: imageChatModal.js
// Author: TryFailTryAgain
// Copyright (c) 2023. All rights reserved. For use in Open-Source projects this
// may be freely copied or excerpted with credit to the author.

const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

module.exports = {
    createImageChatModal: function () {
        const toBeReplaced = new TextInputBuilder()
            .setCustomId('toBeReplaced')
            .setLabel("To be REPLACED. The simpler the better")
            .setMaxLength(150)
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const replaceWith = new TextInputBuilder()
            .setCustomId('replaceWith')
            .setLabel("What do you want to replace IT with?")
            .setMaxLength(1500)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const negative_prompt = new TextInputBuilder()
            .setCustomId('negative_prompt')
            .setLabel("Negative prompt. What you dont want it to be")
            .setMaxLength(1500)
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        const chatRefineModal = new ModalBuilder()
            .setCustomId(`chatRefineModal`)
            .setTitle("Chat Refinement");

        const actionRow1 = new ActionRowBuilder().addComponents(toBeReplaced);
        const actionRow2 = new ActionRowBuilder().addComponents(replaceWith);
        const actionRow3 = new ActionRowBuilder().addComponents(negative_prompt);

        chatRefineModal.addComponents(actionRow1, actionRow2, actionRow3);

        return chatRefineModal;
    },
    waitForModalSubmit: function (interaction) {
        // Return a promise that resolves when the modal is submitted
        return new Promise((resolve, reject) => {
            // Sets up a one-time listener for the modal submit interaction
            const filter = (i) => i.customId === 'chatRefineModal' && i.user.id === interaction.user.id;
            interaction.awaitModalSubmit({ filter, time: 300_000 }) // 5 min. Max time is 15 minutes. but stay under to allow processing
                .then(modalInteraction => {
                    // Resolves the promise with the value from the modal
                    const toBeReplacedValue = modalInteraction.fields.getTextInputValue('toBeReplaced');
                    const replaceWithValue = modalInteraction.fields.getTextInputValue('replaceWith');
                    const negativePrompt = modalInteraction.fields.getTextInputValue('negative_prompt');
                    resolve({toBeReplaced: toBeReplacedValue, replaceWith: replaceWithValue, negativePrompt: negativePrompt});
                    modalInteraction.deferUpdate();
                })
                .catch(error => {
                    // Rejects the promise if there's an error
                    reject(error);
                });
        });
    }
};