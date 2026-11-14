#!/bin/sh
# Rebuild the page from src/. Requires Node.js.
cd "$(dirname "$0")" && node build.js
