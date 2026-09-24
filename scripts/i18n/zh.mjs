#!/usr/bin/env node
// Chinese localization toolkit for the ghostty-config zh-CN fork.
// See I18N.md for the full design. No dependencies; requires Node 20+.
//
//   node scripts/i18n/zh.mjs extract    # scan sources, add new strings to the dictionary
//   node scripts/i18n/zh.mjs translate  # machine-translate empty dictionary entries
//   node scripts/i18n/zh.mjs apply      # rewrite sources in the working tree (build-time only)
//   node scripts/i18n/zh.mjs status     # report translation coverage

import {existsSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DICT_PATH = join(root, "i18n", "zh-CN.json");

// Source files scanned for translatable strings and rewritten by `apply`.
// These files are NEVER committed with translations applied — translations
// live only in the dictionary and are applied to the working tree in CI.
const TARGETS = [
    {file: "src/lib/settings/registry.ts", fields: ["name", "description", "note"]},
    {file: "src/lib/settings/navigation.ts", fields: ["name", "note"]}
];

// Directories whose .svelte files are scanned for template text nodes and
// placeholder/title/aria-label attributes. <script> and <style> blocks are
// never touched, so code logic (e.g. `platform === "macOS"`) is unaffected.
const SVELTE_DIRS = ["src/routes", "src/lib/components", "src/lib/views"];

// Excluded from scanning: preview components whose template text is demo
// content (lorem ipsum, fake shell output) plus dev-only showcase pages.
const SVELTE_EXCLUDE = [/views\/.*Preview.*\.svelte$/, /component-showcase/, /dropdown-debug/];

// Non-string-literal patches applied to the working tree before building.
const PATCHES = [
    {
        file: "svelte.config.js",
        find: 'base: ""',
        replace: 'base: process.env.BASE_PATH ?? ""'
    }
];

const GT_URL = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=";
const REQUEST_DELAY_MS = 150;
const SAVE_EVERY = 25;

function loadDict() {
    if (!existsSync(DICT_PATH)) return {};
    return JSON.parse(readFileSync(DICT_PATH, "utf8"));
}

function saveDict(dict) {
    const sorted = Object.fromEntries(Object.entries(dict).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(DICT_PATH, JSON.stringify(sorted, null, 2) + "\n");
}

function extractFrom(content, fields) {
    const found = new Set();
    for (const field of fields) {
        const re = new RegExp(`\\b${field}:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "g");
        for (const match of content.matchAll(re)) {
            if (!match[1]) continue;
            try {
                found.add(JSON.parse(`"${match[1]}"`));
            }
            catch {
                console.warn(`  ! could not parse ${field} literal, skipped: ${match[1].slice(0, 60)}...`);
            }
        }
    }
    return found;
}

function svelteFiles() {
    const files = [];
    for (const dir of SVELTE_DIRS) {
        for (const entry of readdirSync(join(root, dir), {recursive: true})) {
            const file = join(dir, String(entry));
            if (file.endsWith(".svelte") && !SVELTE_EXCLUDE.some((re) => re.test(file))) files.push(file);
        }
    }
    return files;
}

// Svelte templates: keep code blocks out of scope by swapping them for tokens.
function splitTemplate(content) {
    const blocks = [];
    const rest = content.replace(/<(script|style)[\s\S]*?<\/\1>/g, (block) => {
        blocks.push(block);
        return `\x01BLOCK${blocks.length - 1}\x01`;
    });
    return {rest, blocks};
}

function joinTemplate(rest, blocks) {
    return rest.replace(/\x01BLOCK(\d+)\x01/g, (_, i) => blocks[Number(i)]);
}

function looksLikeText(str) {
    const letters = str.match(/[a-zA-Z]/g);
    return str.length > 1 && letters !== null && letters.length >= 2 && !/&[a-z]+;/.test(str) && !str.endsWith("(") && !str.includes("=>");
}

// Svelte block-end markers after which template text can appear.
// Arbitrary "}" is NOT a safe boundary (interpolations appear inside tags).
const BLOCK_END = String.raw`\{(?:/[a-z]+|:(?:else|then|catch)[^}]*)\}`;

function extractSvelte(content) {
    const {rest} = splitTemplate(content);
    const found = new Set();
    const reText = new RegExp(`(?<![=\\->])>([^<>{}]+)(?=<|\\{)|${BLOCK_END}\\s*([^<>{}]+?)(?=<|\\{)`, "g");
    for (const match of rest.matchAll(reText)) {
        const text = (match[1] ?? match[2]).trim();
        if (looksLikeText(text)) found.add(text);
    }
    for (const match of rest.matchAll(/\b(?:placeholder|title|aria-label)="([^"]+)"/g)) {
        const text = match[1].trim();
        if (looksLikeText(text)) found.add(text);
    }
    return found;
}

function cmdExtract() {
    const dict = loadDict();
    let added = 0;
    for (const target of TARGETS) {
        const content = readFileSync(join(root, target.file), "utf8");
        for (const str of extractFrom(content, target.fields)) {
            if (!(str in dict)) {
                dict[str] = "";
                added++;
            }
        }
    }
    for (const file of svelteFiles()) {
        const content = readFileSync(join(root, file), "utf8");
        for (const str of extractSvelte(content)) {
            if (!(str in dict)) {
                dict[str] = "";
                added++;
            }
        }
    }
    saveDict(dict);
    const total = Object.keys(dict).length;
    const done = Object.values(dict).filter(Boolean).length;
    console.log(`extract: +${added} new strings, dictionary now ${total} entries (${done} translated, ${total - done} pending)`);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function translateOne(text, attempt = 0) {
    const res = await fetch(GT_URL + encodeURIComponent(text));
    if (!res.ok) {
        if (attempt < 3) {
            await sleep(1000 * 2 ** attempt);
            return translateOne(text, attempt + 1);
        }
        throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    return data[0].map((segment) => segment[0]).join("");
}

async function cmdTranslate(limit) {
    const dict = loadDict();
    const pending = Object.entries(dict).filter(([, zh]) => !zh);
    if (pending.length === 0) {
        console.log("translate: nothing pending");
        return;
    }
    const batch = pending.slice(0, limit);
    console.log(`translate: ${pending.length} pending, translating ${batch.length} this run`);
    let translated = 0;
    let failed = 0;
    for (const [en] of batch) {
        try {
            dict[en] = await translateOne(en);
            translated++;
        }
        catch (err) {
            failed++;
            console.warn(`  ! failed (${err.message}): ${en.slice(0, 60)}`);
        }
        if ((translated + failed) % SAVE_EVERY === 0) saveDict(dict);
        await sleep(REQUEST_DELAY_MS);
    }
    saveDict(dict);
    console.log(`translate: ${translated} translated, ${failed} failed, ${pending.length - batch.length + failed} still pending`);
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applySvelte(content, entries) {
    const {rest, blocks} = splitTemplate(content);
    let out = rest;
    let replaced = 0;
    for (const [en, zh] of entries) {
        const esc = escapeRegExp(en);
        const reText = new RegExp(`(?<![=\\->])(>)\\s*${esc}\\s*(?=<|\\{)|(${BLOCK_END})\\s*${esc}\\s*(?=<|\\{)`, "g");
        const reAttr = new RegExp(`\\b((?:placeholder|title|aria-label)=)"${esc}"`, "g");
        if (reText.test(out) || reAttr.test(out)) {
            out = out.replace(reText, (_, tag, block) => (tag ?? block) + zh).replace(reAttr, (_, attr) => `${attr}"${zh}"`);
            replaced++;
        }
    }
    return {content: joinTemplate(out, blocks), replaced};
}

function cmdApply() {
    const dict = loadDict();
    // Longest first so overlapping strings (e.g. "Search" vs "Search settings")
    // never partially shadow each other.
    const entries = Object.entries(dict).filter(([, zh]) => zh).sort(([a], [b]) => b.length - a.length);
    const missing = Object.entries(dict).filter(([, zh]) => !zh);
    for (const target of TARGETS) {
        const path = join(root, target.file);
        let content = readFileSync(path, "utf8");
        let replaced = 0;
        for (const [en, zh] of entries) {
            const from = JSON.stringify(en);
            const to = JSON.stringify(zh);
            if (content.includes(from)) {
                content = content.split(from).join(to);
                replaced++;
            }
        }
        writeFileSync(path, content);
        console.log(`apply: ${target.file} — ${replaced} strings translated`);
    }
    let svelteReplaced = 0;
    let svelteFilesTouched = 0;
    for (const file of svelteFiles()) {
        const path = join(root, file);
        const content = readFileSync(path, "utf8");
        const result = applySvelte(content, entries);
        if (result.replaced > 0) {
            writeFileSync(path, result.content);
            svelteReplaced += result.replaced;
            svelteFilesTouched++;
        }
    }
    console.log(`apply: ${svelteFilesTouched} .svelte files — ${svelteReplaced} strings translated`);
    for (const patch of PATCHES) {
        const path = join(root, patch.file);
        let content = readFileSync(path, "utf8");
        if (content.includes(patch.replace)) {
            console.log(`apply: ${patch.file} — patch already present`);
            continue;
        }
        if (!content.includes(patch.find)) {
            console.warn(`apply: ${patch.file} — PATCH TARGET NOT FOUND: ${patch.find}`);
            continue;
        }
        content = content.split(patch.find).join(patch.replace);
        writeFileSync(path, content);
        console.log(`apply: ${patch.file} — patched (${patch.find} -> ${patch.replace})`);
    }
    if (missing.length > 0) {
        console.log(`apply: ${missing.length} strings still untranslated (left in English)`);
    }
}

function cmdStatus() {
    const dict = loadDict();
    const total = Object.keys(dict).length;
    const done = Object.values(dict).filter(Boolean).length;
    console.log(`dictionary: ${total} entries, ${done} translated, ${total - done} pending`);
}

const [command, ...args] = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 500;

switch (command) {
    case "extract":
        cmdExtract();
        break;
    case "translate":
        await cmdTranslate(limit);
        break;
    case "apply":
        cmdApply();
        break;
    case "status":
        cmdStatus();
        break;
    default:
        console.error("usage: node scripts/i18n/zh.mjs <extract|translate|apply|status> [--limit=N]");
        process.exit(1);
}
