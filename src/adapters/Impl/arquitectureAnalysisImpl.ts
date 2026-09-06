import fs from "fs";
import path from "path";
import debug from "debug";
import { ArquitectureAnalysisFactory, ArchitectureValidationResult } from "../../domain/models/factoryImpl/arquitectureAnalysisFactory";
import { buildFileTree, fileTreeForPrompt, MANIFEST_FILES } from "../../domain/sourceInspector";
import JobMetadataRepository from "../../domain/jobMetadataRepository";
import { JobMetadata, JobEvidence } from "../../domain/models/dynamo/jobMetadata.interface";
import IaPort from "../../ports/iaPort/ia.port";
import { BucketPort } from "../../ports/bucketPort/bucket.port";
import config from "../../config";

const log: debug.IDebugger = debug("app:arquitectureAnalysisImpl");

const MAX_FILE_TREE_ENTRIES = 1000;

const ARCHITECTURE_SIGNALS: Record<string, RegExp[]> = {
    "Hexagonal": [/(^|\/)ports(\/|$)/i, /(^|\/)adapters(\/|$)/i],
    "Clean Architecture": [/(^|\/)use[-_]?cases?(\/|$)/i, /(^|\/)entities(\/|$)/i],
    "N-Layer": [/(^|\/)presentation(\/|$)/i, /(^|\/)business(\/|$)/i, /(^|\/)data[-_]?access(\/|$)/i, /(^|\/)dal(\/|$)/i, /(^|\/)bll(\/|$)/i],
    "MVC": [/(^|\/)views(\/|$)/i],
};

const ARCHITECTURE_PATTERN_OPTIONS = [
    "Monolith", "MVC", "Clean Architecture", "Hexagonal", "Microservices", "N-Layer",
];

export class ArquitectureAnalysisImpl implements ArquitectureAnalysisFactory {
    constructor() {
    }

    async execute(jobId: string): Promise<any> {
        const patternsResult = await this.validatePatterns(jobId);

        if (patternsResult.evidencePaths.length > 0) {
            await JobMetadataRepository.addEvidence(
                jobId,
                `Arquitectura identificada: ${patternsResult.architecturePattern}`,
                { paths: patternsResult.evidencePaths }
            );
        }

        const metadata = await JobMetadataRepository.getMetadata(jobId);
        const evidence = await JobMetadataRepository.getEvidence(jobId);
        const diagram = this.buildArchitectureDiagram(patternsResult.architecturePattern, metadata, evidence);

        // Single upsertMetadata call: upsertMetadata defaults status to "in_progress"
        // on every call unless the patch says otherwise, so splitting this into two
        // calls (one for architecturePattern, a later one for architectureDiagram)
        // silently clobbered "completed" back to "in_progress" on the second call.
        await JobMetadataRepository.upsertMetadata(jobId, {
            architecturePattern: patternsResult.architecturePattern,
            architectureDiagram: diagram,
            status: "completed",
        });

        if (config.RESULTS_BUCKET) {
            const svg = this.buildArchitectureSvg(patternsResult.architecturePattern, metadata, evidence);
            const s3Key = `results/${jobId}/diagram-architecture.svg`;

            await BucketPort.uploadObject(config.RESULTS_BUCKET, s3Key, svg, "image/svg+xml");
            await JobMetadataRepository.addEvidence(jobId, "Diagrama de arquitectura (imagen)", { s3Key });
        } else {
            log(`RESULTS_BUCKET not configured, skipping architecture diagram image upload for job ${jobId}`);
        }

        await this.cleanupSource(jobId);

        return { patternsResult, diagram };
    }

    private async cleanupSource(jobId: string): Promise<void> {
        const sourceDir = path.join(config.WORKDIR, jobId);
        try {
            await fs.promises.rm(sourceDir, { recursive: true, force: true });
            log(`Cleaned up source directory for job ${jobId}: ${sourceDir}`);
        } catch (error) {
            log(`Failed to clean up source directory ${sourceDir}: ${error}`);
        }
    }

