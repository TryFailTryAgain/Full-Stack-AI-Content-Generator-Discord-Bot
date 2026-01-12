/*
* voiceGlobalState.js
* Minimal global state for voice chat TTS
*/

let isVoiceChatShuttingDown = false;

const playbackState = {
    isPlaying: false,
    player: null,
    startTimestamp: null
};

function setVoiceChatShutdownStatus(status) {
    isVoiceChatShuttingDown = Boolean(status);
}

module.exports = {
    get isVoiceChatShuttingDown() {
        return isVoiceChatShuttingDown;
    },
    setVoiceChatShutdownStatus,
    playbackState
};
