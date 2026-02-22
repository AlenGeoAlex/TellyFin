#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT_DIR = process.argv[2] || process.cwd();

/**
 * Get all .env files tracked or modified in git, falling back to a manual
 * recursive search if git is not available.
 */
function findEnvFiles(rootDir) {
    let files = new Set();

    // 1. Try to get .env files from git (tracked + untracked-but-present)
    try {
        // Tracked .env files
        const tracked = execSync("git ls-files **/.env .env", {
            cwd: rootDir,
            stdio: ["pipe", "pipe", "pipe"],
        })
            .toString()
            .trim();

        if (tracked) {
            tracked.split("\n").forEach((f) => f && files.add(path.resolve(rootDir, f)));
        }

        // Modified / new .env files from git diff (unstaged + staged)
        const diffFiles = execSync(
            'git diff --name-only && git diff --cached --name-only',
            { cwd: rootDir, stdio: ["pipe", "pipe", "pipe"] }
        )
            .toString()
            .trim();

        if (diffFiles) {
            diffFiles
                .split("\n")
                .filter((f) => f && path.basename(f) === ".env")
                .forEach((f) => files.add(path.resolve(rootDir, f)));
        }

        console.log(`🔍 Git detected ${files.size} .env file(s).`);
    } catch {
        console.warn("⚠️  Git not available or not a git repo — falling back to filesystem scan.");
    }

    // 2. Fallback / supplement: recursively walk the directory
    walkDir(rootDir, files);

    return [...files].filter((f) => fs.existsSync(f));
}

/** Recursively find .env files, skipping node_modules and .git */
function walkDir(dir, found) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            walkDir(fullPath, found);
        } else if (entry.name === ".env") {
            found.add(fullPath);
        }
    }
}

/**
 * Parse a .env file and return lines with values replaced by empty strings
 * (or a placeholder), preserving comments and blank lines.
 */
function generateExampleContent(envPath) {
    const content = fs.readFileSync(envPath, "utf-8");
    const lines = content.split("\n");

    return lines
        .map((line) => {
            const trimmed = line.trim();

            // Blank line or comment — keep as-is
            if (!trimmed || trimmed.startsWith("#")) return line;

            // KEY=VALUE — strip the value
            const eqIndex = line.indexOf("=");
            if (eqIndex === -1) return line;

            const key = line.slice(0, eqIndex);
            return `${key}=`;
        })
        .join("\n");
}

function main() {
    console.log(`\n📂 Scanning: ${ROOT_DIR}\n`);

    const envFiles = findEnvFiles(ROOT_DIR);

    if (envFiles.length === 0) {
        console.log("No .env files found.");
        return;
    }

    for (const envFile of envFiles) {
        const dir = path.dirname(envFile);
        const examplePath = path.join(dir, ".env.example");
        const relEnv = path.relative(ROOT_DIR, envFile);
        const relExample = path.relative(ROOT_DIR, examplePath);

        try {
            const exampleContent = generateExampleContent(envFile);
            fs.writeFileSync(examplePath, exampleContent, "utf-8");
            console.log(`✅  ${relEnv}  →  ${relExample}`);
        } catch (err) {
            console.error(`❌  Failed to process ${relEnv}: ${err.message}`);
        }
    }

    console.log("\nDone!\n");
}

main();