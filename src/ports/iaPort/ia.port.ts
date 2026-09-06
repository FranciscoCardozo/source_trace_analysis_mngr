import debug from "debug";
import config from "../../config";
import ErrorHandler from "../../domain/errorHandler";

const log: debug.IDebugger = debug("app:iaPort");

export interface PromptOptions {
    maxTokens?: number;
    temperature?: number;
    stop?: string[];
    timeoutMs?: number;
}

interface ChatCompletionResponse {
    choices?: { message?: { content?: string } }[];
}

const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_TIMEOUT_MS = 1_800_000;

const SYSTEM_PROMPT = [
    "You are a precise technical assistant analyzing software repositories.",
    "Follow the user's formatting instructions exactly (JSON-only, plain text, language, length, etc.).",
    "Output nothing besides what is explicitly requested: no preamble, no restated instructions, no extra commentary.",
].join(" ");

export default class IaPort {
    constructor() {
    }

    static async prompt(promptText: string, options: PromptOptions = {}): Promise<string> {
        if (!config.MODEL_SERVICE_URL) {
            throw ErrorHandler.modelServiceNotConfigured();
        }

        // Uses the OpenAI-compatible chat endpoint (not llama.cpp's raw /completion)
        // so the model's own chat template is applied. Raw completion mode gives an
        // instruction-tuned model no clear boundary between "instructions" and
        // "response", and it can degenerate into echoing/repeating the instructions
        // instead of answering them.
        const endpoint = `${config.MODEL_SERVICE_URL.replace(/\/$/, "")}/v1/chat/completions`;
        log(`Sending prompt to ${endpoint} (${promptText.length} chars)`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: "local",
                    messages: [
                        { role: "system", content: SYSTEM_PROMPT },
                        { role: "user", content: promptText },
                    ],
                    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
                    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
                    stop: options.stop && options.stop.length > 0 ? options.stop : undefined,
                    stream: false,
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                const errorBody = await response.text().catch(() => "");
                throw ErrorHandler.modelServiceError(response.status, response.statusText, errorBody);
            }

            const data = await response.json() as ChatCompletionResponse;
            const content = data.choices?.[0]?.message?.content;
            if (typeof content !== "string") {
                throw ErrorHandler.unexpectedModelResponse(data);
            }

            return content;
        } finally {
            clearTimeout(timeout);
        }
    }
}
