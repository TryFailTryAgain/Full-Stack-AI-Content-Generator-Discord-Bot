// File: chatFunctions.js
// Author: TryFailTryAgain
// Copyright (c) 2024. All rights reserved. For use in Open-Source projects this
// may be freely copied or excerpted with credit to the author.

/* Getting required modules */
const imageFunctions = require('./image_functions.js');
/* Add all the image functions to the global scope */
for (let key in imageFunctions) {
    global[key] = imageFunctions[key];
}
/* End required modules */
const { OpenAI } = require('openai');
const { moderateContent } = require('./moderation.js');

// Validate API keys
if (!process.env.API_KEY_OPENAI_CHAT || !process.env.API_KEY_OPENAI_IMAGE) {
    throw new Error("OpenAIChat API key is not set in environment variables");
}
// Get base URL for the API
const openaiChatBaseURL = process.env.ADVCONF_OPENAI_CHAT_BASE_URL;
const openaiImageBaseURL = process.env.ADVCONF_OPENAI_IMAGE_BASE_URL;

// Set the API keys for OpenAI and the base URL
const openaiChat = new OpenAI({ apiKey: process.env.API_KEY_OPENAI_CHAT });
openaiChat.baseURL = openaiChatBaseURL;
const openaiImage = new OpenAI({ apiKey: process.env.API_KEY_OPENAI_IMAGE });
openaiImage.baseURL = openaiImageBaseURL;

// This is a profanity filter that will prevent the bot from passing profanity and other rude words
console.log(`Profanity filter -- /Chat == ${filterCheck() ? 'ENABLED' : 'DISABLED'}`);

// Get the model and parameters to pass to the LLM API
function getChatSettings() {
    return {
        chatModel: process.env.CHAT_MODEL,
        chatTemperature: parseFloat(process.env.CHAT_TEMPERATURE),
        maxTokens: parseInt(process.env.CHAT_MAX_TOKENS),
        systemMessage: process.env.CHAT_SYSTEM_MESSAGE
    };
}

// Sends a chat message to a chatbot service and returns the response
async function sendChatMessage(conversationHistory) {
    try {
        // Moderation check: only check the most recent user message
        console.log(conversationHistory);
        // Find the last user message in the conversation history
        const lastUserMsgObj = [...conversationHistory].reverse().find(msg => msg.role === 'user');
        const lastUserMsg = lastUserMsgObj.content;
        if (await moderateContent({ text: lastUserMsg })) {
            throw new Error('Message/username flagged by moderation. Aborting chat request.');
        }

        // Send the conversation history to OpenAI and get the response
        const chatSettings = getChatSettings();
        const response = await openaiChat.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: chatSettings.systemMessage
                },
                ...conversationHistory
            ],
            model: chatSettings.chatModel,
            temperature: chatSettings.chatTemperature,
            max_tokens: chatSettings.maxTokens
        });

        // Check if a valid response was received
        if (response.choices && response.choices.length > 0) {
            console.log('Received chat response:', response.choices[0].message.content);
            return response.choices[0].message.content;
        } else {
            throw new Error('No response from OpenAI.');
        }
    } catch (error) {
        console.error('Error sending chat message:', error);
        throw error;
    }
}

/* Export the sendChatMessage function */
module.exports = { // Export the function for use in other files
    sendChatMessage,
    getChatSettings
};
