import debug from "debug";
import config from "../../config";

const log: debug.IDebugger = debug("app:iaPort");

export interface PromptOptions {
    maxTokens?: number;
    temperature?: number;
    stop?: string[];
    timeoutMs?: number;
}

interface LlamaCppCompletionResponse {
    content: string;
    stop?: boolean;
    model?: string;
    tokens_predicted?: number;
    tokens_evaluated?: number;
}

const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_TIMEOUT_MS = 120_000;

export default class IaPort {
    constructor() {
    }

    static async prompt(promptText: string, options: PromptOptions = {}): Promise<string> {
        if (!config.MODEL_SERVICE_URL) {
            throw new Error("MODEL_SERVICE_URL is not configured");
        }

        const endpoint = `${config.MODEL_SERVICE_URL.replace(/\/$/, "")}/completion`;
        log(`Sending prompt to ${endpoint} (${promptText.length} chars)`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: promptText,
                    n_predict: options.maxTokens ?? DEFAULT_MAX_TOKENS,
                    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
                    stop: options.stop ?? [],
                    stream: false,
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                const errorBody = await response.text().catch(() => "");
                throw new Error(`Model service responded with ${response.status} ${response.statusText}: ${errorBody}`);
            }

            const data = await response.json() as LlamaCppCompletionResponse;
            return data.content;
        } finally {
            clearTimeout(timeout);
        }
    }
}
