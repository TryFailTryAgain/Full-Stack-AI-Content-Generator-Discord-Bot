const OpenAI = require('openai');
const Filter = require('bad-words');

const openai = new OpenAI({ apiKey: process.env.API_KEY_OPENAI_CHAT });
const filter = new Filter();

// Add custom words to blocklist if provided
if (process.env.MODERATION_BAD_WORDS_CUSTOM_LIST) {
  const customWords = process.env.MODERATION_BAD_WORDS_CUSTOM_LIST
    .split(',')
    .map(word => word.trim())
    .filter(word => word.length > 0);
  
  if (customWords.length > 0) {
    filter.addWords(...customWords);
    console.log(`Bad-words filter: Added ${customWords.length} custom blocked word(s)`);
  }
}

// Remove words from blocklist (whitelist) if provided
if (process.env.MODERATION_BAD_WORDS_WHITELIST) {
  const whitelistWords = process.env.MODERATION_BAD_WORDS_WHITELIST
    .split(',')
    .map(word => word.trim())
    .filter(word => word.length > 0);
  
  if (whitelistWords.length > 0) {
    filter.removeWords(...whitelistWords);
    console.log(`Bad-words filter: Added ${whitelistWords.length} whitelisted word(s)`);
  }
}

/**
 * Moderates content using OpenAI's moderation API and bad-words filter.
 * Returns detailed results including flagged categories and cleaned text.
 * 
 * @param {Object} options - Moderation options
 * @param {string} [options.text] - Text content to moderate
 * @param {string|Buffer} [options.image] - Image content (URL or Buffer)
 * @returns {Promise<{flagged: boolean, flaggedCategories: string[], cleanedText: string}>}
 */
async function moderateContent({ text, image } = {}) {
  // Check moderation is enabled
  const moderationEnv = (process.env.MODERATION_OPENAI_MODERATION || 'false').trim().toLowerCase();
  const badWordsEnabled = (process.env.MODERATION_BAD_WORDS_FILTER || 'true').trim().toLowerCase() === 'true';
  
  if (moderationEnv !== 'true') {
    console.log('OpenAI moderation is disabled by environment variable.');
    // Still apply bad-words filter if enabled, even if OpenAI moderation is disabled
    const cleanedText = text && badWordsEnabled ? filter.clean(text) : text || '';
    return { flagged: false, flaggedCategories: [], cleanedText };
  }

  if (!openai.apiKey) {
    throw new Error('Missing OpenAI API key in environment');
  }

  // Prepare inputs dynamically
  const inputs = [];
  if (text) inputs.push(text);
  if (image) {
    if (typeof image === 'string') {
      // Assume it's a URL
      inputs.push(image);
    } else if (Buffer.isBuffer(image)) {
      // Convert buffer to base64
      const base64 = image.toString('base64');
      inputs.push(base64);
    } else {
      throw new Error('Image must be a URL string or a Buffer');
    }
  }

  if (inputs.length === 0) {
    throw new Error('No content provided for moderation');
  }

  // Call OpenAI Moderation API with omni model for full category support
  const response = await openai.moderations.create({
    model: 'omni-moderation-latest',
    input: inputs
  });
  const results = response.results;

  // Aggregate results from all inputs
  const flaggedCategories = new Set();

  for (const result of results) {
    // Check flagged categories
    if (result.categories) {
      for (const [category, isFlagged] of Object.entries(result.categories)) {
        if (isFlagged) {
          flaggedCategories.add(category);
        }
      }
    }
  }

  if (flaggedCategories.size > 0) {
    console.warn('Content FLAGGED by moderation. Flagged categories:', Array.from(flaggedCategories));
  } else {
    console.log('Content NOT flagged by moderation.');
  }

  // Apply bad-words filter as post-processor if enabled
  const cleanedText = text && badWordsEnabled ? filter.clean(text) : text || '';
  
  // Log if bad-words filter modified the text
  if (badWordsEnabled && text && cleanedText !== text) {
    console.log('Bad-words filter cleaned text content');
    console.log('Original:', text);
    console.log('Cleaned:', cleanedText);
  }

  return {
    flagged: flaggedCategories.size > 0,
    flaggedCategories: Array.from(flaggedCategories),
    cleanedText
  };
}

module.exports = { moderateContent };
