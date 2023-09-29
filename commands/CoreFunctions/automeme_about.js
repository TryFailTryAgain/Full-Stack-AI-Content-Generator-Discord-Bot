// File: automeme_about.js
// Author: TryFailTryAgain
// Copyright (c) 2023. All rights reserved. For use in Open-Source projects this
// may be freely copied or excerpted with credit to the author.

const { SlashCommandBuilder } = require('discord.js');
const { spawn } = require('child_process');
const fs = require('fs');
const ini = require('ini');
const Filter = require('bad-words');
const filter = new Filter({ placeHolder: '*' });

// Parse the settings.ini file to get the values
const config = ini.parse(fs.readFileSync('./settings.ini', 'utf-8'));

// This is a profanity filter that will prevent the bot from passing profanity and other rude words to the generator
// It can be enabled or disabled in the config.json file
if (filterCheck()) {
    console.log("Profanity filter -- /automeme_about == ENABLED");
} else {
    console.log("Profanity filter -- /automeme_about == DISABLED");
}

module.exports = {
    cooldown: 1,
    data: new SlashCommandBuilder()
        .setName('automeme_about')
        .setDescription('Replies with a meme about the given a idea!')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('The prompt/idea for the meme')
                .setRequired(true)),
    async execute(interaction) {
        // Responds to the command to prevent discord timeout and this will display that the bot is thinking
        // Editing with .editReply will remove the loading message and replace it with the new message
        await interaction.deferReply();

        // Gets the user input from the command then optionally filters it if settings.ini - Filter_Naughty_Words is set to true
        let userInput = interaction.options.getString('prompt');
        // Prompt filtering
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

        // Runs the python file AIMemeGenerator.py with the --userprompt and --memecount flag
        // --nouserinput is required to prevent it asking for user input in the console
        // Remember that you are responsible for your own generations. This script comes with no liability or warranty.
        try {
            await runPythonFileAndWait('./AIMemeGenerator.py', ['--nouserinput', '--userprompt', userInput, '--memecount', 1]);
            console.log('Python file finished running');

            // Gets the path to the meme output file now that it has been generated
            try {
                const outputPath = findFileName();
                console.log("The returned file path to the meme is: " + outputPath);
                // Replies to the user with the generated meme by editing the previous reply
                await interaction.editReply({
                    files: [outputPath]
                });
            } catch (error) {
                console.error(error);
                await interaction.deleteReply();
                await interaction.followUp({
                    content: "An error occurred while fetching this meme. Please try again",
                    ephemeral: true
                });
                return;
            }
        } catch (error) {
            console.error("Running AIMemeGenerator.py FAILED with error: " + error);
            await interaction.deleteReply();
            await interaction.followUp({
                content: "There was an error in the generation step of making this meme! Try again!",
                ephemeral: true
            });
            return;
        }
    },
};

// Finds the path to the meme output file. It will be the last entry in the log.txt file
// The line in the log file reads "Meme File Name: " followed by the file name
function findFileName() {
    // Defines the log file path and gets the file contents
    const logFilePath = './Outputs/log.txt'; /*TODO: Make this variable be parsed from the settings.ini config file*/
    const logFileContent = fs.readFileSync(logFilePath, 'utf8');

    // Gets the index of the LAST instance of 'Meme File Name:' in the log file provided. 
    // This ensures we get the most recent image generated
    const memeFileNameIndex = logFileContent.lastIndexOf('Meme File Name:');

    // Grab the filename out
    // The first argument in the substring function has "+ 2" to skip the ": " in the "Meme File Name: " line.
    const memeFileName = logFileContent.substring(logFileContent.indexOf(':', memeFileNameIndex) + 2, logFileContent.indexOf('\n', memeFileNameIndex)).trim();
    const memeFilePath = ('./Outputs/' + memeFileName);

    return memeFilePath;
}

// Runs the desired python file along with any arguments passed to it and waits for it to finish before allowing the program to continue
function runPythonFileAndWait(filename, args) {
    let error = '';
    console.log("The args passed are: " + args);
    // Spawns the script with the arguments passed to it
    const pythonProcess = spawn('python', [filename, ...args]);
    // Waits for the script to finish before continuing after resolve() is called in the close event
    return new Promise((resolve, reject) => {
        // Logs the python script outputs to the js console
        pythonProcess.stdout.on('data', (data) => {
            console.log(`stdout: ${data}`);
        });
        pythonProcess.stderr.on('data', (data) => {
            error += data.toString();
            console.error(`stderr: ${data}`);
        });
        pythonProcess.on('close', (code) => {
            console.log(`Process exited with code ${code}`);
            // Rejects the promise with the error message if there is an error. This will be caught by a catch block if the function is called in a try block
            if (error) {
                console.error("!!!Generation error. Message will not be posted with an image!!! :  " + error);
                reject(error);
            } else {
                resolve();
            }
        });
    });
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
