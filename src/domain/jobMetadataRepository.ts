import DataBasePort from "../ports/dataBasePort/dataBase.port";
import { BucketPort } from "../ports/bucketPort/bucket.port";
import config from "../config";
import {
    JobMetadata,
    JobEvidence,
    buildJobPK,
    buildEvidenceSK,
    METADATA_SK,
} from "./models/dynamo/jobMetadata.interface";

type MetadataPatch = Partial<Omit<JobMetadata, "PK" | "SK" | "createdAt" | "updatedAt">>;
type EvidenceOptions = Pick<JobEvidence, "paths" | "s3Key">;

export default class JobMetadataRepository {
    constructor() {
    }

    static async upsertMetadata(jobId: string, patch: MetadataPatch): Promise<void> {
        const now = new Date().toISOString();
        const fields: Record<string, any> = {
            status: "in_progress",
            ...patch,
        };

        const setParts = ["createdAt = if_not_exists(createdAt, :createdAt)", "#updatedAt = :updatedAt"];
        const expressionAttributeNames: Record<string, string> = { "#updatedAt": "updatedAt" };
        const expressionAttributeValues: Record<string, any> = { ":createdAt": now, ":updatedAt": now };

        Object.entries(fields).forEach(([field, value], index) => {
            const nameKey = `#f${index}`;
            const valueKey = `:v${index}`;
            setParts.push(`${nameKey} = ${valueKey}`);
            expressionAttributeNames[nameKey] = field;
            expressionAttributeValues[valueKey] = value;
        });

        await DataBasePort.updateItem(
            { PK: buildJobPK(jobId), SK: METADATA_SK },
            `SET ${setParts.join(", ")}`,
            expressionAttributeNames,
            expressionAttributeValues
        );
    }

    static async addEvidence(jobId: string, label: string, options: EvidenceOptions = {}): Promise<number> {
        const evidenceNumber = await this.nextEvidenceNumber(jobId);
        let s3Key = options.s3Key;

        // Render path-based evidence (no s3Key of its own, e.g. Controllers/Services/
        // Models/APIs/architecture findings) as an image and upload it to the results
        // bucket, so every evidence item saved in Dynamo has a matching image in S3 -
        // not just the ones (like the architecture diagram) that already upload their
        // own file. Dynamo keeps the raw label/paths data; S3 gets the visual.
        if (!s3Key && options.paths && options.paths.length > 0 && config.RESULTS_BUCKET) {
            s3Key = `results/${jobId}/evidence-${evidenceNumber}.svg`;
            const svg = buildEvidenceListSvg(label, options.paths);
            await BucketPort.uploadObject(config.RESULTS_BUCKET, s3Key, svg, "image/svg+xml");
        }

        await DataBasePort.setItem(
            { PK: buildJobPK(jobId), SK: buildEvidenceSK(evidenceNumber) },
            { label, ...options, ...(s3Key ? { s3Key } : {}) }
        );

        return evidenceNumber;
    }

    private static async nextEvidenceNumber(jobId: string): Promise<number> {
        const result: any = await DataBasePort.updateItem(
            { PK: buildJobPK(jobId), SK: METADATA_SK },
            "ADD evidenceCount :incr",
            {},
            { ":incr": 1 }
        );

        return result?.Attributes?.evidenceCount ?? 1;
    }

    static async getMetadata(jobId: string): Promise<JobMetadata | null> {
        const result: any = await DataBasePort.getItems({ PK: buildJobPK(jobId), SK: METADATA_SK });
        const items: JobMetadata[] = result?.Items ?? [];
        return items[0] ?? null;
    }

    static async getEvidence(jobId: string): Promise<JobEvidence[]> {
        const result: any = await DataBasePort.getItems({ PK: buildJobPK(jobId) });
        const items: any[] = result?.Items ?? [];
        return items.filter((item) => item.SK !== METADATA_SK) as JobEvidence[];
    }
}

const MAX_LIST_ITEMS = 40;
const MAX_LINE_CHARS = 95;

function escapeSvgText(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncateLine(value: string): string {
    return value.length > MAX_LINE_CHARS ? `${value.slice(0, MAX_LINE_CHARS - 3)}...` : value;
}

function buildEvidenceListSvg(title: string, items: string[]): string {
    const shown = items.slice(0, MAX_LIST_ITEMS).map(truncateLine);
    const overflowCount = items.length - shown.length;

    const width = 720;
    const headerHeight = 48;
    const padding = 18;
    const lineHeight = 20;
    const rowCount = shown.length + (overflowCount > 0 ? 1 : 0);
    const height = headerHeight + padding * 2 + rowCount * lineHeight;

    const rows = shown.map((item, index) => {
        const y = headerHeight + padding + index * lineHeight + 13;
        return `<text x="${padding + 8}" y="${y}" font-family="monospace" font-size="12.5" fill="#334155">- ${escapeSvgText(item)}</text>`;
    });

    if (overflowCount > 0) {
        const y = headerHeight + padding + shown.length * lineHeight + 13;
        rows.push(`<text x="${padding + 8}" y="${y}" font-family="sans-serif" font-size="12" font-style="italic" fill="#94a3b8">... y ${overflowCount} mas</text>`);
    }

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        `  <rect width="100%" height="100%" fill="#ffffff" />`,
        `  <rect x="0" y="0" width="${width}" height="${headerHeight}" fill="#eef3ff" />`,
        `  <text x="${padding}" y="30" font-family="sans-serif" font-size="17" font-weight="bold" fill="#1f2d3d">${escapeSvgText(title)} (${items.length})</text>`,
        `  ${rows.join("\n  ")}`,
        `  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="none" stroke="#cbd5e1" stroke-width="1" />`,
        `</svg>`,
    ].join("\n");
}