    async validatePatterns(jobId: string): Promise<ArchitectureValidationResult> {
        const sourceDir = path.join(config.WORKDIR, jobId);
        const fileTree = buildFileTree(sourceDir, MAX_FILE_TREE_ENTRIES);
        const metadata = await JobMetadataRepository.getMetadata(jobId);

        const { signals: detectedSignals, evidencePaths: signalPaths } = this.detectArchitectureSignals(fileTree);
        const manifestFiles = this.findManifestFiles(fileTree);
        const manifestLocations = Array.from(new Set(manifestFiles.map((relativePath) => path.dirname(relativePath))));
        const hasDockerCompose = fileTree.some((relativePath) => /docker-compose\.ya?ml$/i.test(relativePath));
        const evidencePaths = manifestLocations.length > 1 ? [...signalPaths, ...manifestFiles] : signalPaths;

        log(`Architecture signals for job ${jobId}: ${JSON.stringify(detectedSignals)}, manifests in ${manifestLocations.length} location(s), docker-compose=${hasDockerCompose}`);

        const promptParts: string[] = [
            "You are determining the architectural style of a software repository.",
            `Choose exactly one label from this set: ${ARCHITECTURE_PATTERN_OPTIONS.join(", ")}.`,
            "Use 'Microservices' only if there is clear evidence of multiple independently deployable services in this repository",
            "(e.g. multiple project manifests in separate top-level directories, or a docker-compose file defining several services).",
            "Otherwise prefer describing the internal code organization pattern of this single deployable unit.",
        ];

        if (metadata?.generalInfo) {
            promptParts.push(
                `Known project info: main language=${metadata.generalInfo.mainLanguage}, main framework=${metadata.generalInfo.mainFramework}, approx. file count=${metadata.generalInfo.approxFileCount}.`
            );
        }

        if (metadata?.componentsIdentified && metadata.componentsIdentified.length > 0) {
            promptParts.push(`Components already identified: ${metadata.componentsIdentified.join(", ")}.`);
        }

        if (detectedSignals.length > 0) {
            promptParts.push(`Folder-naming signals detected: ${detectedSignals.join(", ")}.`);
        }

        promptParts.push(
            `Project manifests found in ${manifestLocations.length} distinct top-level location(s)${manifestLocations.length > 0 ? `: ${manifestLocations.join(", ")}` : ""}.`,
            `docker-compose file present: ${hasDockerCompose}.`,
            "Project file structure (relative paths, possibly truncated):",
            "```",
            fileTreeForPrompt(fileTree),
            "```",
            'Respond with ONLY a JSON object, no extra text, in this exact shape: {"valid": true|false, "reason": "short explanation", "architecturePattern": "one label from the set above"}'
        );

        const prompt = promptParts.join("\n");

        const response = await IaPort.prompt(prompt, { maxTokens: 150, temperature: 0 });

        const result = this.parsePatternResponse(response);
        return { ...result, evidencePaths };
    }

    private detectArchitectureSignals(fileTree: string[]): { signals: string[]; evidencePaths: string[] } {
        const normalizedPaths = fileTree.map((relativePath) => relativePath.replace(/\\/g, "/"));
        const signals: string[] = [];
        const evidencePaths = new Set<string>();

        for (const [patternName, regexes] of Object.entries(ARCHITECTURE_SIGNALS)) {
            const matches = normalizedPaths.filter((relativePath) => regexes.some((regex) => regex.test(relativePath)));
            if (matches.length > 0) {
                signals.push(patternName);
                matches.forEach((match) => evidencePaths.add(match));
            }
        }

        return { signals, evidencePaths: Array.from(evidencePaths) };
    }

    private buildArchitectureDiagram(
        architecturePattern: string,
        metadata: JobMetadata | null,
        evidence: JobEvidence[]
    ): string {
        const projectName = metadata?.generalInfo?.projectName ?? "Project";
        const componentsIdentified = metadata?.componentsIdentified ?? [];
        const apisConsumed = metadata?.apisConsumed ?? [];

        const sanitize = (value: string, fallback: string): string => {
            const cleaned = value.replace(/[^a-zA-Z0-9_]/g, "_");
            return cleaned.length > 0 ? cleaned : fallback;
        };

        const lines: string[] = ["graph TD"];
        const rootId = sanitize(projectName, "Project");
        lines.push(`    ${rootId}["${projectName}<br/>(${architecturePattern})"]`);

        const layerOrder = ["Controllers", "Services", "Models"];
        let previousNodeId = rootId;

        for (const category of layerOrder) {
            const item = evidence.find((entry) => entry.label === `${category} identificados`);
            if (!item) {
                continue;
            }

            const nodeId = sanitize(category, category);
            const examples = (item.paths ?? []).slice(0, 3).map((filePath) => path.basename(filePath));
            const suffix = examples.length > 0 ? `<br/>${examples.join("<br/>")}` : "";
            lines.push(`    ${nodeId}["${category} (${item.paths?.length ?? 0})${suffix}"]`);
            lines.push(`    ${previousNodeId} --> ${nodeId}`);
            previousNodeId = nodeId;
        }

        const otherComponents = componentsIdentified.filter((component) => !layerOrder.includes(component));
        otherComponents.forEach((component, index) => {
            const nodeId = sanitize(`${component}_${index}`, `Component_${index}`);
            lines.push(`    ${nodeId}["${component}"]`);
            lines.push(`    ${rootId} -.-> ${nodeId}`);
        });

        apisConsumed.forEach((apiName, index) => {
            const nodeId = `API_${index}`;
            lines.push(`    ${nodeId}(["${apiName}"])`);
            lines.push(`    ${previousNodeId} -->|consumes| ${nodeId}`);
        });

        return lines.join("\n");
    }

