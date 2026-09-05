import fs from "fs";
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
}
