// Require the necessary discord.js classes
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
// File containing the bot token
// !!!!!DO NOT COMMIT THIS FILE!!!!!
const { token } = require('./config.json');

// Create a new client instance
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Gets all the command files in the commands directory
// ALL COMMANDS MUST BE WITHIN A SUBFOLDER OF THE COMMANDS FOLDER
client.commands = new Collection();
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = require(filePath);
		// Set a new item in the Collection with the key as the command name and the value as the exported module
		if ('data' in command && 'execute' in command) {
			client.commands.set(command.data.name, command);
		} else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
} // End of command file loading



// Actions/events/commands setup to be recognized by the bot

// When the client is ready, run this code (only once)
// We use 'c' for the event parameter to keep it separate from the already defined 'client'
client.once(Events.ClientReady, c => {
	console.log(`Ready! Logged in as ${c.user.tag}`);
});

client.on("ready", () => {
	console.log("I am ready!");
});

// Logs interactions that are't chats
client.on(Events.InteractionCreate, interaction => {
	if (!interaction.isChatInputCommand()) return;
	console.log(interaction);
});

// Grabs slash command interactions and executes them
client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isChatInputCommand()) return;

	const command = interaction.client.commands.get(interaction.commandName);

	// Log the error is the /command sent doesn't exist on the server
	if (!command) {
		console.error(`No command matching ${interaction.commandName} was found.`);
		return;
	}
	// Attempt to execute the command
	try {
		await command.execute(interaction, client);
	} catch (error) { //catch any command errors
		console.error(error);
		if (interaction.replied || interaction.deferred) {
			await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
		} else {
			await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
		}
	}
});// End of actions/events/commands setup

// Login to Discord with bot client's token
client.login(token);

