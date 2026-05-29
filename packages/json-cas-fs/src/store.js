import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, } from "node:fs";
import { join } from "node:path";
import { BOOTSTRAP_STORE, cborEncode, computeHash, computeSelfHash, } from "@uncaged/json-cas";
import { decode } from "cborg";
const INDEX_DIR = "_index";
function loadDir(dir, data) {
    let entries;
    try {
        entries = readdirSync(dir);
    }
    catch {
        return;
    }
    for (const name of entries) {
        if (!name.endsWith(".bin"))
            continue;
        const hash = name.slice(0, -4);
        try {
            const buf = readFileSync(join(dir, name));
            const node = decode(new Uint8Array(buf));
            data.set(hash, node);
        }
        catch {
            // skip corrupted files
        }
    }
}
function parseIndexFile(content) {
    if (content.length === 0)
        return [];
    return content.split("\n").filter((line) => line.length > 0);
}
function loadTypeIndex(indexDir) {
    const typeIndex = new Map();
    let entries;
    try {
        entries = readdirSync(indexDir);
    }
    catch {
        return typeIndex;
    }
    for (const typeHash of entries) {
        try {
            const content = readFileSync(join(indexDir, typeHash), "utf8");
            typeIndex.set(typeHash, parseIndexFile(content));
        }
        catch {
            // skip unreadable index files
        }
    }
    return typeIndex;
}
function buildTypeIndexFromNodes(data) {
    const typeIndex = new Map();
    for (const [hash, node] of data) {
        const list = typeIndex.get(node.type) ?? [];
        list.push(hash);
        typeIndex.set(node.type, list);
    }
    return typeIndex;
}
function writeTypeIndex(indexDir, typeIndex) {
    mkdirSync(indexDir, { recursive: true });
    for (const [typeHash, hashes] of typeIndex) {
        const body = hashes.length > 0 ? `${hashes.join("\n")}\n` : "";
        writeFileSync(join(indexDir, typeHash), body, "utf8");
    }
}
function loadOrMigrateTypeIndex(dir, data) {
    const indexDir = join(dir, INDEX_DIR);
    if (!existsSync(indexDir)) {
        const typeIndex = buildTypeIndexFromNodes(data);
        if (typeIndex.size > 0) {
            writeTypeIndex(indexDir, typeIndex);
        }
        return typeIndex;
    }
    return loadTypeIndex(indexDir);
}
function appendToTypeIndex(indexDir, typeIndex, type, hash) {
    mkdirSync(indexDir, { recursive: true });
    appendFileSync(join(indexDir, type), `${hash}\n`, "utf8");
    const list = typeIndex.get(type) ?? [];
    list.push(hash);
    typeIndex.set(type, list);
}
export function createFsStore(dir) {
    const data = new Map();
    loadDir(dir, data);
    const indexDir = join(dir, INDEX_DIR);
    const typeIndex = loadOrMigrateTypeIndex(dir, data);
    async function putSelfReferencing(payload) {
        const hash = await computeSelfHash(payload);
        if (!data.has(hash)) {
            const node = { type: hash, payload, timestamp: Date.now() };
            data.set(hash, node);
            mkdirSync(dir, { recursive: true });
            const tmp = join(dir, `${hash}.tmp`);
            const dest = join(dir, `${hash}.bin`);
            writeFileSync(tmp, cborEncode({ type: hash, payload, timestamp: node.timestamp }));
            renameSync(tmp, dest);
            appendToTypeIndex(indexDir, typeIndex, hash, hash);
        }
        return hash;
    }
    const store = {
        async put(typeHash, payload) {
            const hash = await computeHash(typeHash, payload);
            if (!data.has(hash)) {
                const node = {
                    type: typeHash,
                    payload,
                    timestamp: Date.now(),
                };
                data.set(hash, node);
                mkdirSync(dir, { recursive: true });
                const tmp = join(dir, `${hash}.tmp`);
                const dest = join(dir, `${hash}.bin`);
                writeFileSync(tmp, cborEncode({ type: typeHash, payload, timestamp: node.timestamp }));
                renameSync(tmp, dest);
                appendToTypeIndex(indexDir, typeIndex, typeHash, hash);
            }
            return hash;
        },
        get(hash) {
            return data.get(hash) ?? null;
        },
        has(hash) {
            return data.has(hash);
        },
        listByType(typeHash) {
            return typeIndex.get(typeHash) ?? [];
        },
        [BOOTSTRAP_STORE]: putSelfReferencing,
    };
    return store;
}
//# sourceMappingURL=store.js.map