/*
* tts_providers/index.js
* TTS Provider Registry - manages different TTS backends
* 
* Add new providers by:
* 1. Creating a new file in this folder with synthesizeAndPlay export
* 2. Importing and registering it here
*/

const openaiProvider = require('./openai.js');
const qwen3ttsProvider = require('./qwen3tts.js');

// Registry of available TTS providers
const providers = {
    openai: openaiProvider,
    qwen3tts: qwen3ttsProvider,
    // Aliases for convenience
    qwen3: qwen3ttsProvider,
    qwen: qwen3ttsProvider
};

// Default provider
const DEFAULT_PROVIDER = 'openai';

/**
 * Get a TTS provider by name
 * @param {string} providerName - Name of the provider (e.g., 'openai', 'qwen3tts')
 * @returns {Object} Provider module with synthesizeAndPlay function
 */
function getProvider(providerName) {
    const name = (providerName || DEFAULT_PROVIDER).toLowerCase().trim();
    const provider = providers[name];
    
    if (!provider) {
        console.warn(`[TTS] Unknown provider "${providerName}", falling back to ${DEFAULT_PROVIDER}`);
        return providers[DEFAULT_PROVIDER];
    }
    
    return provider;
}

/**
 * Get list of available provider names
 * @returns {string[]} Array of provider names
 */
function getAvailableProviders() {
    return Object.keys(providers).filter(key => 
        !['qwen3', 'qwen'].includes(key) // Exclude aliases from list
    );
}

/**
 * Check if a provider exists
 * @param {string} providerName - Name of the provider
 * @returns {boolean}
 */
function hasProvider(providerName) {
    return Boolean(providers[(providerName || '').toLowerCase().trim()]);
}

module.exports = {
    getProvider,
    getAvailableProviders,
    hasProvider,
    DEFAULT_PROVIDER,
    providers
};
