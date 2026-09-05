import DataBasePort from "../ports/dataBasePort/dataBase.port";
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

        await DataBasePort.setItem(
            { PK: buildJobPK(jobId), SK: buildEvidenceSK(evidenceNumber) },
            { label, ...options }
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
