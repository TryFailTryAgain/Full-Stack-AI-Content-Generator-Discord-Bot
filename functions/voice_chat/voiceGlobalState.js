/* 
* File: chatFunctions.js
* Author: TryFailTryAgain
* Copyright (c) 2025. All rights reserved. For use in Open-Source projects this
* may be freely copied or excerpted with credit to the author.
*/

// Flag to track if voice chat is in shutdown mode
let isVoiceChatShuttingDown = false;


// Global variables to track audio state
const currentAudioState = {
    responseItemId: null,
    startTimestamp: null,
    isPlaying: false,
    player: null,
    audioStream: null,
    ffmpeg: null
};

// Set the shutdown status for voice chat
function setVoiceChatShutdownStatus(status) {
    isVoiceChatShuttingDown = status;
    console.log(`--Voice chat shutdown status set to: ${status}`);
}

module.exports = {
    isVoiceChatShuttingDown,
    currentAudioState,
    lastSpeakerId: null,
    setVoiceChatShutdownStatus
};
