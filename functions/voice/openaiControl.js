/* 
* File: openaiControl.js
* Author: TryFailTryAgain
* Copyright (c) 2025. All rights reserved. For use in Open-Source projects this
* may be freely copied or excerpted with credit to the author.
*/
const WebSocket = require('ws');
const state = require('./voiceGlobalState.js');

// Set up a WebSocket connection to OpenAI's real-time voice API
function setupRealtimeVoiceWS() {
    // Reset the shutdown flag when setting up a new connection
    state.isVoiceChatShuttingDown = false;
    // Use the environment variable for the model URL
    const wsUrl = process.env.VOICE_CHAT_MODEL_URL;
    const ws = new WebSocket(wsUrl, {
        headers: {
            "Authorization": "Bearer " + process.env.API_KEY_OPENAI_CHAT,
            "OpenAI-Beta": "realtime=v1",
        },
    });
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
    return ws;
}

// Update the session parameters for OpenAI voice API
function updateSessionParams(ws, params) {
    let event = null;
    if (process.env.ADVCONF_OPENAI_VOICE_CHAT_SYSTEM_LOGGING === 'true') {
        console.log(`-Session has enabled full logging.`);
        event = {
            type: 'session.update',
            session: {
                instructions: params.instructions,
                temperature: parseFloat(params.temperature),
                voice: params.voice,
                max_response_output_tokens: params.max_response_output_tokens,
                input_audio_transcription: {
                    "model": "whisper-1"
                },
            }
        };
    } else {
        event = {
            type: 'session.update',
            session: {
                instructions: params.instructions,
                temperature: parseFloat(params.temperature),
                voice: params.voice,
                max_response_output_tokens: params.max_response_output_tokens
            }
        };
    }
    console.log('-Updating session params');
    ws.send(JSON.stringify(event));
}


// Request a response from OpenAI with specific instructions
function injectMessageGetResponse(ws, instruction) {
    const responseRequest = {
        type: "response.create",
        response: {
            modalities: ['audio', 'text'],
            instructions: instruction
        }
    };
    ws.send(JSON.stringify(responseRequest));
    console.log("-Requested audio response with instruction from server");
}

// Inject a text message into the history without inducing inference
function injectMessage(ws, message) {
    const conversationItem = {
        type: "conversation.item.create",
        item: {
            type: "message",
            role: "user",
            content:[
                {
                    type: "input_text",
                    text: message
                }
            ]
        }
    };
    ws.send(JSON.stringify(conversationItem));
    console.log("-Injected message into conversation");
}

// Cancel an in-progress response
function cancelResponse(ws) {
    const cancelEvent = {
        type: 'response.cancel'
    };
    ws.send(JSON.stringify(cancelEvent));
    console.log("-Sent response.cancel event to server");
}

module.exports = {
    setupRealtimeVoiceWS,
    updateSessionParams,
    injectMessageGetResponse,
    injectMessage,
    cancelResponse // Export the new function
};
