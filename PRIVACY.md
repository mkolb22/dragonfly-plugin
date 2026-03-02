# Privacy Policy — Dragonfly

**Last updated:** 2026-03-01
**Maintainer:** Michael Kolb (https://github.com/mkolb22)

---

## Overview

Dragonfly is a locally-running MCP plugin for Claude Code. It does not collect, transmit, or store any personal data on remote servers. All project data, memories, and state remain on your machine.

---

## Data Collected and Stored

Dragonfly stores the following data **locally** in your project's `data/` directory:

| Database | Contents |
|----------|----------|
| `data/state.db` | Checkpoints, stories, workflow state, health records, specs, repair logs |
| `data/memory.db` | Semantic memories, vector embeddings, knowledge graph entities and relations |
| `data/index/` | AST index of your project's source files |

This data never leaves your machine unless you explicitly use the Bridge module to export it to another local project.

---

## External Network Requests

### Default mode — fully local

By default, Dragonfly uses a local embedding model (`Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers`). On first use, the model weights (~23 MB) are downloaded from the Hugging Face model hub and cached locally. After the initial download, no further network requests are made for embeddings.

### Optional OpenAI mode

If you set the `OPENAI_API_KEY` environment variable and configure Dragonfly to use OpenAI embeddings, text content from your project will be sent to OpenAI's API (`api.openai.com`) to generate embeddings. This is **opt-in only** and is not active in the default configuration. OpenAI's privacy policy governs any data sent to their API.

No other modules make external network requests.

---

## Data Dragonfly Reads

To build and maintain the AST index and semantic search, Dragonfly reads source files in your project directory. This data is processed locally and stored only in the local `data/` directory described above.

---

## Data Sharing

Dragonfly does not:
- Transmit data to the plugin author or any third party
- Collect usage telemetry or analytics
- Store data in cloud services
- Share data between projects (except via the explicit Bridge export tools)

---

## Data Retention and Deletion

All data is stored in the `data/` directory at your project root. To delete all Dragonfly data, remove this directory:

```bash
rm -rf data/
```

Dragonfly will recreate the directory and databases from scratch on next use.

---

## Contact

For privacy questions or concerns, open an issue at:
https://github.com/mkolb22/dragonfly-plugin/issues
