/*
* ttsStreamer.js
* TTS audio streaming to Discord - supports multiple providers
* 
* Provider selection via VOICE_CHAT_TTS_PROVIDER environment variable:
* - 'openai' (default): Uses OpenAI's TTS API
* - 'qwen3tts' / 'qwen3' / 'qwen': Uses Qwen3-TTS via Replicate
*/
const { playbackState } = require('./voiceGlobalState.js');
const { getProvider, getAvailableProviders, DEFAULT_PROVIDER } = require('./tts_providers/index.js');

// Cache the current provider to avoid repeated lookups
let cachedProvider = null;
let cachedProviderName = null;

/**
 * Get the configured TTS provider
 * @param {string} [providerOverride] - Optional provider name to use instead of env var
 * @returns {Object} Provider module
 */
function getCurrentProvider(providerOverride) {
    const requestedProvider = providerOverride || process.env.VOICE_CHAT_TTS_PROVIDER || DEFAULT_PROVIDER;
    
    // Return cached provider if it matches
    if (cachedProvider && cachedProviderName === requestedProvider) {
        return cachedProvider;
    }
    
    cachedProviderName = requestedProvider;
    cachedProvider = getProvider(requestedProvider);
    
    console.log(`[TTS] Using provider: ${cachedProvider.name}`);
    return cachedProvider;
}

/**
 * Synthesizes text to speech and plays it through Discord voice connection
 * Uses the provider configured via VOICE_CHAT_TTS_PROVIDER env var
 * 
 * @param {string} text - Text to synthesize
 * @param {Object} connection - Discord voice connection
 * @param {Object} options - TTS options (provider-specific)
 * @param {string} [options.voice] - Voice to use (OpenAI)
 * @param {boolean} [options.noInterruptions] - Prevent interrupting current playback
 * @param {string} [options.voiceDetails] - Voice instructions (OpenAI)
 * @param {string} [options.provider] - Override the default provider for this call
 * @param {string} [options.speaker] - Preset speaker (Qwen3-TTS custom_voice mode)
 * @param {string} [options.styleInstruction] - Style instruction (Qwen3-TTS)
 * @returns {Promise<void>}
 */
async function synthesizeAndPlay(text, connection, options = {}) {
    if (!text || !text.trim()) return;
    
    const provider = getCurrentProvider(options.provider);
    return provider.synthesizeAndPlay(text, connection, options);
}

function stopActivePlayback(reason = 'manual-stop') {
    if (playbackState.player) {
        try {
            console.log(`[TTS] Stopping playback: ${reason}`);
            playbackState.player.stop();
        } catch (err) {
            console.error('[TTS] Failed to stop playback:', err);
        }
    }
    playbackState.isPlaying = false;
    playbackState.player = null;
}

function isPlaybackActive() {
    return Boolean(playbackState.isPlaying);
}

/**
 * Reset the cached provider (useful when env vars change)
 */
function resetProviderCache() {
    cachedProvider = null;
    cachedProviderName = null;
}

/**
 * Get list of available TTS providers
 * @returns {string[]}
 */
function listProviders() {
    return getAvailableProviders();
}

module.exports = { 
    synthesizeAndPlay, 
    stopActivePlayback, 
    isPlaybackActive,
    resetProviderCache,
    listProviders,
    getCurrentProvider
};
