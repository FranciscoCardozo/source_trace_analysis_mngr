import fs from "fs";
import path from "path";

export const IGNORED_DIRS = new Set([
    "node_modules", ".git", "dist", "build", "target", "vendor",
    "__pycache__", "venv", ".venv", "bin", "obj", ".idea", ".vscode",
]);

export const MANIFEST_FILES = [
    "package.json",
    "pyproject.toml",
    "setup.py",
    "pom.xml",
    "build.gradle",
    "go.mod",
    "Cargo.toml",
    "composer.json",
];

const README_FILES = ["README.md", "Readme.md", "readme.md", "README.rst", "README.txt"];

export interface ManifestFile {
    file: string;
    content: string;
}

export function findManifest(sourceDir: string): ManifestFile | null {
    for (const fileName of MANIFEST_FILES) {
        const filePath = path.join(sourceDir, fileName);
        if (fs.existsSync(filePath)) {
            return { file: fileName, content: fs.readFileSync(filePath, "utf-8") };
        }
    }
    return null;
}

export function findReadme(sourceDir: string): string | null {
    for (const fileName of README_FILES) {
        const filePath = path.join(sourceDir, fileName);
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, "utf-8");
        }
    }
    return null;
}

export function buildFileTree(sourceDir: string, maxEntries = 300): string[] {
    const entriesFound: string[] = [];

    const walk = (currentDir: string): void => {
        if (entriesFound.length >= maxEntries) {
            return;
        }

        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entriesFound.length >= maxEntries) {
                return;
            }

            if (entry.isDirectory()) {
                if (!IGNORED_DIRS.has(entry.name)) {
                    walk(path.join(currentDir, entry.name));
                }
                continue;
            }

            entriesFound.push(path.relative(sourceDir, path.join(currentDir, entry.name)));
        }
    };

    walk(sourceDir);
    return entriesFound;
}
