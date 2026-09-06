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

// Caps how much of the file tree actually gets embedded in an AI prompt.
// buildFileTree's own maxEntries controls the heuristic scan (can stay large,
// it's just string comparisons); this controls prompt/token cost, which is
// what actually matters for latency on a slow inference backend.
export const MAX_FILE_TREE_PROMPT_CHARS = 4000;

export function fileTreeForPrompt(fileTree: string[]): string {
    return fileTree.join("\n").slice(0, MAX_FILE_TREE_PROMPT_CHARS);
}

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
