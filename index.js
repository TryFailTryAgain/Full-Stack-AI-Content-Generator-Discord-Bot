// Load environment variables from .env.defaults. Can be overridden by Compose file
require('dotenv').config({ path: '.env.defaults' });
// Updated to override variables loaded from .env.defaults
require('dotenv').config({ path: '.env.local', override: true });

const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
// Use environment variable for the bot token:
const token = process.env.DISCORD_TOKEN;

// Import the deployCommands function
const { deployCommands } = require('./deploy-commands-global');

// Startup function to handle initialization
async function startup() {
	console.log('Starting Discord bot initialization...');

	// Check if we need to deploy commands first
	if (process.env.DEPLOY_COMMANDS_ON_STARTUP === 'true') {
		console.log('DEPLOY_COMMANDS_ON_STARTUP is enabled, deploying commands...');
		try {
			await deployCommands();
			console.log('Command deployment completed successfully.');
		} catch (error) {
			console.error('Command deployment failed:', error);
			console.log('Continuing with bot startup despite command deployment failure.');
		}
	} else {
		console.log('DEPLOY_COMMANDS_ON_STARTUP is disabled, skipping command deployment.');
	}

	// Create a new client instance
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
			GatewayIntentBits.DirectMessages,
			GatewayIntentBits.GuildMembers,
			GatewayIntentBits.GuildVoiceStates
		],
		partials: [Partials.Channel],
		timeout: 120_000
	});

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

	/* Events loading */
	// Gets all the event files in the events directory
	console.log('Loading event files...');
	const eventsPath = path.join(__dirname, 'events');
	const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

	for (const file of eventFiles) {
		const filePath = path.join(eventsPath, file);
		console.log(`Loading event module from file: ${file}`);
		const event = require(filePath);
		if (event.once) {
			console.log(`Registering one-time event handler for: ${event.name}`);
			client.once(event.name, (...args) => event.execute(...args));
		} else {
			console.log(`Registering event handler for: ${event.name}`);
			client.on(event.name, (...args) => event.execute(...args));
		}
	}
	console.log('Event files loaded successfully.');
	/* End Events Loading */

	// Login to Discord with bot client's token
	console.log('Logging in...');
	await client.login(token);
	console.log('Login successful');
}

// Start the bot
startup().catch(error => {
	console.error('Failed to start the bot:', error);
	process.exit(1);
});

