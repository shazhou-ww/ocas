#!/bin/bash
# Prevent publishing packages that still reference workspace:* dependencies
if grep -q '"workspace:' package.json 2>/dev/null; then
  echo "❌ Found workspace:* dependencies in package.json — cannot publish directly."
  echo "   Use 'changeset publish' which resolves workspace protocol automatically."
  grep '"workspace:' package.json
  exit 1
fi
