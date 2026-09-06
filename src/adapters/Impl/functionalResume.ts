import fs from "fs";
import path from "path";
import debug from "debug";
import { FunctionalResumeFactory } from "../../domain/models/factoryImpl/functionalResumeFactory";
import { findManifest, findReadme, buildFileTree, fileTreeForPrompt } from "../../domain/sourceInspector";
import JobMetadataRepository from "../../domain/jobMetadataRepository";
import IaPort from "../../ports/iaPort/ia.port";
import config from "../../config";

const log: debug.IDebugger = debug("app:functionalResumeImpl");

const MAX_FILE_TREE_ENTRIES = 300;
const MAX_README_CHARS = 1500;
const MAX_MANIFEST_CHARS = 1200;

export class FunctionalResumeImpl implements FunctionalResumeFactory {
    constructor() {
    }

    async execute(jobId: string): Promise<any> {
        const summary = await this.getFunctionalResume(jobId);

        await JobMetadataRepository.upsertMetadata(jobId, {
            functionalAnalysis: { summary },
        });

        return { summary };
    }

    async getFunctionalResume(jobId: string): Promise<string> {
        const sourceDir = path.join(config.WORKDIR, jobId);
        if (!fs.existsSync(sourceDir)) {
            throw new Error(`Source directory not found: ${sourceDir}`);
        }

        const metadata = await JobMetadataRepository.getMetadata(jobId);
        const generalInfo = metadata?.generalInfo;

        const readme = findReadme(sourceDir);
        const manifest = findManifest(sourceDir);
        const fileTree = buildFileTree(sourceDir, MAX_FILE_TREE_ENTRIES);

        log(`Generating functional summary for job ${jobId} (${fileTree.length} files scanned, readme=${Boolean(readme)}, manifest=${manifest?.file ?? "none"})`);

        const promptParts: string[] = [
            "You are writing a short functional summary of a software repository for a technical audience.",
            generalInfo
                ? `Known project info: name="${generalInfo.projectName}", main language=${generalInfo.mainLanguage}, main framework=${generalInfo.mainFramework}, approx. file count=${generalInfo.approxFileCount}.`
                : "No prior project metadata is available.",
        ];

        if (readme) {
            promptParts.push("README content:", "```", readme.slice(0, MAX_README_CHARS), "```");
        }

        if (manifest) {
            promptParts.push(`Manifest file (${manifest.file}):`, "```", manifest.content.slice(0, MAX_MANIFEST_CHARS), "```");
        }

        promptParts.push(
            "Project file structure (relative paths, possibly truncated):",
            "```",
            fileTreeForPrompt(fileTree),
            "```"
        );

        promptParts.push(
            "Based only on the information above, write a concise functional summary (2 to 4 sentences) describing:",
            "what the application does, its main domain/entities, the key operations it exposes (e.g. create, read, update, delete, search),",
            "and the main technologies/stack it relies on (framework, database, protocol).",
            'Example style: "Esta aplicacion es una API REST para gestion de clientes que permite crear, consultar, actualizar registros mediante Spring Boot y PostgreSQL."',
            "Respond with ONLY the summary text, in Spanish, no extra commentary, no JSON, no markdown."
        );

        const prompt = promptParts.join("\n");

        const summary = await IaPort.prompt(prompt, { maxTokens: 180, temperature: 0.3 });

        return summary.trim();
    }
}
