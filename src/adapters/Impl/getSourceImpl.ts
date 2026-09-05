import path from "path";
import { GetSourceFactory } from "../../domain/models/factoryImpl/getSourceFactory";
import { SourceRequest } from "../../domain/models/source/sourceRequest.interface";
import { SourceType } from "../../domain/models/source/sourceType.enum";
import { SourceValidationError } from "../../domain/models/errors/sourceValidationError";
import GetSourcePort from "../../ports/getSourcePort/getSource.port";
import { BucketPort } from "../../ports/bucketPort/bucket.port";
import JobMetadataRepository from "../../domain/jobMetadataRepository";
import config from "../../config";
import debug from "debug";

const log: debug.IDebugger = debug("app:getSourceImpl");

const GIT_URL_PATTERN = /^(https?:\/\/|git@)[\w.-]+[:/][\w.\-/]+?(\.git)?$/i;
const S3_URI_PATTERN = /^s3:\/\/[a-z0-9.-]{3,63}\/.+$/i;
const S3_HTTPS_PATTERN = /^https:\/\/[a-z0-9.-]+\.s3[.-][a-z0-9-]*\.amazonaws\.com\/.+$/i;

export class GetSourceImpl implements GetSourceFactory {
    constructor() {

    }

    async execute(jobId: string): Promise<any> {
        log(`Executing get source for job: ${jobId}`);

        const request: SourceRequest = {
            jobId,
            url: config.SOURCE_URL,
            type: config.SOURCE_TYPE as SourceType,
        };

        await this.validateSource(request);

        let sourceDir: string;
        switch (request.type) {
            case SourceType.GIT:
                sourceDir = await this.fetchFromGit(request);
                break;
            case SourceType.S3:
                sourceDir = await this.fetchFromS3(request);
                break;
        }

        await JobMetadataRepository.upsertMetadata(jobId, { status: "in_progress" });

        return sourceDir;
    }

    validateSource(request: SourceRequest): Promise<SourceRequest> {
        log(`Validating source for request: ${JSON.stringify(request)}`);

        if (!request.jobId) {
            return Promise.reject(new SourceValidationError("jobId is required"));
        }

        if (!request.url || typeof request.url !== "string" || request.url.trim().length === 0) {
            return Promise.reject(new SourceValidationError("url is required and must be a non-empty string"));
        }

        if (!Object.values(SourceType).includes(request.type)) {
            return Promise.reject(
                new SourceValidationError(`type must be one of: ${Object.values(SourceType).join(", ")}, received: ${request.type}`)
            );
        }

        if (request.type === SourceType.GIT && !GIT_URL_PATTERN.test(request.url)) {
            return Promise.reject(
                new SourceValidationError(`url does not look like a valid git repository url: ${request.url}`)
            );
        }

        if (request.type === SourceType.S3 && !S3_URI_PATTERN.test(request.url) && !S3_HTTPS_PATTERN.test(request.url)) {
            return Promise.reject(
                new SourceValidationError(`url does not look like a valid s3 location: ${request.url}`)
            );
        }

        return Promise.resolve(request);
    }

    private fetchFromGit(request: SourceRequest): Promise<string> {
        log(`Fetching source from git repository: ${request.url}`);
        const destDir = path.join(config.WORKDIR, request.jobId);
        return GetSourcePort.downloadRepository(request.url, destDir);
    }

    private fetchFromS3(request: SourceRequest): Promise<string> {
        log(`Fetching source from S3: ${request.url}`);
        const destDir = path.join(config.WORKDIR, request.jobId);
        return BucketPort.downloadSource(request.url, destDir);
    }
}
