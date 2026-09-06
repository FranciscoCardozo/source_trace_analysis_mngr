import fs from "fs";
import path from "path";
import debug from "debug";
import { BasicAnalysisFactory, ValidationResult, LanguageValidationResult, FrameworkValidationResult, ContentValidationResult } from "../../domain/models/factoryImpl/basicAnalysisFactory";
import { SourceType } from "../../domain/models/source/sourceType.enum";
import GetSourcePort from "../../ports/getSourcePort/getSource.port";
import { BucketPort } from "../../ports/bucketPort/bucket.port";
import IaPort from "../../ports/iaPort/ia.port";
import JobMetadataRepository from "../../domain/jobMetadataRepository";
import { MANIFEST_FILES, IGNORED_DIRS, findManifest } from "../../domain/sourceInspector";
import config from "../../config";

const log: debug.IDebugger = debug("app:basicAnalysisImpl");

const MANIFEST_EXPECTED_LANGUAGES: Record<string, string[]> = {
    "package.json": ["JavaScript", "TypeScript"],
    "pyproject.toml": ["Python"],
    "setup.py": ["Python"],
    "pom.xml": ["Java", "Kotlin"],
    "build.gradle": ["Java", "Kotlin"],
    "go.mod": ["Go"],
    "Cargo.toml": ["Rust"],
    "composer.json": ["PHP"],
};

const LANGUAGE_EXTENSIONS: Record<string, string> = {
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".py": "Python",
    ".java": "Java",
    ".kt": "Kotlin",
    ".kts": "Kotlin",
    ".go": "Go",
    ".rs": "Rust",
    ".php": "PHP",
    ".rb": "Ruby",
    ".cs": "C#",
    ".cpp": "C++",
    ".cc": "C++",
    ".cxx": "C++",
    ".c": "C",
    ".swift": "Swift",
};

const NPM_FRAMEWORK_MAP: Record<string, string> = {
    "react": "React",
    "react-dom": "React",
    "next": "Next.js",
    "@angular/core": "Angular",
    "vue": "Vue",
    "nuxt": "Nuxt",
    "svelte": "Svelte",
    "@sveltejs/kit": "SvelteKit",
    "express": "Express",
    "@nestjs/core": "NestJS",
    "fastify": "Fastify",
    "koa": "Koa",
    "@hapi/hapi": "Hapi",
};

const JAVA_FRAMEWORK_MARKERS: Record<string, string> = {
    "spring-boot-starter": "Spring Boot",
    "spring-webmvc": "Spring MVC",
    "spring-core": "Spring Framework",
    "quarkus": "Quarkus",
    "micronaut": "Micronaut",
    "vertx-core": "Vert.x",
    "io.vertx": "Vert.x",
    "jersey": "JAX-RS (Jersey)",
    "javax.ws.rs": "JAX-RS",
    "struts2": "Struts",
    "grails": "Grails",
    "dropwizard": "Dropwizard",
};

export class BasicAnalysisImpl implements BasicAnalysisFactory {
    constructor() {
    }

    async execute(jobId: string): Promise<any> {
        const nameResult = await this.validateName(jobId);
        const languageResult = await this.validateLanguage(jobId);
        const frameworkResult = await this.validateFrameWork(jobId);
        const contentResult = await this.ValidateContent(jobId);

        await JobMetadataRepository.upsertMetadata(jobId, {
            generalInfo: {
                projectName: this.resolveExpectedName(),
                mainLanguage: languageResult.detectedLanguage,
                mainFramework: frameworkResult.detectedFramework,
                approxFileCount: contentResult.fileCount,
            },
        });

        return { nameResult, languageResult, frameworkResult, contentResult };
    }

    async validateName(jobId: string): Promise<ValidationResult> {
        const sourceDir = path.join(config.WORKDIR, jobId);
        const expectedName = this.resolveExpectedName();

        const manifest = findManifest(sourceDir);
        if (!manifest) {
            return {
                valid: false,
                reason: `No project manifest file found in ${sourceDir} (looked for: ${MANIFEST_FILES.join(", ")})`,
            };
        }

        log(`Validating project name against manifest: ${manifest.file}`);

        const prompt = [
            `You are validating a software project's declared name against its repository name.`,
            `Expected repository name: "${expectedName}".`,
            `Manifest file: ${manifest.file}`,
            "Manifest content:",
            "```",
            manifest.content.slice(0, 2000),
            "```",
            "Determine if the project name declared in the manifest is consistent with the expected repository name",
            "(allow reasonable differences like case, separators, scoped npm package prefixes, or organization prefixes).",
            'Respond with ONLY a JSON object, no extra text, in this exact shape: {"valid": true|false, "reason": "short explanation"}',
        ].join("\n");

        const response = await IaPort.prompt(prompt, { maxTokens: 120, temperature: 0 });

        return this.parseValidationResponse(response);
    }

