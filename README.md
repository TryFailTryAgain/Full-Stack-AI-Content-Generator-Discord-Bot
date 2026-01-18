# Full Stack AI Content Generator Fully Built As A Ready To Deploy Discord Bot

#### Allows you to automatically generate images of any kind using Flux.1, Imagen, Stability.AI, and more via Replicate api; optimize/stylize image prompts using LLMs; Integrate an open chatbot that has contextual understanding of each member; and ad-lib stories to fill in, all from within Discord. 
----------------------
<p align="center">
  <img src="https://github.com/TryFailTryAgain/Full-Stack-AI-Content-Generator-Discord-Bot/blob/main/Outputs/image-Example.png" width="55%">  <!-- Replace with your own image URL -->
  <img src="https://github.com/TryFailTryAgain/Full-Stack-AI-Content-Generator-Discord-Bot/blob/main/Outputs/image-edit-example.jpg" width="55%">  <!-- Replace with your own image URL -->
</p>

## Features
  - Built-in moderation
    - Enabled by default to ensure a safer, more responsible deployment out of the box
    - Uses OpenAI's moderation API (`omni-moderation-latest` model) to detect and block inappropriate or harmful content
    - Helps prevent abuse making your community better for all
  - Real-time AI voice chat in Discord voice channels
    - Join any voice channel and have natural, real-time voice-voice conversations with openAI's realtime models
    - Understands tone and inflection naturally, supports both interruptible ai by talking over it and non-interrupting modes for different conversation styles or large group calls
    - Set time limits for voice chat sessions to manage resource usage
  - Use Flux.1, Imagen, Stability.AI, and more via Replicate api
    - Natural language prompting allows conversational requests to make great images prompts after prepossessing them with OpenAI. ex input: "Make a photo of a cactus look realistic but add a baseball hat". This feature is disabled for more advanced image models as they already have a better understanding of the users intent.
    - Regenerate, Upscale, and iterative on generated images with easy to use buttons
    - Iterative image refinement using conversational editing. The editor attempts to maintain as much of the original image while adapting the parts you request to be modified. (Working in older versions, currently under development again for easier use)
    - Multi-image generation, Image dimensions, Seed, CFG, Steps, and options to disable natural language processing are built into the command
- Model switching capabilities
  - Seamlessly switch between multiple AI models for image generation like Dall-E 3, Flux.1, Stable Diffusion, and more
- Enable a chatbot in any text channel
  - Per channel text bots can be activated for all users in chat. No need to issue more / commands. Enable once for your desired duration and the bot will understand all your different members chatting.
  - To preserve user privacy no previous messages are added to the context window prior to the command activating. A warning is also issued by the bot that it is now active in the specified text channel.
- Create an AI generated ad-lib story that you fill in
- High degree of easy customization for all commands

## Current Discord bot /slash commands
- /image
  - Generates an image given a message and some optional parameters. Has buttons to Regenerate, Upscale, or Refine with chat for conversational and selective editing
- /image-advanced
  - Provides fine grain control over all aspects of image creation including model selection, image dimensions, and advanced parameters. Supports text2img, img2img, upscaling, and image-edit modes via a dynamically populated selection menu
- /chat
  - A chatbot that can be activated with the channel that the command is called from. It will be active and respond to any users messages until the set duration is over or the command is called again to end it.
- /voice-chat
  - Join a specified voice channel to enable real-time voice conversations with an AI assistant
  - Optional 'no_interruptions' mode allows the AI to finish speaking even when users talk over it
  - Automatically detects and recognizes users in the voice channel
  - Supports realtime function calling via voice
- /voice-chat-tts
  - Just like /voice-chat, but uses speech to text, sent to an LLM, then the voice response is generated using text to speech in realtime
- /ad-lib-story
  - Generates a Madlibs-style story (optionally guided by your prompt) and sends a modal form for you to fill in placeholders before returning the final story


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

## Settings for customization via environment variables and in .env files
-This is NOT a full list and other more detailed customizations are not listed. See .env.defaults-

[Image command settings]
- IMAGE_MODEL: model for text-to-image generation (e.g., black-forest-labs/flux-dev)
- IMAGE_PROMPT_MODEL: LLM for prompt optimization (e.g., gpt-4o-mini)
- IMAGE_UPSCALE_MODEL: model for upscaling outputs (e.g., nightmareai/real-esrgan)

[Advanced image command settings]
- IMAGE_ADV_TEXT2IMG_MODELS: comma-separated list of available text-to-image models
- IMAGE_ADV_IMG2IMG_MODELS: comma-separated list of img2img models
- IMAGE_ADV_UPSCALE_MODELS: comma-separated list of upscaling models
- IMAGE_ADV_EDIT_MODELS: comma-separated list of image edit models

[Chat command settings]
- CHAT_MODEL: LLM used for chat responses (e.g., gpt-4o-mini)
- CHAT_SYSTEM_MESSAGE: base system prompt for the chat assistant
- CHAT_USER_MESSAGE: optional user message template for chat commands

[Voice chat command settings]
- VOICE_CHAT_MODEL_URL: WebSocket URL for real-time voice API
- VOICE_CHAT_TIME_LIMIT: time limit for voice sessions in seconds
- VOICE_CHAT_INTERRUPTION_DELAY: delay before AI is interrupted (ms)

[Ad-lib story settings]
- ADLIB_PROMPT_MODEL: LLM model for story generation (e.g., gpt-4o-mini)

[Advanced options]
- ADVCONF_SAVE_IMAGES: enable saving generated images locally (true/false)
- ADVCONF_SEND_IMAGES_AS: format for sending images (jpeg/png)
- ADVCONF_JPEG_QUALITY: quality level for JPEG images (1–100)
