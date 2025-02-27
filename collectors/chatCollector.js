const { sendChatMessage } = require('../functions/chatFunctions.js');
const { filterCheckThenFilterString } = require('../functions/helperFunctions.js');

let conversationHistory = [];
let activeCollectors = new Map();

// Starts the chat collector in the given channel for the duration specified
function startChatCollector(interaction, time) {
    const channelId = interaction.channel.id;

    // Collects messages from the active channel and sends them to the chatbot service for a response
    // The filter ensures that only messages from non-bot users in active channels are collected
    const filter = m => !m.author.bot && interaction.client.chatStates.get(m.channel.id);
    if (time === -1) time = "";
    const collector = interaction.channel.createMessageCollector({ filter, time: time * 60000 });

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

    // Store the collector in the activeCollectors map
    activeCollectors.set(channelId, collector);

    collector.on('end', () => {
        // Remove the collector from the activeCollectors map when it ends
        activeCollectors.delete(channelId);
        interaction.client.chatStates.set(channelId, false);
        console.log("--Chat collector in channel: " + channelId + " has hit 'end' event and is now terminated--");
    });
}
// Ends any chat collectors in the given channel
function stopChatCollector(channelId) {
    if (activeCollectors.has(channelId)) {
        console.log("-Stopping chat collector in channel: " + channelId);
        const collector = activeCollectors.get(channelId);
        collector.stop();
        activeCollectors.delete(channelId);
        conversationHistory = [];
    }
}

module.exports = {
    startChatCollector,
    stopChatCollector
};
