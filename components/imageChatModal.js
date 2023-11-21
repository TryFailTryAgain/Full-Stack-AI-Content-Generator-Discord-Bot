const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

module.exports = {
    createImageChatModal: function () {
        // existing modal creation code...
        const chatRefinement = new TextInputBuilder()
            .setCustomId('chatRefinement')
            .setLabel("Chat Refinement")
            .setMaxLength(1500)
            .setStyle(TextInputStyle.Paragraph);

        const chatRefineModal = new ModalBuilder()
            .setCustomId(`chatRefineModal`)
            .setTitle("Chat Refinement");

        const actionRow = new ActionRowBuilder().addComponents(chatRefinement);

        chatRefineModal.addComponents(actionRow);
        // Return the modal so it can be used elsewhere
        return chatRefineModal;
    },
    waitForModalSubmit: function (interaction) {
        // Return a promise that resolves when the modal is submitted
        return new Promise((resolve, reject) => {
            // Set up a one-time listener for the modal submit interaction
            const filter = (i) => i.customId === 'chatRefineModal' && i.user.id === interaction.user.id;
            interaction.awaitModalSubmit({ filter, time: 30000 })
                .then(modalInteraction => {
                    // Resolve the promise with the value from the modal
                    const refinementRequest = modalInteraction.fields.getTextInputValue('chatRefinement');
                    resolve(refinementRequest);
                    modalInteraction.deferUpdate();
                })
                .catch(error => {
                    // Reject the promise if there's an error
                    reject(error);
                });
        });
    }
};