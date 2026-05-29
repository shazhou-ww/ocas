import xxhashFactory from "xxhash-wasm";
import { cborEncode } from "./cbor.js";
/** Crockford Base32 symbol table (32 characters, indices 0–31). */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Encode a u64 BigInt as a 13-character Crockford Base32 string. */
function u64ToCrockford(n) {
    let result = "";
    let x = n;
    for (let i = 0; i < 13; i++) {
        result = CROCKFORD[Number(x & 31n)] + result;
        x >>= 5n;
    }
    return result;
}
/** Encode an ASCII string as bytes without TextEncoder (all hashes are ASCII). */
function asciiToBytes(s) {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
        bytes[i] = s.charCodeAt(i);
    }
    return bytes;
}
function concatBytes(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
}
let _instance = null;
let _pending = null;
async function getInstance() {
    if (_instance !== null)
        return _instance;
    if (_pending === null) {
        _pending = xxhashFactory().then((api) => {
            _instance = api;
            return api;
        });
    }
    return _pending;
}
/**
 * hash = XXH64(utf8(typeHash) ++ CBOR_deterministic(payload))
 * Used for all normal nodes.
 */
export async function computeHash(typeHash, payload) {
    const api = await getInstance();
    const input = concatBytes(asciiToBytes(typeHash), cborEncode(payload));
    return u64ToCrockford(api.h64Raw(input));
}
/**
 * hash = XXH64(CBOR_deterministic(payload))
 * Used for self-referencing (bootstrap) nodes where type = hash.
 */
export async function computeSelfHash(payload) {
    const api = await getInstance();
    return u64ToCrockford(api.h64Raw(cborEncode(payload)));
}
//# sourceMappingURL=hash.js.map