    async validateLanguage(jobId: string): Promise<LanguageValidationResult> {
        const sourceDir = path.join(config.WORKDIR, jobId);
        if (!fs.existsSync(sourceDir)) {
            throw new Error(`Source directory not found: ${sourceDir}`);
        }

        const languageCounts = this.countLanguages(sourceDir);
        const sortedLanguages = Object.entries(languageCounts).sort((a, b) => b[1] - a[1]);

        if (sortedLanguages.length === 0) {
            return {
                valid: false,
                reason: `No recognizable source files found in ${sourceDir}`,
                detectedLanguage: "unknown",
            };
        }

        const [detectedLanguage] = sortedLanguages[0];
        const manifest = findManifest(sourceDir);

        if (!manifest) {
            return {
                valid: true,
                reason: `Detected ${detectedLanguage} as the dominant language by file count (no manifest found to cross-check).`,
                detectedLanguage,
            };
        }

        const expectedLanguages = MANIFEST_EXPECTED_LANGUAGES[manifest.file] ?? [];
        log(`Validating detected language (${detectedLanguage}) against manifest: ${manifest.file}`);

        const prompt = [
            "You are validating whether a repository's dominant programming language is consistent with its project manifest.",
            `Manifest file found: ${manifest.file} (implies one of: ${expectedLanguages.join(", ") || "unknown"}).`,
            `File-extension breakdown (file count per detected language): ${JSON.stringify(Object.fromEntries(sortedLanguages))}`,
            `Dominant detected language: ${detectedLanguage}.`,
            "Determine if the dominant language is consistent with what the manifest implies",
            "(a secondary language with fewer files, e.g. config/test scripts, does not make it invalid).",
            'Respond with ONLY a JSON object, no extra text, in this exact shape: {"valid": true|false, "reason": "short explanation"}',
        ].join("\n");

        const response = await IaPort.prompt(prompt, { maxTokens: 120, temperature: 0 });
        const verdict = this.parseValidationResponse(response);

        return { ...verdict, detectedLanguage };
    }

    async validateFrameWork(jobId: string): Promise<FrameworkValidationResult> {
        const sourceDir = path.join(config.WORKDIR, jobId);
        const manifest = findManifest(sourceDir);

        if (!manifest) {
            return {
                valid: false,
                reason: `No project manifest file found in ${sourceDir} (looked for: ${MANIFEST_FILES.join(", ")})`,
                detectedFramework: "unknown",
            };
        }

        if (manifest.file === "package.json") {
            const candidates = this.detectFrameworksFromPackageJson(manifest.content);
            if (candidates.length > 0) {
                return {
                    valid: true,
                    reason: `Detected framework dependencies in package.json: ${candidates.join(", ")}`,
                    detectedFramework: candidates.join(", "),
                };
            }
        }

        if (manifest.file === "pom.xml" || manifest.file === "build.gradle") {
            const candidates = this.detectFrameworksByMarkers(manifest.content, JAVA_FRAMEWORK_MARKERS);
            if (candidates.length > 0) {
                return {
                    valid: true,
                    reason: `Detected framework markers in ${manifest.file}: ${candidates.join(", ")}`,
                    detectedFramework: candidates.join(", "),
                };
            }
        }

        log(`Asking the model to identify the framework from manifest: ${manifest.file}`);

        const prompt = [
            "You are identifying which software framework a project uses, based on its project manifest.",
            `Manifest file: ${manifest.file}`,
            "Manifest content:",
            "```",
            manifest.content.slice(0, 2000),
            "```",
            "Identify the main application framework in use (e.g. Angular, React, Vue, Express, NestJS, Django, Flask, Spring Boot, etc.).",
            'If no recognizable framework is used, set "framework" to "none".',
            'Respond with ONLY a JSON object, no extra text, in this exact shape: {"valid": true|false, "reason": "short explanation", "framework": "name or none"}',
        ].join("\n");

        const response = await IaPort.prompt(prompt, { maxTokens: 150, temperature: 0 });

        return this.parseFrameworkResponse(response);
    }

