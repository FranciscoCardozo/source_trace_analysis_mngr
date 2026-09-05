import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import debug from "debug";
import config from "../../config";
import Utils from "../../domain/utils";

const log: debug.IDebugger = debug("app:getSourcePort");

interface GitRepoRef {
    owner: string;
    repo: string;
    ref: string;
}

export default class GetSourcePort {

    constructor() {

    }

    static parseGitUrl(url: string): GitRepoRef {
        const cleanUrl = url.trim().replace(/\.git$/i, "");

        const sshMatch = cleanUrl.match(/^git@[^:]+:([^/]+)\/(.+)$/i);
        if (sshMatch) {
            return { owner: sshMatch[1], repo: sshMatch[2], ref: "HEAD" };
        }

        const httpsMatch = cleanUrl.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\/(?:tree|commit)\/(.+))?$/i);
        if (httpsMatch) {
            return {
                owner: httpsMatch[1],
                repo: httpsMatch[2],
                ref: httpsMatch[3] || "HEAD",
            };
        }

        throw new Error(`Unable to parse git repository url: ${url}`);
    }

    static async downloadRepository(url: string, destDir: string): Promise<string> {
        const { owner, repo, ref } = this.parseGitUrl(url);
        log(`Downloading ${owner}/${repo}@${ref} to ${destDir}`);

        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/${encodeURIComponent(ref)}`;
        const headers: Record<string, string> = {
            "User-Agent": "source-trace-analysis-mngr",
            "Accept": "application/vnd.github+json",
        };
        if (config.GITHUB_TOKEN) {
            headers["Authorization"] = `Bearer ${config.GITHUB_TOKEN}`;
        }

        const response = await fetch(apiUrl, { headers });
        if (!response.ok || !response.body) {
            throw new Error(`Failed to download repository ${owner}/${repo}@${ref}: ${response.status} ${response.statusText}`);
        }

        const tempFile = path.join(os.tmpdir(), `${Date.now()}-${owner}-${repo}.tar.gz`);
        await pipeline(Readable.fromWeb(response.body as any), fs.createWriteStream(tempFile));

        try {
            await Utils.extractArchive(tempFile, destDir, { stripComponents: 1 });
        } finally {
            await fs.promises.unlink(tempFile).catch(() => { });
        }

        log(`Repository extracted to ${destDir}`);
        return destDir;
    }
}
