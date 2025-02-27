const Replicate = require('replicate');
const sharp = require('sharp');
const apiKeys = { Keys: { Replicate: process.env.API_KEY_REPLICATE } };
const { checkThenSave_ReturnSendImage } = require('../helperFunctions.js');

// Documentation
// https://replicate.com/nightmareai/real-esrgan
async function upscaleImageViaReplicate_esrgan({ imageBuffer, scaleFactor = 2, face_enhance = false }) {
    const replicate = new Replicate({
        auth: apiKeys.Keys.Replicate,
    });

    console.log('\n---Upscaling image via Replicate ESRGAN---');
    console.log('Scaling factor: ', scaleFactor);
    console.log('Face enhance: ', face_enhance);

    try {
        // Convert image buffer to a data URI
        const imageDataUri = `data:image/png;base64,${(await sharp(imageBuffer).png().toBuffer()).toString('base64')}`;

        const input = {
            image: imageDataUri,
            scale: scaleFactor, // Adjust up to 10x
            face_enhance: face_enhance,
        };

        const prediction = await replicate.run('nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa', { input });
        const imageUrl = prediction;
        const response = await fetch(imageUrl);
        const arrayBuffer = await response.arrayBuffer();
        const saveBuffer = await sharp(Buffer.from(arrayBuffer))[process.env.ADVCONF_SAVE_IMAGES_AS]({ quality: parseInt(process.env.ADVCONF_JPEG_QUALITY) }).toBuffer();

        const processedBuffer = await checkThenSave_ReturnSendImage(saveBuffer);
        console.log('Image Upscaled!');
        return processedBuffer;

    } catch (error) {
        console.error('Error upscaling image with Replicate ESRGAN:', error);
        throw error;
    }
}


module.exports = { upscaleImageViaReplicate_esrgan };
