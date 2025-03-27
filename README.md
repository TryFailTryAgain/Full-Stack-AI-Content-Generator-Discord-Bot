# Full Stack AI Content Generator Fully Built As A Ready To Deploy Discord Bot

#### Allows you to automatically generate images of any kind using Flux.1, Dall-E 3, Stability.AI, and more via Replicate api; optimize/stylize image prompts using LLMs; Integrate an open chatbot that has contextual understanding of each member; and ad-lib stories to fill in, all from within Discord. 
----------------------
<p align="center"><img src="https://github.com/TryFailTryAgain/Full-Stack-AI-Content-Generator-Discord-Bot/blob/main/assets/image-example.png"width=22%> <img src="https://github.com/TryFailTryAgain/Full-Stack-AI-Meme-Generator-Discord-Bot/blob/main/assets/example2.png" width=30%><img src="https://github.com/TryFailTryAgain/Full-Stack-AI-Content-Generator-Discord-Bot/blob/main/assets/image-refinement-example.png" width=45%></p>

## Features
  - Real-time AI voice chat in Discord voice channels
    - Join any voice channel and have natural, real-time voice-voice conversations with openAI's realtime models
    - Understands tone and inflection naturally, supports both interruptible ai by talking over it and non-interrupting modes for different conversation styles or large group calls
    - Set time limits for voice chat sessions to manage resource usage
  - Use Flux.1, Dall-E 3, Stability.AI, and more via Replicate api
    - Natural language prompting allows conversational requests to make great images prompts after prepossessing them with OpenAI. ex input: "Make a photo of a cactus look realistic but add a baseball hat". This feature is disabled for more advanced image models as they already have a better understanding of the users intent.
    - Regenerate, Upscale, and iterative on generated images with easy to use buttons
    - Iterative image refinement using conversational editing. The editor attempts to maintain as much of the original image while adapting the parts you request to be modified. (Working in older versions, currently under development again for easier use)
    - Multi-image generation, Image dimensions, Seed, CFG, Steps, and options to disable natural language processing are built into the command
- Model switching capabilities
  - Seamlessly switch between multiple AI models for image generation like Dall-E 3, Flux.1, Stable Diffusion, and more
  - Each model provides different strengths and artistic styles for varied image generation results
  - Advanced configuration options available for each model to fine-tune your generations
- Enable a chatbot in any text channel
  - Per channel text bots can be activated for all users in chat. No need to issue more / commands. Enable once for your desired duration and the bot will understand all your members chatting and understand them.
  - To preserve user privacy no previous messages are added to the context window prior to the command activating. A warning is also issued by the bot that it is now active in the specified text channel.
- Create an AI generated ad-lib story that you fill in
- Uses OpenAI's GPT-4 to generate on demand memes using a concept of your choice or random selection
- High degree of customization for all commands on the host's end
  - Custom api endpoints for OpenAI compatible APIs
  - Customize system and user messages for each command calling OpenAI
  - Optional moderation logging with discord user privacy preserving features
  - Profanity filtering
  - Image safty checks
  - OpenAI model used on a per command basis and many more!

## Current Discord bot /slash commands
- /image
  - Generates an image given a message and some optional parameters. Has buttons to Regenerate, Upscale, or Refine with chat for each image generation
- /image-advanced
  - Provides fine grain control over all aspects of image creation including model selection, image dimensions, and advanced parameters. Supports uploading images for image-to-image generation and more.
- /chat
  - A chatbot that can be activated with the channel that the command is called from. It will be active and respond to any users messages until the set duration is over or the command is called again to end it.
- /voice-chat
  - Join a specified voice channel to enable real-time voice conversations with an AI assistant
  - Optional 'no_interruptions' mode allows the AI to finish speaking even when users talk over it
  - Automatically detects and recognizes users in the voice channel
- /ad-lib_story
  - This will summon chatGPT to create a story, with or without a user prompt to guide it, that then sends a modal form for the user to fill out before turning the ad-libed story back over to them


## Usage instructions

### Docker Deployment (Recommended)
1. Clone the repository
2. Configure your environment variables:
   - Configure the provided docker-compose.yaml to contain your Discord dev information and AI service api keys.
   - Alternatively, you can pass environment variables directly to Docker or provide a local configuration file by copying `.env.defaults` to `.env.local` and providing your own configuration and keys.
3. Build and run the Docker container:
   ```
   docker compose -up -d
   ```
4. Your bot is now up and running in a container!

### Manual Installation
1. Clone or download the repository. In the terminal at the projects root install the necessary packages
    ```
    npm install
    ```
2. Obtain at least an OpenAI API key, and for more image platform options obtain Stability AI and Replicate keys as well.
3. Configure your environment:
   - Copy `.env.defaults` to `.env.local` and update with your desired configuration as well as the environment variables for your Discord tokens and respective AI api keys.
4. Invite your bot made via discord developer portal to your server
5. Run the command deploy script to initialize the commands on your specified server or use the global command to deploy to all servers the bot is a member of
    ```
    node deploy-commands.js
    ```
    ```
    node deploy-commands-global.js
    ```
6. Start the bot!
    - node .

## Settings for customization via enviroment variables and in .env files
-UPDATE COMING TO THIS LIST-

Global settings:
- Profanity filter can be enabled/disabled

/image specific settings:
- Adjustable OpenAI System and User messages per request type
- LLM model selection per request type
- Image generation platform OpenAI or Stability.ai
- Moderation logging
- Save images to disk can be enabled or disabled
- Adjustable image format png/jpeg/webp/...ect
