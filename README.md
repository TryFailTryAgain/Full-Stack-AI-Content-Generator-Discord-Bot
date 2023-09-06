# Full Stack AI Meme/Story Generator In A Discord Bot

#### Allows you to automatically generate meme images, and ad-lib stories to fill in, from start to finish using AI within Discord. It will generate the text for the meme (optionally based on a user-provided concept), create a related image, and combine the two into a final image file before posting it to the Discord server the /command called it from.
----------------------
<p align="center"><img src="https://github.com/TryFailTryAgain/Full-Stack-AI-Meme-Generator-Discord-Bot/blob/main/assets/example.png" width=35%> <img src="https://github.com/TryFailTryAgain/Full-Stack-AI-Meme-Generator-Discord-Bot/blob/main/assets/example2.png" width=35%></p>

## Features
- NEW FUNCTIONALITY: Create an AI generated ad-lib story that you fill in
- Uses OpenAI's GPT-4 to generate the text and image prompt for the meme.
- Automatically sends image prompt request to an AI image generator of choice, then combines the text and image
- Allows customization of the meme generation process through various settings.
- Generates memes with a user-provided subject or concept, or you can let the AI decide.
- Logs meme generation details for future reference.
- Discord integration with two /slash commands for automatic or prompted memes
- Optional profanity filter built in

## Current Discord bot /slash commands

- /automeme  This with generate a completely random meme on request and post it in the chat where the command was called
- /automeme_about  This has a required prompt field that a user enters their prompt idea/concept/instructions
- /ad-lib_story  This will summon chatGPT to create a story, with or without a user prompt to guide it, that then sends a modal form for the user to fill out before turning the ad-libed story back over to them

## Usage instructions

1. Clone the repository & Install the necessary packages. via
    - Node.js requirements: npm install
    - Python requirements: pip install -r Requirements.txt
3. Obtain at least an OpenAI API key, but it is recommended to also use APIs from Clipdrop or Stability AI (DreamStudio) for the image generation stage.
4. Copy the blank files provided in the 'assets' folder into the root folder and name them 'settings.ini' and 'api_keys.ini' respectively. This is for controlling meme generation
    - Edit 'api_keys.ini' to add your api keys for the platforms you intend to use. OpenAI required.
    - Edit 'settings.ini' to make any modifications to the defaults. Each setting is explained in the comments of the file
5. Copy and rename 'config_empty.json' to 'config.json' in the root directory and to include:
    - token: Your bot secret token
    - clientId: The application id of your discord application
    - guildId: The server id for the discord server you would like the bot to be able to operate in 
7. Invite your bot made via discord developer portal to your server
8. Run the command deploy script to initialize the commands on your server
    - node deploy-commands.js
9. Start the bot!
    - node .

## Settings for customization

Various settings for the meme generation process can be customized:

- OpenAI API settings: Choose the text model and temperature for generating the meme text and image prompt.
- Image platform settings: Choose the platform for generating the meme image. Options include OpenAI's DALLE2, StabilityAI's DreamStudio, and ClipDrop.
- Basic Meme Instructions: You can tell the AI about the general style or qualities to apply to all memes, such as using dark humor, surreal humor, wholesome, etc. 
- Special Image Instructions: You can tell the AI how to generate the image itself (more specifically,  how to write the image prompt). You can specify a style such as being a photograph, drawing, etc, or something more specific such as always using cats in the pictures.
- Profanity filter can be enabled/disabled

## Example Image Output With Log
<p align="center"><img src="https://github.com/ThioJoe/Full-Stack-AI-Meme-Generator/assets/12518330/6400c973-f7af-45ed-a6ad-c062c2be0b64" width="400"></p>

```
Meme File Name: meme_2023-07-13-15-34_ZYKCV.png
AI Basic Instructions: You will create funny memes.
AI Special Image Instructions: The images should be photographic.
User Prompt: 'cats'
Chat Bot Meme Text: "When you finally find the perfect napping spot... on the laptop."
Chat Bot Image Prompt: "A photograph of a cat laying down on an open laptop."
Image Generation Platform: clipdrop
```

## Optional Arguments for commandline interaction and development of additional bot functionality
### You can also pass options into the program via command-line arguments whether using the python version or exe version.

#### • API Key Arguments: Not necessary if the keys are already in api_keys.ini
`--openaikey`: OpenAI API key.

`--clipdropkey`: ClipDrop API key.

`--stabilitykey`: Stability AI API key.

#### • Basic Meme Arguments

`--userprompt`: A meme subject or concept to send to the chat bot. If not specified, the user will be prompted to enter a subject or concept.

`--memecount`: The number of memes to create. If using arguments and not specified, the default is 1.

#### • Advanced Meme Settings Arguments

`--imageplatform`: The image platform to use. If using arguments and not specified, the default is 'clipdrop'. Possible options: 'openai', 'stability', 'clipdrop'.

`--temperature`: The temperature to use for the chat bot. If using arguments and not specified, the default is 1.0.

`--basicinstructions`: The basic instructions to use for the chat bot. If using arguments and not specified, the default is "You will create funny memes that are clever and original, and not cliche or lame.".

`--imagespecialinstructions`: The image special instructions to use for the chat bot. The default is "The images should be photographic.".

#### • Binary arguments: Just adding them activates them, no text needs to accompany them

`--nouserinput`: If specified, this will prevent any user input prompts, and will instead use default values or other arguments.

`--nofilesave`: If specified, the meme will not be saved to a file, and only returned as virtual file part of memeResultsDictsList.

