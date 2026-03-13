#!/usr/bin/env bash
# Dragonfly Project Structure Validation Hook
#
# Runs after Write/Edit tool use to detect files in wrong locations.
# Warns but does not block (to avoid breaking workflows).
#
# Protected directories:
#   - data/     → ONLY state files (.yaml, .db) allowed
#   - .claude/  → ONLY Dragonfly config files allowed
#   - .dragonfly/     → NEVER modify (submodule)

set -e

# Get tool input from stdin (JSON)
INPUT=$(cat)

# Extract file path from tool input
# Handles both Write and Edit tools
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

# If no file path found, exit silently
[ -z "$FILE_PATH" ] && exit 0

# Get project root
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Make path relative for checking
REL_PATH="${FILE_PATH#$PROJECT_ROOT/}"

# Function to output warning
warn() {
    echo ""
    echo "⚠️  PROJECT STRUCTURE WARNING"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "$1"
    echo ""
    echo "See: .claude/skills/project-structure.md"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

# Check 1: .dragonfly/ directory (NEVER modify)
if [[ "$REL_PATH" == .dragonfly/* ]]; then
    warn "Modifying .dragonfly/ submodule is not allowed.

File: $REL_PATH

The .dragonfly/ directory is a git submodule and should never be modified.
To customize Dragonfly, edit files in .claude/ instead."
    exit 0
fi

# Check 2: data/ directory (ONLY state files)
if [[ "$REL_PATH" == data/* ]]; then
    # Allow .yaml, .db, .md, .log files
    if [[ "$REL_PATH" != *.yaml && "$REL_PATH" != *.db && "$REL_PATH" != *.md && "$REL_PATH" != *.log ]]; then
        EXTENSION="${REL_PATH##*.}"
        warn "Unexpected file detected in data/ directory.

File: $REL_PATH
Extension: .$EXTENSION

The data/ directory should ONLY contain:
  - .db files (SQLite state)
  - .yaml files (configuration/anchors)
  - README.md (documentation)

Source code should be placed in:
  - src/     (source files)
  - tests/   (test files)
  - lib/     (libraries)

Please move this file to the appropriate project directory."
        exit 0
    fi
fi

# Check 3: .claude/ directory (ONLY Dragonfly config)
if [[ "$REL_PATH" == .claude/* ]]; then
    # Allow known Dragonfly file types
    case "$REL_PATH" in
        *.md|*.yaml|*.json|*.sh)
            # These are valid Dragonfly config files
            ;;
        *)
            EXTENSION="${REL_PATH##*.}"
            # Check for source code extensions
            case "$EXTENSION" in
                ts|js|tsx|jsx|py|go|rs|java|cpp|c|h|rb|php|swift|kt)
                    warn "Source code detected in .claude/ directory.

File: $REL_PATH
Extension: .$EXTENSION

The .claude/ directory should ONLY contain Dragonfly configuration:
  - concepts/*.md
  - agents/*.md
  - skills/*.md
  - commands/*.md
  - synchronizations/*.yaml
  - schemas/*.json
  - hooks/*.sh

Source code should be placed in:
  - src/     (source files)
  - tests/   (test files)
  - lib/     (libraries)

Please move this file to the appropriate project directory."
                    ;;
            esac
            ;;
    esac
fi

# Check 4: Source code extensions in root data subdirectories
# This catches things like data/implementations/auth.ts
if [[ "$REL_PATH" == data/*/* ]]; then
    EXTENSION="${REL_PATH##*.}"
    case "$EXTENSION" in
        ts|js|tsx|jsx|py|go|rs|java|cpp|c|h|rb|php|swift|kt|css|scss|html|vue|svelte)
            warn "Source code detected in data/ subdirectory.

File: $REL_PATH
Extension: .$EXTENSION

The data/ directory and its subdirectories should ONLY contain state files (.db, .yaml).

Example of correct structure:
  data/implementations/impl-001.yaml  (metadata about implementation)
  src/auth.ts                         (actual source code)

Please move the source code to the project's src/ directory."
            ;;
    esac
fi

exit 0
