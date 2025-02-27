const Replicate = require('replicate');
const sharp = require('sharp');
const { apiKeys } = { Keys: { Replicate: process.env.API_KEY_REPLICATE } };
const { checkThenSave_ReturnSendImage } = require('../helperFunctions.js');

async function generateImageViaReplicate_Juggernaut({ userInput, negativePrompt, imageModel, trueDimensions, numberOfImages, steps, disable_safety_checker }) {
    const replicate = new Replicate({
        auth: apiKeys.Keys.Replicate,
    });

    console.log('\n---Generating image via Replicate Juggernaut XL v9---');
    console.log('-User Input:', userInput);
    console.log('-Negative Prompt:', negativePrompt);
    console.log('-Image Model:', imageModel);
    console.log('-True Dimensions:', trueDimensions);
    console.log('-Number of Images:', numberOfImages);

    try {
        const prediction = await replicate.run(
            imageModel,
            {
                input: {
                    prompt: userInput,
                    negative_prompt: negativePrompt !== undefined ? negativePrompt : 'Ugly, Bad, Poorly made, Low quality, Low resolution,',
                    steps: steps,
                    width: parseInt(trueDimensions.split('x')[0]),
                    height: parseInt(trueDimensions.split('x')[1]),
                    scheduler: "DPM++SDE",
                    num_outputs: parseInt(numberOfImages),
                    guidance_scale: 2,
                    apply_watermark: true,
                    num_inference_steps: 7,
                    disable_safety_checker: disable_safety_checker
                }
            }
        );

        let imageBuffer = [];
        for (let i = 0; i < prediction.length; i++) {
            const imageUrl = prediction[i];
            const response = await fetch(imageUrl);
            const arrayBuffer = await response.arrayBuffer();
            const saveBuffer = await sharp(Buffer.from(arrayBuffer))[process.env.ADVCONF_SAVE_IMAGES_AS]({ quality: parseInt(process.env.ADVCONF_JPEG_QUALITY) }).toBuffer();

            const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);
            imageBuffer.push(processedBuffer);
        }
        console.log('Image Generated!');
        return imageBuffer;

    } catch (error) {
        console.error('Error generating image with Replicate:', error);
        throw error;
    }
}

module.exports = { generateImageViaReplicate_Juggernaut };
