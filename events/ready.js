const { Events } = require('discord.js');

module.exports = {
	name: Events.ClientReady,
	once: true,
	execute(client) {
        // Initialize a Map to store the active state for each channel
        client.chatStates = new Map();
		console.log(`Ready! Logged in as ${client.user.tag}`);
	}
};
