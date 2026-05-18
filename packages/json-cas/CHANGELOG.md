# @uncaged/json-cas

## 0.3.0

### Minor Changes

- Disallow self-referencing nodes in put(). typeHash is now required (no null). Self-ref only via bootstrap().

## 0.2.0

### Minor Changes

- Add listByType(typeHash) to Store interface for O(1) type-based queries, with append-only fs index

## 0.1.3
