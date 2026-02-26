/*
* factCheckHandler.js
* Fact-check specific LLM logic: generates fact-check reports with
* structured output, parses responses, and provides mode handlers
* for the turn processor pipeline.
*
* Also exports the generic createAssistantChatMode for normal voice chat.
*/
const { OpenAI } = require('openai');
const { disconnect_voice_chat_tool } = require('../tools/voiceDisconnectTool.js');

function requireEnvVar(name, { allowEmpty = false } = {}) {
    const value = process.env[name];
    if (value === undefined || value === null) {
        throw new Error(`[FactCheck] Missing required environment variable: ${name}`);
    }

    if (!allowEmpty && String(value).trim() === '') {
        throw new Error(`[FactCheck] Environment variable ${name} cannot be empty`);
    }

    return value;
}

const factCheckStructuredOutputSchema = {
    name: 'voice_fact_check_result',
    strict: true,
    schema: {
        type: 'object',
        properties: {
            spoken_summary: {
                type: 'string',
                description: 'Short, TTS-friendly spoken summary (2-3 sentences max).'
            },
            detailed_assessment: {
                type: 'string',
                description: 'Concise markdown assessment with TRUE/FALSE/UNCERTAIN labels and source links.'
            }
        },
        additionalProperties: false,
        required: ['spoken_summary', 'detailed_assessment']
    }
};

// ── Wake-phrase detection & transcript windowing ───────────────────────────

function detectFactCheckWakePhrase(text = '') {
    const normalized = String(text || '').toLowerCase();
    return /\bfact\s*-?\s*check(?:ing)?\b/.test(normalized);
}

function selectRecentTranscriptWindow(entries = [], {
    maxEntries = 12,
    maxChars = 4500
} = {}) {
    if (!Array.isArray(entries) || entries.length === 0) return [];

    const selected = [];
    let totalChars = 0;

    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        const text = String(entry?.text || '').trim();
        if (!text) continue;

        const size = text.length;
        if (selected.length >= maxEntries) break;
        if (selected.length > 0 && (totalChars + size) > maxChars) break;

        selected.unshift(entry);
        totalChars += size;
    }

    return selected;
}

// ── Transcript formatting & response parsing ───────────────────────────────

function formatTranscriptEntries(entries = []) {
    if (!Array.isArray(entries) || !entries.length) return '';
    return entries
        .map((entry) => {
            const speaker = entry?.username || entry?.userId || 'Unknown Speaker';
            const text = String(entry?.text || '').trim();
            if (!text) return '';
            return `${speaker}: ${text}`;
        })
        .filter(Boolean)
        .join('\n');
}

function extractResponseRefusal(response) {
    const outputItems = Array.isArray(response?.output) ? response.output : [];
    for (const item of outputItems) {
        if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
        for (const contentItem of item.content) {
            if (contentItem?.type === 'refusal' && typeof contentItem.refusal === 'string' && contentItem.refusal.trim()) {
                return contentItem.refusal.trim();
            }
        }
    }
    return null;
}

function extractResponseTextFromOutput(response) {
    if (typeof response?.output_text === 'string' && response.output_text.trim()) {
        return response.output_text;
    }

    const outputItems = Array.isArray(response?.output) ? response.output : [];
    const chunks = [];
    for (const item of outputItems) {
        if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
        for (const contentItem of item.content) {
            if (contentItem?.type === 'output_text' && typeof contentItem.text === 'string') {
                chunks.push(contentItem.text);
            }
        }
    }
    return chunks.join('\n').trim();
}

function parseFactCheckStructuredOutput(response) {
    const rawText = extractResponseTextFromOutput(response).trim();
    if (!rawText) {
        return { spokenSummary: null, detailedAssessment: null, rawText: '' };
    }

    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch (error) {
        throw new Error(`Fact-check structured output was not valid JSON: ${error.message}`);
    }

    const spokenSummary = typeof parsed?.spoken_summary === 'string' ? parsed.spoken_summary.trim() : '';
    const detailedAssessment = typeof parsed?.detailed_assessment === 'string' ? parsed.detailed_assessment.trim() : '';

    return {
        spokenSummary: spokenSummary || null,
        detailedAssessment: detailedAssessment || null,
        rawText
    };
}

// ── Fact-check report generator ────────────────────────────────────────────

/**
 * Creates a fact-check handler with its own OpenAI client.
 * @param {Object} options
 * @param {string} [options.model] - LLM model for fact-check inference
 * @param {string} [options.systemPrompt] - System prompt override
 * @returns {{ generateReport: Function }}
 */
