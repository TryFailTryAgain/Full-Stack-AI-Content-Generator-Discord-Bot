# Full Stack AI Content Generator Fully Built As A Ready To Deploy Discord Bot

#### Allows you to automatically generate images of any kind using Dall-E 3 and Stability.AI, optimize/stylize image prompts using Openai, memes with auto generated images and captions, and ad-lib stories to fill in, all from within Discord. 
----------------------
<p align="center"><img src="https://github.com/TryFailTryAgain/Full-Stack-AI-Content-Generator-Discord-Bot/blob/main/assets/image-example.png"width=22%> <img src="https://github.com/TryFailTryAgain/Full-Stack-AI-Meme-Generator-Discord-Bot/blob/main/assets/example2.png" width=30%><img src="https://github.com/TryFailTryAgain/Full-Stack-AI-Content-Generator-Discord-Bot/blob/main/assets/image-refinement-example.png" width=45%></p>

## Features
  - Use Dall-E 3 and Stability.AI to generate images
    - Natural language prompting allows conversational requests to make great images prompts after prepossessing them with OpenAI. ex input: "Make a photo of a cactus look realistic but add a baseball hat"
    - Regenerate, Upscale, and iterative & selective image modifications using chat
    - Iterative image refinement using conversational editing. The editor attempts to maintain as much of the original image while adapting the parts you request to be modified.
    - Multi-image generation, Image dimensions, Seed, CFG, Steps, and options to disable natural language processing are built into the command
- Create an AI generated ad-lib story that you fill in
- Uses OpenAI's GPT-4 to generate on demand memes using a concept of your choice or random selection
- High degree of customization for all commands on the host's end
  - Customize system and user messages for each command calling OpenAI
  - Optional moderation logging with discord user privacy preserving features
  - Profanity filtering
  - OpenAI model used on a per command basis and many more!

## Current Discord bot /slash commands
- /image
  - Generates an image given a message and some optional parameters. Has buttons to Regenerate, Upscale, or Refine with chat for each image generation
- /ad-lib_story
  - This will summon chatGPT to create a story, with or without a user prompt to guide it, that then sends a modal form for the user to fill out before turning the ad-libed story back over to them
- /automeme
  - This with generate a completely random meme on request and post it in the chat where the command was called
- /automeme_about
  - This has a required prompt field that a user enters their prompt idea/concept/instructions


## Usage instructions

1. Clone the repository & Install the necessary packages. via
    - Node.js requirements: npm install
    - Python requirements: pip install -r Requirements.txt
3. Obtain at least an OpenAI API key, and for more image platform options a Stability AI (DreamStudio) API key as well for the image generation stages.
4. Copy the blank files provided in the 'assets' folder into the root folder and name them 'settings.ini' and 'api_keys.ini' respectively. This is for ease of access to your API keys and to adjust command settings on the fly. Restarting the bot is required for some of the changes to take affect so it is best to do so after any settings or API changes are made.
    - Edit 'api_keys.ini' to add your api keys for the platforms you intend to use. OpenAI required.
    - Edit 'settings.ini' to make any modifications to the defaults. Each setting is explained in the comments of the file
5. Copy and rename 'config_empty.json' to 'config.json' in the root directory and to include:
    - token: Your bot secret token
    - clientId: The application id of your discord application
    - guildId: The server id for the discord server you would like the bot to be able non-globally deployed commands in.
7. Invite your bot made via discord developer portal to your server
8. Run the command deploy script to initialize the commands on your specified server or use the global command to deploy to all servers the bot is a member of
    - node deploy-commands.js
    - node deploy-commands-global.js
9. Start the bot!
    - node .

## Settings for customization in settings.ini
Global settings:
- Profanity filter can be enabled/disabled

/image specific settings:
- Adjustable OpenAI System and User messages per request type
- LLM model selection per request type
- Image generation platform OpenAI or Stability.ai
- Moderation logging
- Save images to disk can be enabled or disabled
- Adjustable image format png/jpeg/webp/...ect

Meme generation specific settings:
- OpenAI API settings: Choose the text model and temperature for generating the meme text and image prompt.
- Image platform settings: Choose the platform for generating the meme image. Options include OpenAI's DALLE2, StabilityAI's DreamStudio, and ClipDrop.
- Basic Meme Instructions: You can tell the AI about the general style or qualities to apply to all memes, such as using dark humor, surreal humor, wholesome, etc. 
- Special Image Instructions: You can tell the AI how to generate the image itself (more specifically,  how to write the image prompt). You can specify a style such as being a photograph, drawing, etc, or something more specific such as always using cats in the pictures.
