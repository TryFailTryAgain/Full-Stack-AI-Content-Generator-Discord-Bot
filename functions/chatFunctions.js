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

// Log moderation status
const moderationEnabled = (process.env.MODERATION_OPENAI_MODERATION || 'false').trim().toLowerCase() === 'true';
console.log(`OpenAI Moderation -- /Chat == ${moderationEnabled ? 'ENABLED' : 'DISABLED'}`);

// Determine which API backend to use: 'responses' or 'completions'
// Default to 'completions' for backwards compatibility
const chatApiBackend = (process.env.CHAT_API_BACKEND || 'completions').trim().toLowerCase();
console.log(`Chat API Backend -- Using: ${chatApiBackend.toUpperCase()}`);

// Get the model and parameters to pass to the LLM API
function getChatSettings() {
    const tempValue = process.env.CHAT_TEMPERATURE;
    const reasoningValue = process.env.CHAT_REASONING_EFFORT;

    return {
        chatModel: process.env.CHAT_MODEL,
        // Only include temperature if it's set and valid
        chatTemperature: tempValue ? parseFloat(tempValue) : undefined,
        maxTokens: parseInt(process.env.CHAT_MAX_TOKENS),
        systemMessage: process.env.CHAT_SYSTEM_MESSAGE,
        // reasoning_effort: 'low', 'medium', 'high' - only for reasoning models
        reasoningEffort: reasoningValue || undefined
    };
}

// Sends a chat message using the Chat Completions API (legacy)
async function sendChatMessageCompletions(conversationHistory) {
    const chatSettings = getChatSettings();

    // Build request options, only including optional params if they are set
    const requestOptions = {
        messages: [
            {
                role: "system",
                content: chatSettings.systemMessage
            },
            ...conversationHistory
        ],
        model: chatSettings.chatModel,
        max_completion_tokens: chatSettings.maxTokens
    };

    // Only add temperature if provided
    if (chatSettings.chatTemperature !== undefined && !isNaN(chatSettings.chatTemperature)) {
        requestOptions.temperature = chatSettings.chatTemperature;
    }

    // Only add reasoning_effort if provided (for reasoning models)
    if (chatSettings.reasoningEffort) {
        requestOptions.reasoning_effort = chatSettings.reasoningEffort;
    }

    const response = await openaiChat.chat.completions.create(requestOptions);

    // Check if a valid response was received
    if (response.choices && response.choices.length > 0) {
        console.log('Received chat response (completions):', response.choices[0].message.content);
        return response.choices[0].message.content;
    } else {
        throw new Error('No response from OpenAI Chat Completions API.');
    }
}

// Sends a chat message using the Responses API (new)
async function sendChatMessageResponses(conversationHistory) {
    const chatSettings = getChatSettings();

    // Build request options, only including optional params if they are set
    const requestOptions = {
        model: chatSettings.chatModel,
        instructions: chatSettings.systemMessage,
        input: conversationHistory,
        max_output_tokens: chatSettings.maxTokens,
        store: false // Don't store responses by default for privacy
    };

    // Only add temperature if provided
    if (chatSettings.chatTemperature !== undefined && !isNaN(chatSettings.chatTemperature)) {
        requestOptions.temperature = chatSettings.chatTemperature;
    }

    // Only add reasoning_effort if provided (for reasoning models)
    if (chatSettings.reasoningEffort) {
        requestOptions.reasoning = { effort: chatSettings.reasoningEffort };
    }

    const response = await openaiChat.responses.create(requestOptions);

    // The Responses API returns output_text as a helper for simple text responses
    if (response.output_text) {
        console.log('Received chat response (responses):', response.output_text);
        return response.output_text;
    }

    // Fallback: Extract text from the output array if output_text is not available
    if (response.output && response.output.length > 0) {
        // Find the message item in the output
        const messageItem = response.output.find(item => item.type === 'message');
        if (messageItem && messageItem.content && messageItem.content.length > 0) {
            const textContent = messageItem.content.find(c => c.type === 'output_text');
            if (textContent && textContent.text) {
                console.log('Received chat response (responses):', textContent.text);
                return textContent.text;
            }
        }
    }

    throw new Error('No response from OpenAI Responses API.');
}

// Sends a chat message to a chatbot service and returns the response
// Uses the configured backend (responses or completions)
async function sendChatMessage(conversationHistory) {
    try {
        // Conversation history is already moderated before calling this function
        console.log(conversationHistory);

        // Use the appropriate backend based on environment configuration
        if (chatApiBackend === 'responses') {
            return await sendChatMessageResponses(conversationHistory);
        } else {
            // Default to completions for backwards compatibility
            return await sendChatMessageCompletions(conversationHistory);
        }
    } catch (error) {
        console.error('Error sending chat message:', error);
        throw error;
    }
}

/* Export the sendChatMessage function */
module.exports = { // Export the function for use in other files
    sendChatMessage,
    getChatSettings,
    sendChatMessageCompletions,
    sendChatMessageResponses
};
