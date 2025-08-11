const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.API_KEY_OPENAI_CHAT });

async function moderateContent({ text, image } = {}) {
  // Check moderation is enabled
  const moderationEnv = (process.env.MODERATION_OPENAI_MODERATION).trim().toLowerCase();
  if (moderationEnv !== 'true') {
    console.log('OpenAI moderation is disabled by environment variable.');
    return false; // Pass content if moderation is disabled
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

  // Call OpenAI Moderation API
  const response = await openai.moderations.create({ input: inputs });
  const results = response.results;
  // Check for any flagged result
  for (const result of results) {
    if (result.flagged) {
      console.warn('Content FLAGGED by moderation:');
      return true; // Content is flagged
    }
  }
  // If no flags found
  console.log('Content NOT flagged by moderation.');
  return false;
}

module.exports = { moderateContent };
