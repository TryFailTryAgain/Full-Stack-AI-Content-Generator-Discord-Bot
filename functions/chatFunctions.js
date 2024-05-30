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

// File paths
const SETTINGS_FILE_PATH = './settings.ini';
const API_KEYS_FILE_PATH = './api_keys.ini';

// Acquiring Global values
const config = getIniFileContent(SETTINGS_FILE_PATH);
const apiKeys = getIniFileContent(API_KEYS_FILE_PATH);

// Validate API keys
if (!apiKeys.Keys.OpenAIChat || !apiKeys.Keys.OpenAIImage) {
    throw new Error("OpenAIChat API key is not set in api_keys.ini");
}
// Get base URL for the API
const openaiChatBaseURL = config.Advanced.OpenAI_Chat_Base_URL; 
const openaiImageBaseURL = config.Advanced.OpenAI_Image_Base_URL;

// Set the API keys for OpenAI and the base URL
const openaiChat = new OpenAI({ apiKey: apiKeys.Keys.OpenAIChat });
openaiChat.baseURL = openaiChatBaseURL;
const openaiImage = new OpenAI({ apiKey: apiKeys.Keys.OpenAIImage });
openaiImage.baseURL = openaiImageBaseURL;

// Get the model to be used for generating responses
const prompt_Model = config.Image_command_settings.Prompt_Model;


// Sends a chat message to a chatbot service and returns the response
async function sendChatMessage(conversationHistory) {
    try {
        // Send the conversation history to OpenAI and get the response
        const response = await openaiChat.chat.completions.create({ // Create a chat completion
            messages: [
                { // TODO: Make this System Prompt configurable in the settings file
                    role: "system",
                    content: "You are a helpful assistant."
                },
                ...conversationHistory
            ],
            model: prompt_Model,
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
};
