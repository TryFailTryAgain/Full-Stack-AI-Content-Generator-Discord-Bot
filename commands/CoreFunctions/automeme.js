// File: automeme.js
// Author: TryFailTryAgain
// Copyright (c) 2023. All rights reserved. For use in Open-Source projects this
// may be freely copied or excerpted with credit to the author.
const { SlashCommandBuilder } = require('discord.js');
const { spawn } = require('child_process');
const fs = require('fs');

module.exports = {
    cooldown: 15,
    data: new SlashCommandBuilder()
        .setName('automeme')
        .setDescription('Replies with a totally random meme!'),
    async execute(interaction) {
        // Responds to the command to prevent discord timeout and this will display that the bot is thinking
        // Editing this reply will remove the loading message and replace it with anything else
        await interaction.deferReply();

        // Runs the python file AIMemeGenerator.py with the --nouserinput flag
        try {
            await runPythonFileAndWait('AIMemeGenerator.py', ['--nouserinput']);
            console.log('Python file finished running');
        } catch (error) {
            console.error("Running AIMemeGenerator.py FAILED with error: " + error);
        }

        // Replies to the user with the generated meme by editing the previous reply
        const outputPath = findFileName();
        console.log("The returned file path to the meme is: " + outputPath);
        await interaction.editReply({
            files: [outputPath]
        });
    },
};

// Finds the path to the meme output file. It will be the last entry in the log.txt file
// The line in the log file reads "Meme File Name:" followed by the file name
function findFileName() {
    const logFilePath = 'Outputs/log.txt';
    const logFileContent = fs.readFileSync(logFilePath, 'utf8');
    const logFileLines = logFileContent.split('\n');
    const memeFileNameLine = logFileLines.findLast(line => line.startsWith('Meme File Name:'));
    const memeFileName = memeFileNameLine.split(':')[1].trim();
    const memeFilePath = `./Outputs/${memeFileName}`;
    return memeFilePath;
}

// Runs the desired python file along with any arguments passed to it and waits for it to finish before allowing the program to continue
const runPythonFileAndWait = async (filename, args) => {
    // Spawns the script with the arguments passed to it
    const pythonProcess = spawn('python', [filename, ...args]);
    // Waits for the script to finish before continuing after resolve() is called in the close event
    return new Promise((resolve, reject) => {
        // Logs the python script outputs to the js console
        pythonProcess.stdout.on('data', (data) => {
            console.log(`stdout: ${data}`);
        });
        pythonProcess.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
        });
        pythonProcess.on('close', (code) => {
            console.log(`Process exited with code ${code}`);
            resolve();
        });
    });
};