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

[Image command settings]
- IMAGE_MODEL: model for text-to-image generation (e.g., black-forest-labs/flux-2-dev)
- IMAGE_IMAGE2IMAGE_MODEL: model used for image-to-image transformations
- IMAGE_IMAGEEDIT_MODEL: model used for image editing operations
- IMAGE_UPSCALE_MODEL: model for upscaling outputs (e.g., nightmareai/real-esrgan)
- IMAGE_PROMPT_MODEL: LLM for prompt optimization (e.g., gpt-4.1-mini)
- IMAGE_OPTIMIZER_TEMPERATURE: temperature setting for prompt optimization LLM
- IMAGE_SYSTEM_MESSAGE: system prompt for the image prompt generator/improver
- IMAGE_USER_MESSAGE: user message template for prompt generation
- IMAGE_CHAT_REFINEMENT_SYSTEM_MESSAGE: system prompt for refining prompts based on user feedback
- IMAGE_CHAT_REFINEMENT_USER_MESSAGE: template for handling image refinement requests

[Advanced image command settings]
- IMAGE_ADV_TEXT2IMG_MODELS: comma-separated list of available text-to-image models
- IMAGE_ADV_IMG2IMG_MODELS: comma-separated list of image-to-image models
- IMAGE_ADV_UPSCALE_MODELS: comma-separated list of upscaling models
- IMAGE_ADV_EDIT_MODELS: comma-separated list of image edit models

[Chat command settings]
- CHAT_MODEL: LLM used for chat responses (e.g., gpt-4.1-mini)
- CHAT_TEMPERATURE: temperature setting for chat model responses
- CHAT_MAX_TOKENS: maximum tokens per chat response
- CHAT_SYSTEM_MESSAGE: base system prompt for the chat assistant

[Voice chat command settings]
- VOICE_CHAT_MODEL_URL: WebSocket URL for real-time voice API
- VOICE_CHAT_TIME_LIMIT: time limit for voice sessions in seconds
- VOICE_CHAT_INTERRUPTION_DELAY: delay before AI is interrupted (ms)
- VOICE_CHAT_IMAGE_MODEL: model used for image generation in voice chat
- OPENAI_VOICE_CHAT_INSTRUCTIONS: system instructions for voice AI personality and behavior
- OPENAI_VOICE_CHAT_DISCONNECT_MESSAGE: message AI uses when session time expires
- OPENAI_VOICE_CHAT_GREETING: initial greeting message when AI joins voice chat
- OPENAI_VOICE_CHAT_VOICE: voice selection for OpenAI TTS (e.g., alloy)
- OPENAI_VOICE_CHAT_TEMPERATURE: temperature for voice model responses
- OPENAI_VOICE_CHAT_RESPONSE_EAGERNESS: how quickly AI responds (auto/high/low)
- OPENAI_VOICE_CHAT_MAX_TOKENS: maximum tokens per voice response (inf for unlimited)

