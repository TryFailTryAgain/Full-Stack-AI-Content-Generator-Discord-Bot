/*
* audioBridge.js
* Discord voice audio I/O: captures opus streams from speakers,
* decodes to PCM, forwards to STT, handles interruption scheduling
* and silence injection for VAD.
*/
const { EndBehaviorType } = require('@discordjs/voice');
const { OpusEncoder } = require('@discordjs/opus');
const state = require('./voiceGlobalState.js');

function resolveMember(channel, userId) {
    const member = channel.members.get(userId) || channel.guild.members.cache.get(userId);
    if (!member) return { userId, username: `User ${userId}` };
    return {
        userId,
        username: member.nickname || member.displayName || member.user?.username || `User ${userId}`
    };
}

/**
 * Injects silence into the transcription stream to help VAD detect end of speech
 * @param {Object} transcription - The transcription interface with sendAudio method
 * @param {Object} config - Audio config with silence settings
 * @returns {Promise<void>}
 */
function injectSilence(transcription, config) {
    return new Promise((resolve) => {
        if (!transcription || !config.silenceStreamEnabled) {
            resolve();
            return;
        }

        const packetMs = config.silencePacketMs || 100;
        const totalMs = config.silencePaddingMs || 4000;
        const packets = Math.ceil(totalMs / packetMs);

        // 24kHz mono 16-bit PCM: samples = sampleRate * seconds * bytesPerSample
        // For 100ms: 24000 * 0.1 * 2 = 4800 bytes
        const silenceBuffer = Buffer.alloc(Math.floor(24000 * (packetMs / 1000) * 2), 0);

        let sent = 0;
        console.log(`[AudioBridge] Injecting ${totalMs}ms of silence (${packets} packets)`);

        const intervalId = setInterval(() => {
            if (sent >= packets) {
                clearInterval(intervalId);
                console.log(`[AudioBridge] Silence injection complete`);
                resolve();
                return;
            }

            transcription.sendAudio(silenceBuffer);
            sent++;
        }, packetMs);
    });
}

function scheduleInterruption({ userId, config, speech, canInterrupt, isSpeakerActive }) {
    if (config.preventInterruptions) return null;
    let timer = null;

    const attemptInterrupt = () => {
        if (!isSpeakerActive?.()) return;
        if (!speech.isSpeaking()) return;

        if (typeof canInterrupt === 'function' && !canInterrupt()) {
            timer = setTimeout(attemptInterrupt, 250);
            return;
        }

        console.log(`[AudioBridge] Interrupting TTS due to user ${userId} speaking.`);
        speech.stop('user-interrupt');
    };

    timer = setTimeout(attemptInterrupt, config.interruptionDelayMs || 1000);

    return {
        cancel() {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        }
    };
}

function flushTranscript(audioState, onTranscript) {
    const transcript = audioState.partialTranscript.trim();
    audioState.partialTranscript = '';
    if (!transcript) return;
    onTranscript?.({ transcript, speaker: audioState.lastSpeaker });
}

function attachDiscordAudio({ connection, channel, config, speech, transcription, audioState, onTranscript, onBatchAudio, canInterrupt }) {
    const activeSpeakers = audioState.activeSpeakers;

    const handleSpeakingStart = (userId) => {
        if (state.isVoiceChatShuttingDown || activeSpeakers.has(userId)) return;
        const metadata = { ...resolveMember(channel, userId), userId, startedAt: Date.now() };
        audioState.lastSpeaker = metadata;

        const opusStream = connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } });
        const decoder = new OpusEncoder(24000, 1);
        const bufferList = [];

        opusStream.on('data', (packet) => {
            try {
                const pcm = decoder.decode(packet);
                if (config.transcriptionMode === 'realtime' && transcription) {
                    let offset = 0;
                    const chunkSize = 5000;
                    while (offset < pcm.length) {
                        transcription.sendAudio(pcm.subarray(offset, offset + chunkSize));
                        offset += chunkSize;
                    }
                } else {
                    bufferList.push(Buffer.from(pcm));
                }
            } catch (error) {
                console.error('[AudioBridge] Opus decode error:', error);
            }
        });

        opusStream.on('error', (error) => console.error('[AudioBridge] Opus stream error:', error));

        activeSpeakers.set(userId, {
            opusStream,
            decoder,
            bufferList,
            timer: scheduleInterruption({
                userId,
                config,
                speech,
                canInterrupt,
                isSpeakerActive: () => activeSpeakers.has(userId)
            }),
            metadata
        });
    };

    const handleSpeakingEnd = (userId) => {
        const speaker = activeSpeakers.get(userId);
        if (!speaker) return;
        if (speaker.timer?.cancel) speaker.timer.cancel();
        try { speaker.opusStream.destroy(); } catch { }
        activeSpeakers.delete(userId);

        if (config.transcriptionMode === 'batch') {
            if (onBatchAudio) {
                const buffer = speaker.bufferList.length ? Buffer.concat(speaker.bufferList) : null;
                onBatchAudio({ buffer, speaker: speaker.metadata });
            }
        } else if (transcription) {
            // When using VAD events, inject silence to help detect end of speech
            // When not using VAD, we still inject silence before committing
            if (config.silenceStreamEnabled) {
                injectSilence(transcription, config).then(() => {
                    if (!config.useVadEvents) {
                        flushTranscript(audioState, onTranscript);
                    }
                    // VAD events will trigger onComplete automatically after silence
                });
            } else if (!config.useVadEvents) {
                transcription.commit();
                flushTranscript(audioState, onTranscript);
            }
        }
    };

    connection.receiver.speaking.on('start', handleSpeakingStart);
    connection.receiver.speaking.on('end', handleSpeakingEnd);

    return () => {
        connection.receiver.speaking.off('start', handleSpeakingStart);
        connection.receiver.speaking.off('end', handleSpeakingEnd);
        for (const speaker of activeSpeakers.values()) {
            try { speaker.opusStream.destroy(); } catch { }
            if (speaker.timer?.cancel) speaker.timer.cancel();
        }
        activeSpeakers.clear();
    };
}

module.exports = {
    resolveMember,
    injectSilence,
    scheduleInterruption,
    flushTranscript,
    attachDiscordAudio
};
