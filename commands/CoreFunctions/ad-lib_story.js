// File: ad-lib_story.js
// Author: TryFailTryAgain
// Copyright (c) 2023. All rights reserved. For use in Open-Source projects this
// may be freely copied or excerpted with credit to the author.

/* Requirements & Setup */
const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, Events, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const ini = require('ini');
const OpenAI = require('openai');
const Filter = require('bad-words');
const filter = new Filter({ placeHolder: '*' });

//parse the api_keys.ini file to get the API key provided
const apiKeys = ini.parse(fs.readFileSync('./api_keys.ini', 'utf-8'));
// Parse the settings.ini file to get the values
const config = ini.parse(fs.readFileSync('./settings.ini', 'utf-8'));

const openAIKey = apiKeys.Keys.OpenAIChat;
if (openAIKey == "") {
    throw new Error("The OpenAI API key is not set. Please set it in the api_keys.ini file");
}
const openai = new OpenAI({ apiKey: openAIKey });
// Get base URL for the API
const openaiChatBaseURL = config.Advanced.OpenAI_Chat_Base_URL;
openai.baseURL = openaiChatBaseURL;


// This is a profanity filter that will prevent the bot from passing profanity and other rude words to the generator
// It can be enabled or disabled in the config.json file
if (filterCheck()) {
    console.log("Profanity filter -- /ad-lib-story == ENABLED");
} else {
    console.log("Profanity filter -- /ad-lib-story == DISABLED");
}

/* End Requirements & Setup */