[Voice chat TTS settings]
- OPENAI_TRANSCRIPTION_MODEL: model for speech-to-text transcription
- OPENAI_STT_TRANSCRIPTION_PROMPT: optional prompt to guide transcription
- OPENAI_STT_TRANSCRIPTION_LANGUAGE: language code for transcription (e.g., en)
- OPENAI_TTS_LLM_MODEL: LLM model used for text generation in TTS mode
- OPENAI_TTS_MODEL: text-to-speech model for voice synthesis
- OPENAI_TTS_VOICE: voice selection for TTS output
- OPENAI_TTS_INSTRUCTIONS: instructions for TTS voice characteristics
- VOICE_CHAT_TTS_MAX_TOKENS: maximum tokens per TTS response
- VOICE_CHAT_TTS_TIME_LIMIT: time limit for TTS voice sessions in seconds
- VOICE_CHAT_TTS_TEMPERATURE: temperature for TTS LLM responses
- VOICE_CHAT_TTS_CONVERSATION_MAX_MESSAGES: max messages to retain in conversation history (inf for unlimited)
- VOICE_CHAT_TTS_TRANSCRIPTION_MODE: transcription processing mode (realtime/batch)
- VOICE_CHAT_TTS_SILENCE_STREAM_ENABLED: enable silence padding in audio stream
- VOICE_CHAT_TTS_SILENCE_PADDING_MS: silence padding duration in milliseconds
- VOICE_CHAT_TTS_SILENCE_PACKET_MS: packet interval for silence stream
- VOICE_CHAT_TTS_USE_VAD_EVENTS: enable voice activity detection events
- VOICE_CHAT_TTS_INTERRUPTION_DELAY: delay before user can interrupt AI speech (ms)
- VOICE_CHAT_TTS_PROVIDER: TTS service provider (openai, qwen3tts, qwen3, qwen)
- VOICE_CHAT_TTS_LLM_BACKEND: backend type for LLM processing (chat/completion)
- VOICE_CHAT_TTS_REASONING_LEVEL: reasoning level for LLM (minimal/standard/extended)

[Qwen3-TTS Settings (via Replicate)]
- REPLICATE_API_TOKEN: API token for Replicate (required for Qwen3-TTS)
- QWEN3_TTS_MODE: TTS mode (custom_voice, voice_clone, voice_design)
- QWEN3_TTS_SPEAKER: preset speaker for custom_voice mode (Aiden, Aria, Bella, Callum, Charlotte, Dylan, Ella, Grace, Harry, Isabella, Jack, Liam, Mia, Noah, Olivia, Sophia)
- QWEN3_TTS_LANGUAGE: language for TTS (auto, English, Chinese, Spanish, etc.)
- QWEN3_TTS_STYLE_INSTRUCTION: style/emotion instruction (e.g., 'speak slowly and calmly')
- QWEN3_TTS_VOICE_DESCRIPTION: voice description for voice_design mode (e.g., 'A warm, friendly female voice')
- QWEN3_TTS_REFERENCE_AUDIO: URL to reference audio for voice_clone mode
- QWEN3_TTS_REFERENCE_TEXT: transcript of reference audio for voice_clone mode

[Ad-lib story settings]
- ADLIB_PROMPT_MODEL: LLM model for story generation (e.g., gpt-4.1-mini)

[Moderation settings]
- MODERATION_OPENAI_MODERATION: enable OpenAI moderation API for content safety (true/false)
- MODERATION_BAD_WORDS_FILTER: enable bad-words profanity filter (true/false)
- MODERATION_BAD_WORDS_CUSTOM_LIST: comma-separated list of custom words to block
- MODERATION_BAD_WORDS_WHITELIST: comma-separated list of words to allow/unblock
- MODERATION_OPENAI_REALTIME: enable moderation for voice chat responses (adds latency)
- MODERATION_REPLICATE_IMAGE_SAFTY_CHECK: enable image safety checks via Replicate

[Advanced options]
- ADVCONF_SAVE_IMAGES: enable saving generated images locally (true/false)
- ADVCONF_SAVE_IMAGES_AS: format for saving images to disk (png/jpeg)
- ADVCONF_SEND_IMAGES_AS: format for sending images to Discord (jpeg/png)
- ADVCONF_JPEG_QUALITY: quality level for JPEG images (1–100)
- ADVCONF_SALT: salt value for user ID hashing (change for added security)
- ADVCONF_OPENAI_CHAT_BASE_URL: base URL for OpenAI chat API endpoint
- ADVCONF_OPENAI_IMAGE_BASE_URL: base URL for OpenAI image API endpoint
- ADVCONF_OPENAI_VOICE_CHAT_SYSTEM_LOGGING: enable detailed system logging for voice chat
- DEPLOY_COMMANDS_ON_STARTUP: automatically deploy slash commands when bot starts (true/false)