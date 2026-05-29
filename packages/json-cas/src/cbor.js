import { encode, rfc8949EncodeOptions } from "cborg";
/**
 * Deterministic CBOR encoding per RFC 8949 (bytewise-sorted map keys,
 * smallest-possible integer sizes).
 */
export function cborEncode(value) {
    return encode(value, rfc8949EncodeOptions);
}
//# sourceMappingURL=cbor.js.map