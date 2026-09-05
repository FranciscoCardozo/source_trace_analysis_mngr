export type JobStatus = "in_progress" | "completed" | "failed";

export interface GeneralInfo {
    projectName: string;
    mainLanguage: string;
    mainFramework: string;
    approxFileCount: number;
}

export interface FunctionalAnalysis {
    summary: string;
}

export interface JobMetadata {
    PK: string;
    SK: "METADATA";
    status: JobStatus;
    createdAt: string;
    updatedAt: string;
    generalInfo?: GeneralInfo;
    functionalAnalysis?: FunctionalAnalysis;
    componentsIdentified?: string[];
    apisConsumed?: string[];
    architecturePattern?: string;
    architectureDiagram?: string;
}

export interface JobEvidence {
    PK: string;
    SK: string;
    label: string;
    paths?: string[];
    s3Key?: string;
}

export const METADATA_SK = "METADATA";

export function buildJobPK(jobId: string): string {
    return `JOB#${jobId}`;
}

export function buildEvidenceSK(evidenceNumber: number): string {
    return `EVIDENCE#${evidenceNumber}`;
}