    private detectFrameworksFromPackageJson(content: string): string[] {
        try {
            const pkg = JSON.parse(content);
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            const detected = new Set<string>();

            for (const depName of Object.keys(deps)) {
                const framework = NPM_FRAMEWORK_MAP[depName];
                if (framework) {
                    detected.add(framework);
                }
            }

            return Array.from(detected);
        } catch (error) {
            log(`Failed to parse package.json while detecting framework: ${error}`);
            return [];
        }
    }

    private detectFrameworksByMarkers(content: string, markers: Record<string, string>): string[] {
        const detected = new Set<string>();

        for (const [marker, framework] of Object.entries(markers)) {
            if (content.includes(marker)) {
                detected.add(framework);
            }
        }

        return Array.from(detected);
    }

    private parseFrameworkResponse(response: string): FrameworkValidationResult {
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
            return {
                valid: Boolean(parsed.valid),
                reason: String(parsed.reason ?? ""),
                detectedFramework: String(parsed.framework ?? "unknown"),
            };
        } catch (error) {
            log(`Failed to parse model response as JSON: ${response}`);
            return {
                valid: false,
                reason: `Model response could not be parsed: ${response.slice(0, 200)}`,
                detectedFramework: "unknown",
            };
        }
    }

    private countLanguages(sourceDir: string): Record<string, number> {
        const counts: Record<string, number> = {};

        const walk = (currentDir: string): void => {
            const entries = fs.readdirSync(currentDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    if (!IGNORED_DIRS.has(entry.name)) {
                        walk(path.join(currentDir, entry.name));
                    }
                    continue;
                }

                const extension = path.extname(entry.name).toLowerCase();
                const language = LANGUAGE_EXTENSIONS[extension];
                if (language) {
                    counts[language] = (counts[language] ?? 0) + 1;
                }
            }
        };

        walk(sourceDir);
        return counts;
    }

    async ValidateContent(jobId: string): Promise<ContentValidationResult> {
        const sourceDir = path.join(config.WORKDIR, jobId);
        if (!fs.existsSync(sourceDir)) {
            throw new Error(`Source directory not found: ${sourceDir}`);
        }

        const { fileCount, folderCount } = this.countFilesAndFolders(sourceDir);

        if (fileCount === 0) {
            return {
                valid: false,
                reason: `No files found in ${sourceDir}`,
                fileCount,
                folderCount,
            };
        }

        return {
            valid: true,
            reason: `Found ${fileCount} files across ${folderCount} folders`,
            fileCount,
            folderCount,
        };
    }

    private countFilesAndFolders(sourceDir: string): { fileCount: number; folderCount: number } {
        let fileCount = 0;
        let folderCount = 0;

        const walk = (currentDir: string): void => {
            const entries = fs.readdirSync(currentDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    if (!IGNORED_DIRS.has(entry.name)) {
                        folderCount += 1;
                        walk(path.join(currentDir, entry.name));
                    }
                    continue;
                }
                fileCount += 1;
            }
        };

        walk(sourceDir);
        return { fileCount, folderCount };
    }

    private resolveExpectedName(): string {
        if (config.SOURCE_TYPE === SourceType.GIT) {
            return GetSourcePort.parseGitUrl(config.SOURCE_URL).repo;
        }

        if (config.SOURCE_TYPE === SourceType.S3) {
            const { key } = BucketPort.parseS3Url(config.SOURCE_URL);
            return path.basename(key).replace(/\.(zip|tar\.gz|tgz|tar)$/i, "");
        }

        throw new Error(`Unsupported SOURCE_TYPE: ${config.SOURCE_TYPE}`);
    }

    private parseValidationResponse(response: string): ValidationResult {
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
            return {
                valid: Boolean(parsed.valid),
                reason: String(parsed.reason ?? ""),
            };
        } catch (error) {
            log(`Failed to parse model response as JSON: ${response}`);
            return {
                valid: false,
                reason: `Model response could not be parsed: ${response.slice(0, 200)}`,
            };
        }
    }
}
