// Per-suite setup file. Runs before each test suite.
// Provides global test utilities and timing infrastructure.

const path = require('path');

// Load environment before tests
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.defaults') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local'), override: true });

// Ensure minimal env vars are present (same as globalSetup but for in-process)
const defaults = {
  API_KEY_OPENAI_CHAT: process.env.API_KEY_OPENAI_CHAT || 'test-key-chat',
  API_KEY_OPENAI_IMAGE: process.env.API_KEY_OPENAI_IMAGE || 'test-key-image',
  API_KEY_REPLICATE: process.env.API_KEY_REPLICATE || 'test-key-replicate',
  API_KEY_STABILITYAI: process.env.API_KEY_STABILITYAI || 'test-key-stability',
  ADVCONF_OPENAI_CHAT_BASE_URL: process.env.ADVCONF_OPENAI_CHAT_BASE_URL || 'https://api.openai.com/v1',
  ADVCONF_OPENAI_IMAGE_BASE_URL: process.env.ADVCONF_OPENAI_IMAGE_BASE_URL || 'https://api.openai.com/v1',
  ADVCONF_SAVE_IMAGES: process.env.ADVCONF_SAVE_IMAGES || 'false',
  ADVCONF_SAVE_IMAGES_AS: process.env.ADVCONF_SAVE_IMAGES_AS || 'png',
  ADVCONF_SEND_IMAGES_AS: process.env.ADVCONF_SEND_IMAGES_AS || 'jpeg',
  ADVCONF_JPEG_QUALITY: process.env.ADVCONF_JPEG_QUALITY || '100',
  ADVCONF_SALT: process.env.ADVCONF_SALT || 'test-salt-for-hashing',
  MODERATION_OPENAI_MODERATION: process.env.MODERATION_OPENAI_MODERATION || 'false',
  MODERATION_BAD_WORDS_FILTER: process.env.MODERATION_BAD_WORDS_FILTER || 'true',
  MODERATION_BAD_WORDS_CUSTOM_LIST: process.env.MODERATION_BAD_WORDS_CUSTOM_LIST || '',
  MODERATION_BAD_WORDS_WHITELIST: process.env.MODERATION_BAD_WORDS_WHITELIST || '',
  IMAGE_MODEL: process.env.IMAGE_MODEL || 'black-forest-labs/flux-2-dev',
  IMAGE_PROMPT_MODEL: process.env.IMAGE_PROMPT_MODEL || 'gpt-5-nano',
  IMAGE_OPTIMIZER_TEMPERATURE: process.env.IMAGE_OPTIMIZER_TEMPERATURE || '1.0',
  IMAGE_SYSTEM_MESSAGE: process.env.IMAGE_SYSTEM_MESSAGE || 'You are a prompt optimizer.',
  IMAGE_USER_MESSAGE: process.env.IMAGE_USER_MESSAGE || 'Optimize this: ',
  IMAGE_CHAT_REFINEMENT_SYSTEM_MESSAGE: process.env.IMAGE_CHAT_REFINEMENT_SYSTEM_MESSAGE || 'You refine prompts.',
  IMAGE_CHAT_REFINEMENT_USER_MESSAGE: process.env.IMAGE_CHAT_REFINEMENT_USER_MESSAGE || 'Refine [originalPrompt] with [refinementRequest]',
  CHAT_API_BACKEND: process.env.CHAT_API_BACKEND || 'completions',
  CHAT_MODEL: process.env.CHAT_MODEL || 'gpt-5-nano',
  CHAT_TEMPERATURE: process.env.CHAT_TEMPERATURE || '',
  CHAT_MAX_TOKENS: process.env.CHAT_MAX_TOKENS || '500',
  CHAT_REASONING_EFFORT: process.env.CHAT_REASONING_EFFORT || '',
  CHAT_SYSTEM_MESSAGE: process.env.CHAT_SYSTEM_MESSAGE || 'You are a helpful chatbot.',
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
