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
            // listener for tool calls
            toolCallListener(ws, interaction); // Set up tool call listener with interaction
            resolve(ws); // Resolve the promise with the WebSocket instance
        });
    });
}

async function toolCallListener(ws, interaction) {
    const { generate_image_tool } = require('../tools/imageTool.js');
    const { send_text_to_channel_tool } = require('../tools/sendTextToChannelTool.js');
    const { AttachmentBuilder } = require('discord.js');
    const processedToolCalls = new Set();

    const sendToolOutputAndContinue = (functionCall, output) => {
        const callId = functionCall.call_id || functionCall.id;
        if (!callId) {
            injectMessageGetResponse(ws, String(output || 'Tool executed.'));
            return;
        }

        ws.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
                type: 'function_call_output',
                call_id: callId,
                output: String(output || 'Tool executed successfully.')
            }
        }));

        ws.send(JSON.stringify({
            type: 'response.create',
            response: {
                modalities: ['audio', 'text']
            }
        }));
    };

    const extractFunctionCalls = (serverMessage) => {
        if (
            serverMessage.type === 'response.done' &&
            Array.isArray(serverMessage.response?.output)
        ) {
            return serverMessage.response.output.filter((item) => item?.type === 'function_call');
        }

        if (
            serverMessage.type === 'response.output_item.done' &&
            serverMessage.item?.type === 'function_call'
        ) {
            return [serverMessage.item];
        }

        return [];
    };

    ws.on('message', async (message) => {
        const serverMessage = JSON.parse(message);
        const functionCalls = extractFunctionCalls(serverMessage);
        if (!functionCalls.length) return;

        if (process.env.ADVCONF_OPENAI_VOICE_CHAT_SYSTEM_LOGGING === 'true') {
            console.log("-Tool call requested");
            console.log(functionCalls[0]);
        }

        for (const functionCall of functionCalls) {
            const callKey = functionCall.call_id || functionCall.id;
            if (callKey && processedToolCalls.has(callKey)) {
                if (process.env.ADVCONF_OPENAI_VOICE_CHAT_SYSTEM_LOGGING === 'true') {
                    console.log(`-Skipping duplicate tool call: ${callKey}`);
                }
                continue;
            }
            if (callKey) {
                processedToolCalls.add(callKey);
            }

            switch (functionCall.name) {
                case 'generate_image':
                    console.log("-Tool call function executed: generate_image");
                    try {
                        const imageBuffer = await generate_image_tool(functionCall, interaction);
                        if (!imageBuffer?.[0]) {
                            sendToolOutputAndContinue(functionCall, 'Image generation failed.');
                            continue;
                        }

                        const attachment = new AttachmentBuilder(imageBuffer[0]);
                        await interaction.channel.send({
                            content: "Generated image from voice request",
                            files: [attachment]
                        });
                        sendToolOutputAndContinue(functionCall, 'Image generated and sent to Discord channel.');
                    } catch (error) {
                        console.error("Error processing generate_image tool call:", error);
                        sendToolOutputAndContinue(functionCall, 'Image generation failed.');
                    }
                    break;
                case 'send_text_to_channel':
                    console.log("-Tool call function executed: send_text_to_channel");
                    try {
                        const result = await send_text_to_channel_tool(functionCall, interaction);
                        sendToolOutputAndContinue(functionCall, result || 'Message sent to channel.');
                    } catch (error) {
                        console.error("Error processing send_text_to_channel tool call:", error);
                        sendToolOutputAndContinue(functionCall, 'Failed to send text message to channel.');
                    }
                    break;
                default:
                    sendToolOutputAndContinue(functionCall, `Tool ${functionCall.name || 'unknown'} not found.`);
                    break;
            }
        }
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
    const tools = normalizeToolsForRealtime(params.tools);

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
                tools
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
                max_response_output_tokens: params.max_response_output_tokens,
                tools
            }
        };
    }
    console.log('-Updating session params');
    ws.send(JSON.stringify(event));
}

function normalizeToolsForRealtime(rawTools) {
    const tools = Array.isArray(rawTools)
        ? rawTools.filter(Boolean)
        : (rawTools ? [rawTools] : []);

    return tools
        .map((tool) => {
            if (!tool) return null;

            if (tool.type === 'function' && tool.name) {
                return {
                    type: 'function',
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                    strict: tool.strict
                };
            }

            if (tool.type === 'function' && tool.function?.name) {
                const { name, description, parameters, strict } = tool.function;
                return {
                    type: 'function',
                    name,
                    description,
                    parameters,
                    strict
                };
            }

            return tool;
        })
        .filter(Boolean);
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
    // Set a timeout to automatically stop the silence after 10 seconds
    const timeoutId = setTimeout(() => {
        console.log("-Silence stream timeout reached (10 seconds), stopping");
        clearInterval(intervalId);
    }, 10000);

    console.log("-Started silence stream (will auto-stop after 10 seconds)");

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
function injectMessage(ws, message, role = "user") {
    const conversationItem = {
        type: "conversation.item.create",
        item: {
            type: "message",
            role: role, // user, assistant, system
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
