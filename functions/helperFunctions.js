const ini = require('ini');
const fs = require('fs');
const Crypto = require('crypto');
const sharp = require('sharp'); // Add sharp if not already imported

// Helper function to read and parse ini files
function getIniFileContent(filePath) {
    return ini.parse(fs.readFileSync(filePath, 'utf-8'));
}

async function generateHashedUserId(userId) {
    // Generate the hash
    const salt = process.env.ADVCONF_SALT;
    const userIdStr = typeof userId === 'string' ? userId : String(userId);
    const saltStr = typeof salt === 'string' ? salt : String(salt);

    const hash = Crypto.pbkdf2Sync(userIdStr, saltStr, 1000, 64, 'sha512');

    // Convert the hash to a hexadecimal string
    const hashedUserId = hash.toString('hex');
    //console.log("Hashed user ID: " + hashedUserId);
    return hashedUserId;
}

// Deletes the original reply and follows up with a new ephemeral one. Mostly used for error handling
async function deleteAndFollowUpEphemeral(interaction, message) {
    await interaction.deleteReply();
    await interaction.followUp({
        content: message,
        ephemeral: true
    });
}

// Follows up with a new ephemeral message. Mostly used for error handling
async function followUpEphemeral(interaction, message) {
    await interaction.followUp({
        content: message,
        ephemeral: true
    });
}

function generateRandomHex() {
    return Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(8, '0');
}

async function checkThenSave_ReturnSendImage(saveBuffer) {
    if (await saveToDiskCheck()) {
        fs.writeFileSync(
            `./Outputs/txt2img_${generateRandomHex()}.${process.env.ADVCONF_SAVE_IMAGES_AS}`,
            saveBuffer
        );
    }
    if (process.env.ADVCONF_SAVE_IMAGES_AS === process.env.ADVCONF_SEND_IMAGES_AS) {
        return saveBuffer;
    } else {
        const sendBuffer = await sharp(saveBuffer)[process.env.ADVCONF_SEND_IMAGES_AS]({
            quality: parseInt(process.env.ADVCONF_JPEG_QUALITY),
        }).toBuffer();
        return sendBuffer;
    }
}

// Ensure saveToDiskCheck is defined or imported
async function saveToDiskCheck() {
    const saveImages = process.env.ADVCONF_SAVE_IMAGES.toLowerCase();
    if (saveImages === 'true') {
        return true;
    } else if (saveImages === 'false') {
        return false;
    } else {
        throw new Error("The Save_Images setting in settings.ini is not set to true or false. Please set it to true or false");
    }
}

/* Helper functions to collect user input */
async function collectUserInput(interaction, promptMessage) {
    await interaction.followUp({ content: promptMessage, ephemeral: true });
    const filter = m => m.author.id === interaction.user.id;
    const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000 });
    if (collected.size === 0) {
        await interaction.followUp({ content: 'Timed out waiting for user input.', ephemeral: true });
        throw new Error('Timed out waiting for user input.');
    }
    return collected.first().content;
}

async function collectImageAndPrompt(interaction, promptMessage) {
    await interaction.followUp({ content: promptMessage, ephemeral: true });
    const filter = m => m.author.id === interaction.user.id && (m.attachments.size > 0 || m.content.length > 0);
    const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000 });
    if (collected.size === 0) {
        await interaction.followUp({ content: 'Timed out waiting for user input.', ephemeral: true });
        throw new Error('Timed out waiting for user input.');
    }
    const message = collected.first();
    const imageURL = message.attachments.first()?.url;
    const content = message.content;
    return { imageURL, prompt: content };
}

async function collectImage(interaction, promptMessage) {
    await interaction.followUp({ content: promptMessage, ephemeral: true });
    const filter = m => m.author.id === interaction.user.id && m.attachments.size > 0;
    const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000 });
    if (collected.size === 0) {
        await interaction.followUp({ content: 'Timed out waiting for image upload. Please re-run the command and try again.', ephemeral: true });
        throw new Error('Timed out waiting for image upload.');
    }
    const imageURL = collected.first().attachments.first().url;
    return imageURL;
}

// Collect multiple images and a prompt from a single Discord message
async function collectImagesAndPrompt(interaction, promptMessage, maxImages = 4) {
    await interaction.followUp({ content: promptMessage, ephemeral: true });
    const filter = m => m.author.id === interaction.user.id && (m.attachments.size > 0 || m.content.length > 0);
    const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 120000 });
    if (collected.size === 0) {
        await interaction.followUp({ content: 'Timed out waiting for user input.', ephemeral: true });
        throw new Error('Timed out waiting for user input.');
    }
    const message = collected.first();
    // Collect all image URLs from attachments (up to maxImages)
    const imageURLs = [];
    message.attachments.forEach(attachment => {
        if (imageURLs.length < maxImages && attachment.contentType?.startsWith('image/')) {
            imageURLs.push(attachment.url);
        }
    });
    const content = message.content;
    return { imageURLs, prompt: content };
}

// Collect multiple images from a single Discord message
async function collectImages(interaction, promptMessage, maxImages = 4) {
    await interaction.followUp({ content: promptMessage, ephemeral: true });
    const filter = m => m.author.id === interaction.user.id && m.attachments.size > 0;
    const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 120000 });
    if (collected.size === 0) {
        await interaction.followUp({ content: 'Timed out waiting for image upload. Please re-run the command and try again.', ephemeral: true });
        throw new Error('Timed out waiting for image upload.');
    }
    const message = collected.first();
    // Collect all image URLs from attachments (up to maxImages)
    const imageURLs = [];
    message.attachments.forEach(attachment => {
        if (imageURLs.length < maxImages && attachment.contentType?.startsWith('image/')) {
            imageURLs.push(attachment.url);
        }
    });
    if (imageURLs.length === 0) {
        await interaction.followUp({ content: 'No valid images found. Please upload image files.', ephemeral: true });
        throw new Error('No valid images found.');
    }
    return imageURLs;
}

async function sendImages(interaction, images) {
    for (const image of images) {
        await interaction.followUp({ files: [image] });
    }

}

module.exports = {
    generateHashedUserId,
    getIniFileContent,
    deleteAndFollowUpEphemeral,
    followUpEphemeral,
    generateRandomHex,
    checkThenSave_ReturnSendImage,
    saveToDiskCheck,
    collectUserInput,
    collectImageAndPrompt,
    collectImage,
    collectImagesAndPrompt,
    collectImages,
    sendImages,
};