const { REST, Routes } = require('discord.js');

// Load environment variables
require('dotenv').config({ path: '.env.defaults' });
require('dotenv').config({ path: '.env.local' });

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

const fs = require('node:fs');
const path = require('node:path');

async function deployCommands() {
  console.log('Starting global command deployment...');
  
  const commands = [];
  // Grab all the command files from the commands directory you created earlier
  const foldersPath = path.join(__dirname, 'commands');
  const commandFolders = fs.readdirSync(foldersPath);

  for (const folder of commandFolders) {
    // Grab all the command files from the commands directory you created earlier
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    // Grab the SlashCommandBuilder#toJSON() output of each command's data for deployment
    for (const file of commandFiles) {
      const filePath = path.join(commandsPath, file);
      const command = require(filePath);
      if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
      } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
      }
    }
  }

  // Construct and prepare an instance of the REST module
  const rest = new REST().setToken(token);

  try {
    console.log(`Started refreshing ${commands.length} application (/) commands globally.`);

    // The put method is used to fully refresh all commands globally with the current set
    const data = await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands },
    );

    console.log(`Successfully reloaded ${data.length} application (/) commands globally.`);
    return true;
  } catch (error) {
    // And of course, make sure you catch and log any errors!
    console.error('Error deploying global commands:', error);
    return false;
  }
}

// When run directly as a script, without index.js, call deployCommands immediately
if (require.main === module) {
  deployCommands()
    .then(() => console.log('Command deployment script completed.'))
    .catch(error => console.error('Command deployment failed:', error));
}

// Export for use in other files
module.exports = { deployCommands };