    private buildArchitectureSvg(
        architecturePattern: string,
        metadata: JobMetadata | null,
        evidence: JobEvidence[]
    ): string {
        const projectName = metadata?.generalInfo?.projectName ?? "Project";
        const componentsIdentified = metadata?.componentsIdentified ?? [];
        const apisConsumed = metadata?.apisConsumed ?? [];
        const layerOrder = ["Controllers", "Services", "Models"];

        interface DiagramBox {
            title: string;
            subtitle?: string;
            dashed?: boolean;
        }

        const boxes: DiagramBox[] = [{ title: `${projectName} (${architecturePattern})` }];

        for (const category of layerOrder) {
            const item = evidence.find((entry) => entry.label === `${category} identificados`);
            if (!item) {
                continue;
            }
            const examples = (item.paths ?? []).slice(0, 3).map((filePath) => path.basename(filePath));
            boxes.push({
                title: `${category} (${item.paths?.length ?? 0})`,
                subtitle: examples.join(", ") || undefined,
            });
        }

        for (const component of componentsIdentified.filter((c) => !layerOrder.includes(c))) {
            boxes.push({ title: component, dashed: true });
        }

        for (const apiName of apisConsumed) {
            boxes.push({ title: apiName, subtitle: "external API", dashed: true });
        }

        const boxWidth = 420;
        const boxHeight = 64;
        const gapY = 36;
        const marginX = 30;
        const marginY = 30;
        const width = marginX * 2 + boxWidth;
        const height = marginY * 2 + boxes.length * boxHeight + Math.max(boxes.length - 1, 0) * gapY;
        const centerX = marginX + boxWidth / 2;

        const shapes: string[] = [];
        let y = marginY;
        let prevBottomY: number | null = null;

        boxes.forEach((box) => {
            if (prevBottomY !== null) {
                const dash = box.dashed ? ' stroke-dasharray="6,4"' : "";
                shapes.push(`<line x1="${centerX}" y1="${prevBottomY}" x2="${centerX}" y2="${y}" stroke="#6b7280" stroke-width="2" marker-end="url(#arrow)"${dash} />`);
            }
            shapes.push(this.renderSvgBox(marginX, y, boxWidth, boxHeight, box.title, box.subtitle));
            prevBottomY = y + boxHeight;
            y += boxHeight + gapY;
        });

        return [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
            `  <defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#6b7280"/></marker></defs>`,
            `  <rect width="100%" height="100%" fill="#ffffff" />`,
            `  ${shapes.join("\n  ")}`,
            `</svg>`,
        ].join("\n");
    }

    private renderSvgBox(x: number, y: number, w: number, h: number, title: string, subtitle?: string): string {
        const escape = (value: string): string =>
            value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        const truncatedSubtitle = subtitle && subtitle.length > 48 ? `${subtitle.slice(0, 45)}...` : subtitle;

        return [
            "<g>",
            `  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#eef3ff" stroke="#4a6fa5" stroke-width="1.5" />`,
            `  <text x="${x + w / 2}" y="${y + (truncatedSubtitle ? h / 2 - 6 : h / 2 + 5)}" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="#1f2d3d">${escape(title)}</text>`,
            truncatedSubtitle ? `  <text x="${x + w / 2}" y="${y + h / 2 + 15}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#5a6b7d">${escape(truncatedSubtitle)}</text>` : "",
            "</g>",
        ].filter(Boolean).join("\n");
    }

    private findManifestFiles(fileTree: string[]): string[] {
        return fileTree
            .map((relativePath) => relativePath.replace(/\\/g, "/"))
            .filter((relativePath) => MANIFEST_FILES.includes(path.basename(relativePath)));
    }

    private parsePatternResponse(response: string): Omit<ArchitectureValidationResult, "evidencePaths"> {
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
            return {
                valid: Boolean(parsed.valid),
                reason: String(parsed.reason ?? ""),
                architecturePattern: String(parsed.architecturePattern ?? "unknown"),
            };
        } catch (error) {
            log(`Failed to parse model response as JSON: ${response}`);
            return {
                valid: false,
                reason: `Model response could not be parsed: ${response.slice(0, 200)}`,
                architecturePattern: "unknown",
            };
        }
    }
}