/* Main Discord.js Function */
// This is the main setup and handling of the call to the discord bot command.
// It generates a Madlibs style story with formatting and placeholders for nouns, verbs, adjectives, and adverbs
// then asks the user for the words to fill in the placeholders
// then replaces the placeholders with the user provided words and sends the story back to the user. 
module.exports = {
    cooldown: 1,
    data: new SlashCommandBuilder()
        .setName('ad-lib-story')
        .setDescription('Replies with a Madlibs inspired about the given a idea!')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('A request for the story generation')
                .setRequired(false)),

    async execute(interaction, client) {
        // Responds to the command to prevent discord timeout and this will display that the bot is thinking
        // Editing with .editReply will remove the loading message and replace it with the new message
        await interaction.deferReply(); //Can not defer reply with a modal. Modal must come first

        // Grabs the prompt if provided by the user and filter it if required
        let userInput = interaction.options.getString('prompt');
        // If there is a prompt then check for filtering and do it acordingly
        if (userInput) {
            // Optionally filters the prompt if settings.ini - Filter_Naughty_Words is set to true
            if (await filterCheck()) {
                try {
                    userInput = await filterString(userInput);
                } catch (error) {
                    console.error(error);
                    await interaction.deleteReply();
                    await interaction.followUp({
                        content: "An error occurred while filtering the prompt. Please try again",
                        ephemeral: true
                    });
                    return;
                }
            }
        } else {
            console.log("No prompt was provided by the user");
        }

        // Generates the story with the prompt if provided and requests the placeholders count
        //const story = 'The [NOUN] [VERB] [ADVERB] over the [ADJECTIVE] [NOUN].'; // Uncomment for debugging to bypass the API call and comment line below
        const story = await generateStory(userInput);
        // requests the placeholder word count for the newly generated story
        const requestedPlaceholders = await placeholderCount(story);


        /* Button Building */
        // Creates a new button
        const requestWordsButton = new ButtonBuilder()
            .setCustomId('showModalButton')
            .setLabel('Word Input')
            .setStyle(ButtonStyle.Primary);

        // Creates a new action row that will hold the button
        const actionRowWButton = new ActionRowBuilder()
            .addComponents(requestWordsButton);
        /* End Button Building */


        // Sends the initial reply message
        await interaction.editReply({ content: 'Story generated! Please input your custom words using the form button below and I will compile everything together for you.', components: [actionRowWButton] });


        /* Modal Building */
        // Creates the text input components
        const Nouns = new TextInputBuilder()
            .setCustomId('userNouns')
            .setLabel("Enter " + requestedPlaceholders['[NOUN]'] + " nouns separated by a space")
            .setMaxLength(1500)
            .setStyle(TextInputStyle.Short);

        const Verbs = new TextInputBuilder()
            .setCustomId('userVerbs')
            .setLabel("Enter " + requestedPlaceholders['[VERB]'] + " verbs separated by a space")
            .setMaxLength(1500)
            .setStyle(TextInputStyle.Short);

        const Adjectives = new TextInputBuilder()
            .setCustomId('userAdjectives')
            .setLabel("Enter " + requestedPlaceholders['[ADJECTIVE]'] + " adjectives separated by a space")
            .setMaxLength(1500)
            .setStyle(TextInputStyle.Short);

        const Adverbs = new TextInputBuilder()
            .setCustomId('userAdverbs')
            .setLabel("Enter " + requestedPlaceholders['[ADVERB]'] + " adverbs separated by a space")
            .setMaxLength(1500)
            .setStyle(TextInputStyle.Short);

        const modal = new ModalBuilder()
            .setCustomId(`adlibModal-${interaction.user.id}`)
            .setTitle("Word Bank")


        // An action row only holds one text input component so we need to create 4 action rows to hold all of the inputs
        const firstActionRow = new ActionRowBuilder().addComponents(Nouns);
        const secondActionRow = new ActionRowBuilder().addComponents(Verbs);
        const thirdActionRow = new ActionRowBuilder().addComponents(Adjectives);
        const fourthActionRow = new ActionRowBuilder().addComponents(Adverbs);

        // Adds inputs to the modal
        modal.addComponents(firstActionRow, secondActionRow, thirdActionRow, fourthActionRow);
        /* End Modal Building */



        /* Button Handling */
        // Detect when the button is clicked
        const ButtonFilter = (interaction) => interaction.customId === 'showModalButton';
        const collector = interaction.channel.createMessageComponentCollector({ ButtonFilter, time: 60_000 });

        // Displays the modal to the user on button click
        collector.on('collect', async (interaction) => {
            await interaction.showModal(modal);
            //requestWordsButton.setDisabled(true); // Disables the button so it can't be clicked again
        });
        /* End Button Handling */

        // Holds the user input data for each set of words
        let userNouns, userVerbs, userAdjectives, userAdverbs;


        /* Modal Handling */
        client.on(Events.InteractionCreate, async interaction => {
            if (!interaction.isModalSubmit()) return;
            // Gets the data entered by the user
            userNouns = interaction.fields.getTextInputValue('userNouns');
            userVerbs = interaction.fields.getTextInputValue('userVerbs');
            userAdjectives = interaction.fields.getTextInputValue('userAdjectives');
            userAdverbs = interaction.fields.getTextInputValue('userAdverbs');
            // Filters the user input if inputFilter is set to true in the settings.ini file
            if (filterCheck()) {
                console.log("Filtering submitted words...");
                userNouns = await filterString(userNouns);
                userVerbs = await filterString(userVerbs);
                userAdjectives = await filterString(userAdjectives);
                userAdverbs = await filterString(userAdverbs);
                console.log("The user inputted words after filtering are: \n" + '[NOUNS] : ' + userNouns + '\n' + '[VERBS] : ' + userVerbs + '\n' + '[ADJECTIVES] : ' + userAdjectives + '\n' + '[ADVERBS] : ' + userAdverbs + '\n');
            } else {
                console.log("The user inputted words without filtering are: \n" + '[NOUNS] : ' + userNouns + '\n' + '[VERBS] : ' + userVerbs + '\n' + '[ADJECTIVES] : ' + userAdjectives + '\n' + '[ADVERBS] : ' + userAdverbs + '\n');
            }
            // Replaces the placeholders in the story with the user input
            const userFilledStory = await replacePlaceholders(story, userNouns, userVerbs, userAdjectives, userAdverbs);
            // Sends the resulting story back to the user
            await interaction.reply({
                content: 'Congrats! Your ad-Lib story is as follows: \n' + userFilledStory
            });
        });
        /* End Modal Handling */
    }
};


