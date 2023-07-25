const { SlashCommandBuilder } = require('discord.js');

// Sends the "robot-no-meme.jpg" file in the testing commands folder as a reply to the user
module.exports = {
	data: new SlashCommandBuilder()
		.setName('selfi')
		.setDescription('Replies with a selfi!'),
	async execute(interaction) {
		await interaction.reply({
            files: ['commands/Utility/Robot-no-meme.jpg']
        });
	},
};
