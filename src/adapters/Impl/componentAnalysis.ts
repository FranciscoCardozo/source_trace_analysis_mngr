import fs from "fs";
import path from "path";
import debug from "debug";
import { ComponentAnalysisFactory, ControllerValidationResult, ServiceValidationResult, ModelValidationResult, FrameworkComponentValidationResult, ApiValidationResult } from "../../domain/models/factoryImpl/componentAnalysisFactory";
import { buildFileTree, fileTreeForPrompt } from "../../domain/sourceInspector";
import IaPort from "../../ports/iaPort/ia.port";
import JobMetadataRepository from "../../domain/jobMetadataRepository";
import config from "../../config";

const log: debug.IDebugger = debug("app:componentAnalysisImpl");

const MAX_FILE_TREE_ENTRIES = 1000;

const CONTROLLER_PATTERNS = [
    /controller/i,                 // *Controller.java/.cs, .controller.ts, controllers/ folder
    /(^|\/)views?\.py$/i,          // Django views.py
    /(^|\/)routes?(\/|\.)/i,       // routes/ folder, routes.js, route.js
    /resource\.(java|ts|js)$/i,    // JAX-RS style *Resource.java
];

const SERVICE_PATTERNS = [
    /service/i,                    // *Service.java/.cs, .service.ts, services/ folder, *_service.py/rb
];

const MODEL_PATTERNS = [
    /model/i,                      // *Model.java/.cs, .model.ts, models/ folder, models.py (Django)
    /entity/i,                     // *Entity.java, .entity.ts, entities/ folder
    /(^|\/)domain\//i,             // domain/ folder (DDD-style entity location)
];

const FRAMEWORK_COMPONENT_PATTERNS: Record<string, Record<string, RegExp[]>> = {
    "Angular": {
        "Modules": [/\.module\.ts$/i],
        "Components": [/\.component\.ts$/i],
        "Directives": [/\.directive\.ts$/i],
        "Pipes": [/\.pipe\.ts$/i],
        "Guards": [/\.guard\.ts$/i],
    },
    "NestJS": {
        "Modules": [/\.module\.ts$/i],
        "Guards": [/\.guard\.ts$/i],
        "Interceptors": [/\.interceptor\.ts$/i],
        "Pipes": [/\.pipe\.ts$/i],
        "DTOs": [/\.dto\.ts$/i],
    },
    "React": {
        "Components": [/\.(jsx|tsx)$/i],
        "Hooks": [/(^|\/)use[A-Z][A-Za-z0-9]*\.(js|ts|jsx|tsx)$/],
        "Context": [/context/i],
    },
    "Vue": {
        "Components": [/\.vue$/i],
        "Composables": [/(^|\/)use[A-Z][A-Za-z0-9]*\.(js|ts)$/],
    },
    "Express": {
        "Middlewares": [/middleware/i],
    },
    "Spring Boot": {
        "Repositories": [/repository/i],
        "Configuration": [/config(uration)?/i],
    },
};

const LOCK_FILE_NAMES = new Set([
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Gemfile.lock",
    "poetry.lock", "go.sum", "composer.lock", "Cargo.lock",
]);

