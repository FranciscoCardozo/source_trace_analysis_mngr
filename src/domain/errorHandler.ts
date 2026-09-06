import { SourceValidationError } from "./models/errors/sourceValidationError";

export default class ErrorHandler {
    constructor() {
    }

    // --- Source validation (getSourceImpl.validateSource) ---

    static missingJobId(): SourceValidationError {
        return new SourceValidationError("jobId is required");
    }

    static missingSourceUrl(): SourceValidationError {
        return new SourceValidationError("url is required and must be a non-empty string");
    }

    static invalidSourceType(received: string, validTypes: string[]): SourceValidationError {
        return new SourceValidationError(`type must be one of: ${validTypes.join(", ")}, received: ${received}`);
    }

    static invalidGitUrl(url: string): SourceValidationError {
        return new SourceValidationError(`url does not look like a valid git repository url: ${url}`);
    }

    static invalidS3Url(url: string): SourceValidationError {
        return new SourceValidationError(`url does not look like a valid s3 location: ${url}`);
    }

    // --- Configuration ---

    static unsupportedSourceType(sourceType: string): Error {
        return new Error(`Unsupported SOURCE_TYPE: ${sourceType}`);
    }

    static unknownJobType(jobType: string): Error {
        return new Error(`Unknown jobType: ${jobType}`);
    }

    static modelServiceNotConfigured(): Error {
        return new Error("MODEL_SERVICE_URL is not configured");
    }

    // --- External services / IO ---

    static modelServiceError(status: number, statusText: string, body: string): Error {
        return new Error(`Model service responded with ${status} ${statusText}: ${body}`);
    }

    static unexpectedModelResponse(rawResponse: unknown): Error {
        return new Error(`Unexpected model response shape: ${JSON.stringify(rawResponse).slice(0, 300)}`);
    }

    static unableToParseGitUrl(url: string): Error {
        return new Error(`Unable to parse git repository url: ${url}`);
    }

    static repositoryDownloadFailed(owner: string, repo: string, ref: string, status: number, statusText: string): Error {
        return new Error(`Failed to download repository ${owner}/${repo}@${ref}: ${status} ${statusText}`);
    }

    static unableToParseS3Url(url: string): Error {
        return new Error(`Unable to parse S3 url: ${url}`);
    }

    static emptyS3ResponseBody(bucket: string, key: string): Error {
        return new Error(`Empty response body for s3://${bucket}/${key}`);
    }

    static unsupportedArchiveFormat(archivePath: string): Error {
        return new Error(`Unsupported archive format: ${archivePath}`);
    }

    static sourceDirectoryNotFound(sourceDir: string): Error {
        return new Error(`Source directory not found: ${sourceDir}`);
    }
}
