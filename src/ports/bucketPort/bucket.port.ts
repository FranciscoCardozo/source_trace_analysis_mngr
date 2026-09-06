import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import debug from "debug";
import Utils from "../../domain/utils";

const log: debug.IDebugger = debug("app:bucketPort");

const s3Client = new S3Client({ region: "us-east-1" });

interface S3Location {
    bucket: string;
    key: string;
}

export class BucketPort {
    constructor() {
    }

    static parseS3Url(url: string): S3Location {
        const s3UriMatch = url.match(/^s3:\/\/([^/]+)\/(.+)$/i);
        if (s3UriMatch) {
            return { bucket: s3UriMatch[1], key: decodeURIComponent(s3UriMatch[2]) };
        }

        const virtualHostedMatch = url.match(/^https:\/\/([^./]+)\.s3[.-][a-z0-9-]*\.amazonaws\.com\/(.+)$/i);
        if (virtualHostedMatch) {
            return { bucket: virtualHostedMatch[1], key: decodeURIComponent(virtualHostedMatch[2]) };
        }

        throw new Error(`Unable to parse S3 url: ${url}`);
    }

    static async downloadSource(url: string, destDir: string): Promise<string> {
        const { bucket, key } = this.parseS3Url(url);
        log(`Downloading s3://${bucket}/${key} to ${destDir}`);

        const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!response.Body) {
            throw new Error(`Empty response body for s3://${bucket}/${key}`);
        }

        const tempFile = path.join(os.tmpdir(), `${Date.now()}-${path.basename(key)}`);
        await pipeline(response.Body as Readable, fs.createWriteStream(tempFile));

        try {
            await Utils.extractArchive(tempFile, destDir);
        } finally {
            await fs.promises.unlink(tempFile).catch(() => { });
        }

        log(`Source extracted to ${destDir}`);
        return destDir;
    }

    static async uploadObject(bucket: string, key: string, body: string | Buffer, contentType: string): Promise<string> {
        log(`Uploading s3://${bucket}/${key}`);

        await s3Client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
        }));

        return key;
    }
}