const HTTP_CLIENT_PATTERNS: RegExp[] = [
    /\bfetch\s*\(/,
    /\baxios\b/i,
    /\brequests\.(get|post|put|delete|patch)\s*\(/,
    /RestTemplate\b/,
    /WebClient\b/,
    /HttpClient\b/,
    /okhttp/i,
    /@FeignClient/,
    /curl_exec\s*\(/,
    /Net::HTTP/,
    /XMLHttpRequest\b/,
    /\$http\b/,
];

const URL_PATTERN = /https?:\/\/[^\s'"`)<>]+/g;

const URL_NOISE_PATTERNS: RegExp[] = [
    /localhost/i,
    /127\.0\.0\.1/,
    /w3\.org/i,
    /schemas\./i,
    /maven\.apache\.org/i,
    /registry\.npmjs\.org/i,
    /nuget\.org/i,
];

const MAX_FILES_SCANNED = 500;
const MAX_FILE_SIZE_BYTES = 200_000;
const MAX_URLS_COLLECTED = 100;
const MAX_CLIENT_FILES_COLLECTED = 50;

export class ComponentAnalysisImpl implements ComponentAnalysisFactory {
    constructor() {
    }

    async execute(jobId: string): Promise<any> {
        const controllersResult = await this.validateControllers(jobId);
        const servicesResult = await this.validateServices(jobId);
        const modelsResult = await this.validateModels(jobId);

        const metadata = await JobMetadataRepository.getMetadata(jobId);
        const framework = metadata?.generalInfo?.mainFramework ?? "unknown";
        const componentsResult = await this.validateComponents(jobId, framework);

        const apisResult = await this.validateApis(jobId);

        const componentsIdentified: string[] = [];
        if (controllersResult.controllers.length > 0) {
            componentsIdentified.push("Controllers");
        }
        if (servicesResult.services.length > 0) {
            componentsIdentified.push("Services");
        }
        if (modelsResult.models.length > 0) {
            componentsIdentified.push("Models");
        }
        componentsIdentified.push(...componentsResult.components);

        await JobMetadataRepository.upsertMetadata(jobId, {
            componentsIdentified,
            apisConsumed: apisResult.apis,
        });

        if (controllersResult.controllers.length > 0) {
            await JobMetadataRepository.addEvidence(jobId, "Controllers identificados", { paths: controllersResult.controllers });
        }
        if (servicesResult.services.length > 0) {
            await JobMetadataRepository.addEvidence(jobId, "Services identificados", { paths: servicesResult.services });
        }
        if (modelsResult.models.length > 0) {
            await JobMetadataRepository.addEvidence(jobId, "Models identificados", { paths: modelsResult.models });
        }
        if (apisResult.apis.length > 0) {
            await JobMetadataRepository.addEvidence(
                jobId,
                `APIs consumidas: ${apisResult.apis.join(", ")}`,
                { paths: apisResult.evidencePaths }
            );
        }

        return { controllersResult, servicesResult, modelsResult, componentsResult, apisResult };
    }

    async validateControllers(jobId: string): Promise<ControllerValidationResult> {
        const sourceDir = path.join(config.WORKDIR, jobId);
        const fileTree = buildFileTree(sourceDir, MAX_FILE_TREE_ENTRIES);

        const candidates = fileTree.filter((relativePath) => this.matchesControllerPattern(relativePath));

        if (candidates.length > 0) {
            return {
                valid: true,
                reason: `Found ${candidates.length} file(s) matching controller naming conventions.`,
                controllers: candidates,
            };
        }

        log(`No controller-like filenames found by convention for job ${jobId}, asking the model`);

        const prompt = [
            "You are inspecting a software repository's file structure to identify files that act as HTTP controllers",
            "(request handlers / endpoint definitions), regardless of the framework's specific terminology",
            "(e.g. Controllers in Spring/NestJS/Rails, Views in Django/Flask, Routes in Express).",
            "Project file structure (relative paths, possibly truncated):",
            "```",
            fileTreeForPrompt(fileTree),
            "```",
            "Identify which file paths, if any, are likely controllers/endpoint handlers.",
            'Respond with ONLY a JSON object, no extra text, in this exact shape: {"valid": true|false, "reason": "short explanation", "controllers": ["path1", "path2"]}',
        ].join("\n");

        const response = await IaPort.prompt(prompt, { maxTokens: 200, temperature: 0 });

        return this.parseControllerResponse(response);
    }

    async validateServices(jobId: string): Promise<ServiceValidationResult> {
        const sourceDir = path.join(config.WORKDIR, jobId);
        const fileTree = buildFileTree(sourceDir, MAX_FILE_TREE_ENTRIES);

        const candidates = fileTree.filter((relativePath) => this.matchesServicePattern(relativePath));

        if (candidates.length > 0) {
            return {
                valid: true,
                reason: `Found ${candidates.length} file(s) matching service naming conventions.`,
                services: candidates,
            };
        }

        log(`No service-like filenames found by convention for job ${jobId}, asking the model`);

        const prompt = [
            "You are inspecting a software repository's file structure to identify files that act as the business-logic/service layer",
            "(the layer that sits between controllers/endpoints and data access, orchestrating business rules),",
            "regardless of the framework's specific terminology.",
            "Project file structure (relative paths, possibly truncated):",
            "```",
            fileTreeForPrompt(fileTree),
            "```",
            "Identify which file paths, if any, are likely part of the service/business-logic layer.",
            'Respond with ONLY a JSON object, no extra text, in this exact shape: {"valid": true|false, "reason": "short explanation", "services": ["path1", "path2"]}',
        ].join("\n");

        const response = await IaPort.prompt(prompt, { maxTokens: 200, temperature: 0 });

        return this.parseServiceResponse(response);
    }

    async validateModels(jobId: string): Promise<ModelValidationResult> {
        const sourceDir = path.join(config.WORKDIR, jobId);
        const fileTree = buildFileTree(sourceDir, MAX_FILE_TREE_ENTRIES);

        const candidates = fileTree.filter((relativePath) => this.matchesModelPattern(relativePath));

        if (candidates.length > 0) {
            return {
                valid: true,
                reason: `Found ${candidates.length} file(s) matching model/entity naming conventions.`,
                models: candidates,
            };
        }

        log(`No model-like filenames found by convention for job ${jobId}, asking the model`);

        const prompt = [
            "You are inspecting a software repository's file structure to identify files that define data models/entities",
            "(the classes/structures representing the domain data, regardless of the framework's specific terminology).",
            "Project file structure (relative paths, possibly truncated):",
            "```",
            fileTreeForPrompt(fileTree),
            "```",
            "Identify which file paths, if any, are likely data models/entities.",
            'Respond with ONLY a JSON object, no extra text, in this exact shape: {"valid": true|false, "reason": "short explanation", "models": ["path1", "path2"]}',
        ].join("\n");

        const response = await IaPort.prompt(prompt, { maxTokens: 200, temperature: 0 });

        return this.parseModelResponse(response);
    }

    async validateComponents(jobId: string, framework: string): Promise<FrameworkComponentValidationResult> {
        const sourceDir = path.join(config.WORKDIR, jobId);
        const fileTree = buildFileTree(sourceDir, MAX_FILE_TREE_ENTRIES);

        const categoryPatterns = this.resolveFrameworkPatterns(framework);

        if (categoryPatterns) {
            const foundCategories: string[] = [];

            for (const [category, patterns] of Object.entries(categoryPatterns)) {
                const hasMatch = fileTree.some((relativePath) => {
                    const normalized = relativePath.replace(/\\/g, "/");
                    return patterns.some((pattern) => pattern.test(normalized));
                });
                if (hasMatch) {
                    foundCategories.push(category);
                }
            }

            if (foundCategories.length > 0) {
                return {
                    valid: true,
                    reason: `Found framework-specific components for ${framework}: ${foundCategories.join(", ")}`,
                    components: foundCategories,
                };
            }
        }

        log(`No known component patterns for framework "${framework}" (or none matched) for job ${jobId}, asking the model`);

        const prompt = [
            `You are inspecting a software repository built with the "${framework}" framework.`,
            "List the framework-specific architectural component types this repository actually uses",
            "(e.g. for Angular: Modules, Components, Directives, Pipes, Guards; for NestJS: Modules, Guards, Interceptors, DTOs; for Spring Boot: Repositories, Configuration classes; etc.),",
            "based on the file structure below.",
            "Project file structure (relative paths, possibly truncated):",
            "```",
            fileTreeForPrompt(fileTree),
            "```",
            'Respond with ONLY a JSON object, no extra text, in this exact shape: {"valid": true|false, "reason": "short explanation", "components": ["CategoryName1", "CategoryName2"]}',
        ].join("\n");

        const response = await IaPort.prompt(prompt, { maxTokens: 200, temperature: 0 });

        return this.parseComponentsResponse(response);
    }

    async validateApis(jobId: string): Promise<ApiValidationResult> {
        const sourceDir = path.join(config.WORKDIR, jobId);
        const fileTree = buildFileTree(sourceDir, MAX_FILES_SCANNED);

        const evidenceFiles = new Set<string>();
        const urls = new Set<string>();

        for (const relativePath of fileTree) {
            if (LOCK_FILE_NAMES.has(path.basename(relativePath))) {
                continue;
            }

            const content = this.readFileSafely(path.join(sourceDir, relativePath));
            if (content === null) {
                continue;
            }

            let fileHasEvidence = HTTP_CLIENT_PATTERNS.some((pattern) => pattern.test(content));

            if (urls.size < MAX_URLS_COLLECTED) {
                const matches = content.match(URL_PATTERN) ?? [];
                for (const match of matches) {
                    const cleaned = match.replace(/[.,;:)\]"'`]+$/, "");
                    if (!URL_NOISE_PATTERNS.some((pattern) => pattern.test(cleaned))) {
                        urls.add(cleaned);
                        fileHasEvidence = true;
                        if (urls.size >= MAX_URLS_COLLECTED) {
                            break;
                        }
                    }
                }
            }

            if (fileHasEvidence && evidenceFiles.size < MAX_CLIENT_FILES_COLLECTED) {
                evidenceFiles.add(relativePath);
            }
        }

        if (evidenceFiles.size === 0 && urls.size === 0) {
            return {
                valid: false,
                reason: "No outbound HTTP client usage or external URLs were found in the source.",
                apis: [],
                evidencePaths: [],
            };
        }

        log(`Found ${evidenceFiles.size} file(s) with API-consumption evidence and ${urls.size} candidate external URL(s) for job ${jobId}`);

        const prompt = [
            "You are analyzing a software repository to identify external APIs/services it consumes (calls out to),",
            "as opposed to endpoints it exposes itself.",
            evidenceFiles.size > 0
                ? `Files using an HTTP client library: ${Array.from(evidenceFiles).join(", ")}`
                : "No files matched known HTTP client library patterns.",
            urls.size > 0
                ? `Candidate external URLs found in the source: ${Array.from(urls).join(", ")}`
                : "No external URLs were found as literals in the source.",
            "Based on this evidence, list the distinct external APIs/services this project appears to consume",
            '(deduplicate, ignore registries/tooling/package-manager URLs, give each a short recognizable name, e.g. "GitHub REST API", "Stripe Payments API").',
            "If the evidence is inconclusive, say so.",
            'Respond with ONLY a JSON object, no extra text, in this exact shape: {"valid": true|false, "reason": "short explanation", "apis": ["API name 1", "API name 2"]}',
        ].join("\n");

        const response = await IaPort.prompt(prompt, { maxTokens: 200, temperature: 0 });

        const result = this.parseApisResponse(response);
        return { ...result, evidencePaths: Array.from(evidenceFiles) };
    }

    private readFileSafely(fullPath: string): string | null {
        try {
            const stats = fs.statSync(fullPath);
            if (stats.size > MAX_FILE_SIZE_BYTES) {
                return null;
            }
            return fs.readFileSync(fullPath, "utf-8");
        } catch (error) {
            return null;
        }
    }

    private parseApisResponse(response: string): Omit<ApiValidationResult, "evidencePaths"> {
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
            return {
                valid: Boolean(parsed.valid),
                reason: String(parsed.reason ?? ""),
                apis: Array.isArray(parsed.apis) ? parsed.apis.map(String) : [],
            };
        } catch (error) {
            log(`Failed to parse model response as JSON: ${response}`);
            return {
                valid: false,
                reason: `Model response could not be parsed: ${response.slice(0, 200)}`,
                apis: [],
            };
        }
    }

    private matchesControllerPattern(relativePath: string): boolean {
        const normalized = relativePath.replace(/\\/g, "/");
        return CONTROLLER_PATTERNS.some((pattern) => pattern.test(normalized));
    }

    private matchesServicePattern(relativePath: string): boolean {
        const normalized = relativePath.replace(/\\/g, "/");
        return SERVICE_PATTERNS.some((pattern) => pattern.test(normalized));
    }

    private matchesModelPattern(relativePath: string): boolean {
        const normalized = relativePath.replace(/\\/g, "/");
        return MODEL_PATTERNS.some((pattern) => pattern.test(normalized));
    }

    private resolveFrameworkPatterns(framework: string): Record<string, RegExp[]> | null {
        const normalizedFramework = framework.toLowerCase();
        for (const [key, patterns] of Object.entries(FRAMEWORK_COMPONENT_PATTERNS)) {
            if (normalizedFramework.includes(key.toLowerCase())) {
                return patterns;
            }
        }
        return null;
    }

    private parseComponentsResponse(response: string): FrameworkComponentValidationResult {
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
            return {
                valid: Boolean(parsed.valid),
                reason: String(parsed.reason ?? ""),
                components: Array.isArray(parsed.components) ? parsed.components.map(String) : [],
            };
        } catch (error) {
            log(`Failed to parse model response as JSON: ${response}`);
            return {
                valid: false,
                reason: `Model response could not be parsed: ${response.slice(0, 200)}`,
                components: [],
            };
        }
    }

    private parseModelResponse(response: string): ModelValidationResult {
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
            return {
                valid: Boolean(parsed.valid),
                reason: String(parsed.reason ?? ""),
                models: Array.isArray(parsed.models) ? parsed.models.map(String) : [],
            };
        } catch (error) {
            log(`Failed to parse model response as JSON: ${response}`);
            return {
                valid: false,
                reason: `Model response could not be parsed: ${response.slice(0, 200)}`,
                models: [],
            };
        }
    }

    private parseServiceResponse(response: string): ServiceValidationResult {
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
            return {
                valid: Boolean(parsed.valid),
                reason: String(parsed.reason ?? ""),
                services: Array.isArray(parsed.services) ? parsed.services.map(String) : [],
            };
        } catch (error) {
            log(`Failed to parse model response as JSON: ${response}`);
            return {
                valid: false,
                reason: `Model response could not be parsed: ${response.slice(0, 200)}`,
                services: [],
            };
        }
    }

    private parseControllerResponse(response: string): ControllerValidationResult {
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
            return {
                valid: Boolean(parsed.valid),
                reason: String(parsed.reason ?? ""),
                controllers: Array.isArray(parsed.controllers) ? parsed.controllers.map(String) : [],
            };
        } catch (error) {
            log(`Failed to parse model response as JSON: ${response}`);
            return {
                valid: false,
                reason: `Model response could not be parsed: ${response.slice(0, 200)}`,
                controllers: [],
            };
        }
    }
}
