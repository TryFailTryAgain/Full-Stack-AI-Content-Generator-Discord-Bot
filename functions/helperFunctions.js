const ini = require('ini');
const fs = require('fs');
const Filter = require('bad-words');
const filter = new Filter({ placeHolder: '*' }); // Modify the character used to replace bad words
const Crypto = require('crypto');
const sharp = require('sharp'); // Add sharp if not already imported

// Helper function to read and parse ini files
function getIniFileContent(filePath) {
    return ini.parse(fs.readFileSync(filePath, 'utf-8'));
}

async function filterCheck() {
    const inputFilter = process.env.ADVCONF_FILTER_NAUGHTY_WORDS.toLowerCase();

    // Alert console if the profanity filter is enabled or disabled
    if (inputFilter === 'true') {
        return true;
    } else if (inputFilter === 'false') {
        return false;
    } else {
        throw new Error("The Filter_Naughty_Words setting in settings.ini is not set to true or false. Please set it to true or false");
    }
}

// Function to filter the prompt for profanity and other words provided in node_modules/bad-words/lib/lang.json file
// TODO: Add a section to add custom words to the filter in the settings config that will be imported here
async function filterString(input) {
    try {
        console.log("--Filtering string--\n");
        input = (filter.clean(input)).toString();
        // Removes the asterisks that the filter replaces the bad words with. Somehow this is not built into the filter to my knowledge
        input = input.replace(/\*/g, '');
        console.log("-The string after filtering is:\n" + input + "\n");
    } catch (error) {
        console.error(error);
        // Throws another error to be caught when the function is called
        throw new Error(`Error: ${error}`);
    }
    return input;
}

async function filterCheckThenFilterString(input) {
    try {
        const isFilterEnabled = await filterCheck();
        if (isFilterEnabled) {
            input = await filterString(input);
        }
    } catch (error) {
        console.error(error);
        throw new Error(`Error: ${error}`);
    }
    return input;
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

async function sendImages(interaction, images) {
    for (const image of images) {
        await interaction.followUp({ files: [image] });
    }

}

module.exports = {
    filterCheck,
    filterString,
    filterCheckThenFilterString,
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
    sendImages,
};