const { Events } = require('discord.js');
const imageChatModal = require('../components/imageChatModal.js');

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction, client) {
		if (interaction.isChatInputCommand()){

		const command = interaction.client.commands.get(interaction.commandName);

        // Log the error is the /command sent doesn't exist on the server
		if (!command) {
			console.error(`No command matching ${interaction.commandName} was found.`);
			return;
		}

        // Attempt to execute the command
		try {
			await command.execute(interaction);
		} catch (error) { //catch any command errors
			console.error(`Error executing ${interaction.commandName}`);
			console.error(error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command! Notify your bot host if this persists.', ephemeral: true });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command! Notify your bot host if this persists.', ephemeral: true });
            }
		}
		}
		// //handle modal submit
		// if(interaction.isModalSubmit()){
		// 	// Handle image command chat refinement modal
		// 	if(interaction.customId === 'chatRefineModal'){
		// 		// execute the refinement request on submit
		// 		try{
		// 			imageChatModal.execute(interaction);
		// 	} catch {
		// 		console.error(`Error executing ${interaction.commandName}`);
		// 		console.error(error);
		// 		await interaction.followUp({ content: 'There was an error while executing this command! Notify your bot host if this persists.', ephemeral: true });
		// 	}
		// 	}
		// }
	},
};