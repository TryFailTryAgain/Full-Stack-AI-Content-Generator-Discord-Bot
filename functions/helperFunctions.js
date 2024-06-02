const ini = require('ini');
const fs = require('fs');
const Filter = require('bad-words');
const filter = new Filter({ placeHolder: '*' }); // Modify the character used to replace bad words
const Crypto = require('crypto');

// File paths
const SETTINGS_FILE_PATH = './settings.ini';
const API_KEYS_FILE_PATH = './api_keys.ini';

/* Acquiring Global values */
const config = getIniFileContent(SETTINGS_FILE_PATH);
const apiKeys = getIniFileContent(API_KEYS_FILE_PATH);

// Function to check if the profanity filter is enabled or disabled from the settings.ini file
async function filterCheck() {
    const inputFilter = config.Advanced.Filter_Naughty_Words.toLowerCase();

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

// Function to generate a hashed user ID to send to openai instead of the original user ID
// This is to protect the users privacy and to help incase of policy violations with OpenAI
// TODO: Add a setting to disable this in the settings config file
async function generateHashedUserId(userId) {
    // Get the salt from settings.ini
    const salt = config.Advanced.Salt;
    // Generate the hash
    const hash = Crypto.pbkdf2Sync(userId, salt, 1000, 64, 'sha512');

    // Convert the hash to a hexadecimal string
    const hashedUserId = hash.toString('hex');
    //console.log("Hashed user ID: " + hashedUserId);
    return hashedUserId;
}

// Helper function to read and parse ini files
function getIniFileContent(filePath) {
    return ini.parse(fs.readFileSync(filePath, 'utf-8'));
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

module.exports = {
    filterCheck,
    filterString,
    filterCheckThenFilterString,
    generateHashedUserId,
    getIniFileContent,
    deleteAndFollowUpEphemeral,
    followUpEphemeral,
};