function createFactCheckHandler({ model, systemPrompt } = {}) {
    const client = new OpenAI({
        apiKey: requireEnvVar('API_KEY_OPENAI_CHAT'),
        baseURL: requireEnvVar('ADVCONF_OPENAI_CHAT_BASE_URL')
    });

    const resolvedModel = model || requireEnvVar('OPENAI_TTS_LLM_MODEL');
    const resolvedSystemPrompt = systemPrompt || requireEnvVar('OPENAI_VOICE_FACT_CHECK_INSTRUCTIONS');

    async function generateReport({ triggerText = '', transcriptEntries = [] } = {}) {
        const formattedTranscript = formatTranscriptEntries(transcriptEntries);

        const payload = {
            model: resolvedModel,
            input: [
                {
                    role: 'system',
                    content: [{ type: 'input_text', text: resolvedSystemPrompt }]
                },
                {
                    role: 'user',
                    content: [{
                        type: 'input_text',
                        text: [
                            'A user asked for a fact-check in a voice conversation.',
                            'Use web search to verify claims from the discussion excerpt.',
                            'If evidence conflicts, mark as uncertain.',
                            'Keep both sections concise and direct.',
                            'Return output that matches the required JSON schema exactly.',
                            'spoken_summary must be optimized for spoken TTS output, short and to the point.',
                            'detailed_assessment must be concise markdown bullets with source links but can allow for more nuanced explanations if necessary.',
                            `Wake phrase context: ${String(triggerText || '').trim() || 'N/A'}`,
                            '',
                            'Discussion excerpt to fact-check:',
                            formattedTranscript || 'No transcript provided.'
                        ].join('\n')
                    }]
                }
            ],
            tools: [{ type: 'web_search' }],
            tool_choice: 'auto',
            text: {
                format: {
                    type: 'json_schema',
                    ...factCheckStructuredOutputSchema
                }
            },
            store: false
        };

        let lastError = null;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
            try {
                const response = await client.responses.create(payload);
                const refusal = extractResponseRefusal(response);
                if (refusal) {
                    throw new Error(`Fact-check response refused: ${refusal}`);
                }

                const parsed = parseFactCheckStructuredOutput(response);
                if (parsed.spokenSummary && parsed.detailedAssessment) {
                    return {
                        spokenSummary: parsed.spokenSummary,
                        detailedAssessment: parsed.detailedAssessment
                    };
                }

                lastError = new Error('Fact-check response missing SPOKEN_SUMMARY or DETAILED_ASSESSMENT.');
                console.error(`[FactCheck] Attempt ${attempt} failed validation:`, parsed.rawText || '[empty-response]');
            } catch (error) {
                lastError = error;
                console.error(`[FactCheck] Attempt ${attempt} failed:`, error);
            }
        }

        throw lastError || new Error('Fact-check failed after retry.');
    }

    return { generateReport };
}

// ── Mode handlers for turnProcessor ────────────────────────────────────────

/**
 * Creates the fact-check mode handler for createTranscriptTurnProcessor.
 * Triggers inference only on wake-phrase detection, runs fact-check report,
 * posts detailed assessment to channel, and speaks a TTS summary.
 */
function createFactCheckMode({
    factCheckHandler,
    interaction,
    ws = null,
    discordConnection = null,
    recentMaxEntries = 12,
    recentMaxChars = 4500
}) {
    return {
        shouldTrigger(transcript, transcriptHistory) {
            if (!detectFactCheckWakePhrase(transcript)) return false;
            const transcriptEntries = selectRecentTranscriptWindow(transcriptHistory, {
                maxEntries: recentMaxEntries,
                maxChars: recentMaxChars
            });
            return {
                triggerText: transcript,
                transcriptEntries
            };
        },

        async runInference(context) {
            const report = await factCheckHandler.generateReport({
                triggerText: context.triggerText,
                transcriptEntries: context.transcriptEntries
            });

            if (report?.detailedAssessment && interaction?.channel?.send) {
                await interaction.channel.send({ content: report.detailedAssessment });
            }

            if (!report?.spokenSummary || !report?.detailedAssessment) {
                throw new Error('Fact-check report was invalid after retry.');
            }

            return { spokenText: report.spokenSummary };
        },

        async onError(error, { speech, connection, markThinking, markAudioStarted, resetTurnAudioState }) {
            console.error('[FactCheck] Failed after retry. Disconnecting bot.');
            try {
                await speech.speak('There was an error while fact-checking, so I will disconnect now. Please try again.', {
                    forceNoInterruptions: true,
                    onSynthesisStart: markThinking,
                    onAudioStart: markAudioStarted,
                    onPlaybackEnd: () => resetTurnAudioState?.('error-playback-ended')
                });
            } catch (speakError) {
                console.error('[FactCheck] Failed to speak error message before disconnect:', speakError);
            }
            try { await disconnect_voice_chat_tool(ws, discordConnection); } catch { }
            try { connection?.destroy?.(); } catch (disconnectError) {
                console.error('[FactCheck] Failed to destroy voice connection:', disconnectError);
            }
        }
    };
}

/**
 * Creates the default assistant chat mode handler for createTranscriptTurnProcessor.
 * Every transcript triggers inference via llm.generateReply().
 */
function createAssistantChatMode(llm) {
    return {
        shouldTrigger: () => ({}),
        async runInference() {
            const reply = await llm.generateReply();
            return { spokenText: reply };
        }
    };
}

module.exports = {
    createFactCheckHandler,
    createFactCheckMode,
    createAssistantChatMode,
    detectFactCheckWakePhrase,
    selectRecentTranscriptWindow,
    formatTranscriptEntries,
    parseFactCheckStructuredOutput,
    extractResponseRefusal,
    extractResponseTextFromOutput,
    factCheckStructuredOutputSchema
};