// Generates the story with the prompt if provided and requests the placeholders count
async function generateStory(userInput) {
    console.log("Generating story...");
    try {
        // Calls the OpenAI API to generate a story based on the prompt provided
        const story = await openai.chat.completions.create({
            model: config.Ad_lib_story_settings.Prompt_Model,
            messages: [
                // Provides instructions to the AI on how to generate the story
                { role: "system", content: "You are a Madlibs style story writer who will always respond with a short story in its correct formatting by using [NOUN], [VERB], [ADVERB], [ADJECTIVE] to replace some words and nothing else. Your task is to generate a MadLibs style short story that has occasional placeholders where nouns, verbs, adjectives, and adverbs would be that are formatted as [NOUN], [VERB], [ADVERB], [ADJECTIVE]. Only replace some of the words with their appropriate placeholder so that when filled in with a user provided word it could make for a humorous story. You may or may not be provided with a user provided prompt that you should use to define the general direction of the story, if no prompt is provided when told what it is, you are free to write as you please." },
                // Includes the user provided prompt in the message to the AI
                { role: "user", content: "The following may be an idea/concept or request that the user has provided that should give you direction in the generation of a Madlibs style story that uses [NOUN], [VERB], [ADVERB], [ADJECTIVE] to replace some of their respective words. Do with it what you think is best. Thank you. User prompt: " + userInput }
            ],
            stream: false,
            max_tokens: 300,
        });
        console.log("The story is: ");
        console.log(story.choices[0].message.content);
        // Filter the story if enabled just in case the AI is having a bad day.
        // Return the stroy
        if (filterCheck()) {
            try {
                return await filterString(story.choices[0].message.content);
            } catch (error) {
                // Throws another error to be caught when the function is called
                throw new Error(`Error: ${error}`);
            }
        }
        else {
            return story.choices[0].message.content;
        }
    } catch (error) {
        // Handle any errors that occur during the story generation
        if (error instanceof OpenAI.APIError) {
            console.error(error.status);  // e.g. 401
            console.error(error.message); // e.g. The authentication token you passed was invalid...
            console.error(error.code);  // e.g. 'invalid_api_key'
            console.error(error.type);  // e.g. 'invalid_request_error'
        } else {
            // Non-API error
            console.log(error);
        }
        // Return an error message if the story generation fails
        return "An error occurred while generating the story. Please try again later.";
    }
}

// Replaces the placeholders in the story with the user provided words
function replacePlaceholders(story, userNouns, userVerbs, userAdjectives, userAdverbs) {
    // Creates an object with the user provided words for each type of placeholder and wraps them in bold markdown
    const replacements = {
        'NOUN': userNouns.split(' ').map(word => `**${word}**`),
        'VERB': userVerbs.split(' ').map(word => `**${word}**`),
        'ADJECTIVE': userAdjectives.split(' ').map(word => `**${word}**`),
        'ADVERB': userAdverbs.split(' ').map(word => `**${word}**`)
    };

    let modifiedStory = story;

    // Loops through each type of placeholder and replace it with the corresponding user provided word
    for (const placeholder in replacements) {
        const words = replacements[placeholder];
        const regex = new RegExp(`\\[${placeholder}\\]`, 'g');
        let i = 0;
        modifiedStory = modifiedStory.replace(regex, () => {
            const word = words[i];
            i = (i + 1) % words.length;
            return word;
        });
    }

    // Logs the modified story to the console and return it
    console.log("The story after replacing the placeholders is:\n" + modifiedStory + "\n");
    return modifiedStory;
}

// Counts the number of placeholders in the story and returns the count for each type as an object
async function placeholderCount(story) {
    const placeholders = ['\\[NOUN\\]', '\\[VERB\\]', '\\[ADJECTIVE\\]', '\\[ADVERB\\]'];
    let counts = { '[NOUN]': 0, '[VERB]': 0, '[ADJECTIVE]': 0, '[ADVERB]': 0 };
    placeholders.forEach(placeholder => {
        const regex = new RegExp(placeholder, 'g');
        const matches = story.match(regex);
        if (matches) {
            counts[placeholder.replace(/\\/g, '')] = matches.length;
        }
    });
    return counts;
}

async function filterCheck() {
    const inputFilter = config.Advanced.Filter_Naughty_Words;
    // Alert console if the profanity filter is enabled or disabled
    if (inputFilter == 'true' || inputFilter == 'True' || inputFilter == 'TRUE') {
        return true;

    } else if (inputFilter == 'false' || inputFilter == 'False' || inputFilter == 'FALSE') {
        return false;
    } else {
        throw new Error("The Filter_Naughty_Words setting in settings.ini is not set to true or false. Please set it to true or false");
    }
}

async function filterString(input) {
    try {
        console.log("Filtering string...\n String: " + input);
        input = (filter.clean(input)).toString();
        // Removes the asterisks that the filter replaces the bad words with. Somehow this is not built into the filter to my knowledge
        input = input.replace(/\*/g, '');
        console.log("The string after filtering is:\n" + input);
    } catch (error) {
        console.error(error);
        // Throws another error to be caught when the function is called
        throw new Error(`Error: ${error}`);
    }
    return input;
}
