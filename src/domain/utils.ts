import fs from "fs";
import path from "path";
import * as tar from "tar";
import AdmZip from "adm-zip";
import { ExtractArchiveOptions } from "./models/interfaces/extractArchiveOptions.interface";

export default class Utils {
    static async extractArchive(
        archivePath: string,
        destDir: string,
        options: ExtractArchiveOptions = {}
    ): Promise<void> {
        await fs.promises.mkdir(destDir, { recursive: true });

        if (/\.zip$/i.test(archivePath)) {
            const zip = new AdmZip(archivePath);
            zip.extractAllTo(destDir, true);
            return;
        }

        if (/\.(tar\.gz|tgz|tar)$/i.test(archivePath)) {
            await tar.x({
                file: archivePath,
                cwd: destDir,
                strip: options.stripComponents ?? 0,
            });
            return;
        }

        throw new Error(`Unsupported archive format: ${archivePath}`);
    }

    // Zips exported from GitHub (and many other sources) wrap everything in a
    // single top-level folder (e.g. "repo-branch/"), unlike GitHub's tarball API
    // which we explicitly strip via ExtractArchiveOptions.stripComponents. If
    // extraction left exactly one directory at the root, promote its contents up
    // so manifest/README lookups (which only check the root, no recursion) work
    // regardless of whether the archive happened to have a wrapper folder.
    static async flattenSingleTopLevelDir(destDir: string): Promise<void> {
        const entries = await fs.promises.readdir(destDir, { withFileTypes: true });
        if (entries.length !== 1 || !entries[0].isDirectory()) {
            return;
        }

        const wrapperDir = path.join(destDir, entries[0].name);
        const innerEntries = await fs.promises.readdir(wrapperDir);

        for (const name of innerEntries) {
            await fs.promises.rename(path.join(wrapperDir, name), path.join(destDir, name));
        }

        await fs.promises.rmdir(wrapperDir);
    }
}
