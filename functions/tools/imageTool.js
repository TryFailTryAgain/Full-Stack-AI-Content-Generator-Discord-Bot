const imageFunctions = require('../image_functions.js');
const { filterCheckThenFilterString } = require('../helperFunctions.js');

// Openai sdk function call definition for generating images
const toolDef_generateImage =
{
    "type": "function",
    "name": "generate_image",
    "description": "Generate an image based on the provided image prompt.",
    "parameters": {
        "type": "object",
        "properties": {
            "prompt": {
                "type": "string",
                "description": "The input prompt to generate an image from. Should be detailed and descriptive."
            }
        },
        "required": [
            "prompt"
        ],
        "additionalProperties": false
    }
};

// Handles the function call from the LLM and processes the request using available image generation tools
async function generate_image_tool(functionCall, interaction) {
    try {
        const args = JSON.parse(functionCall.arguments); // Parse the JSON string
        const prompt = args.prompt; // Now you can access the prompt
        console.log("Generating image with prompt:", prompt);
        // Filter the prompt for profanity or banned words
        const filteredPrompt = await filterCheckThenFilterString(prompt);
        console.log("Filtered prompt:", filteredPrompt);
        // Generate the image using default settings from the environment variables
        const imageBuffer = await imageFunctions.generateImage({
            userInput: filteredPrompt,
            imageModel: process.env.VOICE_CHAT_IMAGE_MODEL,
            dimensions: 'square', // Default dimension
            userID: interaction.user.id,
            numberOfImages: 1
        });
        return imageBuffer; // Return the image buffer

    } catch (error) {
        console.error("Error generating image:", error);
        return null;
    }
}

module.exports = {
    toolDef_generateImage,
    generate_image_tool
};
