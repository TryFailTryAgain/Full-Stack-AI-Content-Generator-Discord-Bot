/* 
* File: openaiControl.js
* Author: TryFailTryAgain
* Copyright (c) 2025. All rights reserved. For use in Open-Source projects this
* may be freely copied or excerpted with credit to the author.
*/
const WebSocket = require('ws');
const state = require('./voiceGlobalState.js');

// Set up a WebSocket connection to OpenAI's real-time voice API
async function setupRealtimeVoiceWS(interaction) {
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

    // Return a promise that resolves when the connection is established
    return new Promise((resolve, reject) => {
        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
            reject(error); // Reject the promise on error
        });

        ws.on('open', () => {
            console.log('-WebSocket connection established to OpenAI voice API');
            // Setup detailed websocket message logging if enabled
            if (process.env.ADVCONF_OPENAI_VOICE_CHAT_SYSTEM_LOGGING === 'true') {
                setupWsMessageLogging(ws);
            }
        });
    });
}

// Helper function to set up WebSocket message logging
function setupWsMessageLogging(ws) {
    console.log(`-Session has enabled full logging.`);
    ws.on("message", message => {
        const serverMessage = JSON.parse(message);
        const excludedTypes = [
            "response.audio.delta", "response.audio_transcript.delta", "response.function_call_arguments.delta"
        ];
        if (!excludedTypes.includes(serverMessage.type)) {
            console.log("Server message:", serverMessage);
        }
    });
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
                turn_detection: {
                    type: "semantic_vad", // Use semantic VAD for turn detection
                    eagerness: process.env.OPENAI_VOICE_CHAT_RESPONSE_EAGERNESS
                },
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
                turn_detection: {
                    type: "semantic_vad", // Use semantic VAD for turn detection
                    eagerness: process.env.OPENAI_VOICE_CHAT_RESPONSE_EAGERNESS
                },
                max_response_output_tokens: params.max_response_output_tokens
            }
        };
    }
    console.log('-Updating session params');
    ws.send(JSON.stringify(event));
}

// Start sending empty audio packets to keep the semantic VAD processing correctly
// Start sending silence packets to OpenAI, returns control object
function startSilenceStream(ws, silenceInterval = 100) {
    // Create a function to send silence audio packets to OpenAI
    const sendSilencePacket = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            // Create a small silent PCM buffer (16-bit samples at 24kHz)
            // For 100ms of silence: 24000 samples/sec * 0.1 sec * 2 bytes/sample = 4800 bytes
            const silenceBuffer = Buffer.alloc(4800, 0);

            // Send silence as base64-encoded audio data
            ws.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: silenceBuffer.toString('base64')
            }));
        }
    };

    // Start sending silence packets at regular intervals
    const intervalId = setInterval(sendSilencePacket, silenceInterval);
    // Set a timeout to automatically stop the silence after 5 seconds
    const timeoutId = setTimeout(() => {
        console.log("-Silence stream timeout reached (5 seconds), stopping");
        clearInterval(intervalId);
    }, 5000);

    console.log("-Started silence stream (will auto-stop after 5 seconds)");

    // Return control object so both interval and timeout can be cleared
    return { intervalId, timeoutId };
}

// Stop sending silence packets and clear timeout
function stopSilenceStream(control) {
    if (control) {
        clearInterval(control.intervalId);
        clearTimeout(control.timeoutId);
        console.log("-Stopped silence stream");
    }
    return null;
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
            role: "system",
            content: [
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
    cancelResponse,
    startSilenceStream,
    stopSilenceStream
};
