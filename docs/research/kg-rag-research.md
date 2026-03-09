# Knowledge Graph RAG — Research Findings

**Date:** 2026-03-08
**Scope:** Academic grounding for the dragonfly KG module and cross-module optimization decisions
**Status:** Informing implementation plan

---

## Background

The dragonfly KG module has no cited research paper. It is a custom implementation whose design maps across three academic research threads: Microsoft GraphRAG (community detection), HippoRAG (graph traversal for multi-hop retrieval), and hybrid search fusion (Blended RAG). This document synthesizes those findings, evaluates empirical evidence, and draws direct implications for our implementation.

---

## Paper 1: Microsoft GraphRAG

**"From Local to Global: A Graph RAG Approach to Query-Focused Summarization"**
Edge et al., 2024 — https://arxiv.org/abs/2404.16130

### What It Does

Standard vector RAG retrieves semantically similar chunks but cannot answer "global sensemaking" queries — questions requiring themes, patterns, or summaries across an entire corpus. GraphRAG builds a knowledge graph from source documents using an LLM, runs the Leiden community detection algorithm to cluster related entities into hierarchical communities, pre-generates community summaries at multiple levels, then uses map-reduce over summaries at query time.

### Empirical Results

Tested on two corpora ~1M tokens each (podcast transcripts and news articles):

| Metric | Podcast | News |
|---|---|---|
| Comprehensiveness win over vector RAG | 72–83% | 72–80% |
| Diversity win over vector RAG | 75–82% | 62–71% |
| Statistical significance | p < .001 | p < .001 |

All GraphRAG variants significantly exceeded vector RAG on claim count (p < .05). 47,075 unique factual claims extracted.

Directness: vector RAG won (comprehensive answers are inherently less direct — expected tradeoff).

### Where It Wins

Specifically global/thematic queries: *"What are the main themes across all episodes?"* or *"What trends emerge in this corpus?"*. It does NOT claim superiority for point-fact retrieval. The win is on breadth and comprehensiveness, not precision.

### Limitations

- Only two corpora tested
- No fabrication/hallucination analysis
- LLM-as-judge evaluation (no human ground truth)
- Expensive: full LLM-based entity extraction + summarization at index time
- Community structure requires full rebuild on updates
- Leiden algorithm is probabilistic and sensitive to resolution parameter

### Tested on Code?

**No.** All evaluation on natural language documents (podcasts, news). Zero code evaluation. Entity extraction is designed for NL triples (person-relation-person), not AST-level code structures.

### Relevance to Our Implementation

Community detection in our KG uses BFS connected components (simpler than Leiden but functionally equivalent for graph queries). The 10% community weight in hybrid search mirrors GraphRAG's community boost concept. However, there is zero empirical evidence this helps code retrieval. GraphRAG's community approach targets architectural/thematic questions that rarely arise in point-query code intelligence workflows.

---

## Paper 2: HippoRAG

**"HippoRAG: Neurobiologically Inspired Long-Term Memory for Large Language Models"**
Gutierrez et al., NeurIPS 2024 — https://arxiv.org/abs/2405.14831

### What It Does

Inspired by hippocampal indexing theory: the neocortex (LLM) extracts entity triples, a hippocampal index (knowledge graph) stores associative links, and Personalized PageRank traversal retrieves related memories from partial cues. Key insight: human memory uses pattern separation (distinct memories) and pattern completion (retrieval from partial cues). HippoRAG mimics this with single-step KG traversal rather than iterative LLM calls.

### Empirical Results

Tested on multi-hop QA benchmarks (MuSiQue, 2WikiMultiHopQA, HotpotQA):

| Dataset | Metric | Gain vs Baseline |
|---|---|---|
| 2WikiMultiHopQA | Recall@2 | +11% |
| 2WikiMultiHopQA | Recall@5 | +20% |
| 2WikiMultiHopQA | All-Recall@5 | +20–38% vs ColBERTv2 |
| MuSiQue | Recall | ~+3% |
| HotpotQA | Recall | Comparable (easy multi-hop) |

Efficiency: **10–30x cheaper** and **6–13x faster** than iterative methods (IRCoT) at comparable or better performance.

### Where It Wins

Hard multi-hop reasoning: connecting information across multiple documents via shared entities. The harder the multi-hop, the bigger the advantage. Minimal gains on easy single-hop tasks.

### Limitations

- LLM-based KG construction has reliability issues
- Newer methods (EcphoryRAG, HopRAG) have surpassed it
- Gains on easy multi-hop are minimal
- Doesn't address entity extraction accuracy

### Tested on Code?

**No.** Wikipedia-derived NL benchmarks only.

### Relevance to Our Implementation

Graph traversal (`kg_traverse`) is the HippoRAG equivalent in our module. The conceptual mapping to code is strong: *"What calls X, and what does X depend on, and is that tested?"* is exactly the multi-hop reasoning HippoRAG targets. Our BFS traversal with depth/limit controls mirrors this. However, HippoRAG uses LLM-extracted NL triples — for code, deterministic AST-derived graphs are vastly more reliable (see Paper 3).

---

## Paper 3: The Critical One — AST-Derived KG RAG for Code

**"Reliable Graph-RAG for Codebases: AST-Derived Graphs vs LLM-Extracted Knowledge Graphs"**
January 2026 — https://arxiv.org/html/2601.08773

This is the only paper that directly evaluates KG RAG on code. It is the primary empirical basis for our implementation decisions.

### What It Does

Compares three retrieval pipelines on architectural questions about real Java codebases:
1. No-Graph: pure vector similarity (baseline)
2. LLM-extracted KG RAG: LLM extracts entities and relations from code text
3. Deterministic AST-derived KG RAG: parse AST, extract symbols and call graphs deterministically

Tested on: Shopizer (e-commerce), OpenMRS (medical records), ThingsBoard (IoT) — three real-world Java projects.

### Empirical Results

| Approach | Correct / 45 | Accuracy |
|---|---|---|
| No-Graph (vector only) | 31 | 68.9% |
| LLM-extracted KG RAG | 38 | 84.4% |
| **Deterministic AST-derived KG RAG** | **43** | **95.6%** |

| Metric | LLM-extracted KG | AST-derived KG |
|---|---|---|
| Indexing speed | Baseline | **71x faster** |
| End-to-end cost | Baseline | **8.8x cheaper** |
| File miss rate | **31.2%** (377/1210 files skipped) | 0% (deterministic) |
| Chunk coverage | Variable | **0.902** (deterministic) |

### Why LLM-Extracted KG Fails for Code

- **Probabilistic incompleteness:** LLMs skip files due to context limits, ambiguous code, or confidence thresholds. 31.2% miss rate means nearly a third of the codebase is invisible.
- **Hallucinated relations:** LLM fills gaps with plausible but structurally wrong edges. A function it "thinks" calls another may not.
- **Duplicate entities:** Same symbol extracted with different surface forms (`AuthService`, `authService`, `auth-service`) creates fragmented graphs.
- **No ground truth:** LLM extraction cannot be verified without running the code.

### Why AST-Derived KG Wins

- **Deterministic and complete:** The parser either finds a symbol or it doesn't. No hallucination, no skipping.
- **Structurally correct:** Call graphs from AST match actual runtime behavior (within static analysis limits).
- **Fast:** One parse pass vs multiple LLM API calls per file.
- **Cheap:** No LLM API costs at index time.

### Direct Implication for Our Implementation

Our `kg_ingest_ast` tool IS the AST-derived approach. Our `kg_ingest` tool IS the LLM/pattern-extracted approach. The research says for code entities, we should be using `kg_ingest_ast` exclusively and treating `kg_ingest` as a tool for natural language documents (READMEs, specs, architecture docs) only.

---

## Paper 4: Hybrid Search Fusion

**"Blended RAG: Improving RAG Accuracy with Semantic Search and Hybrid Retrievers"**
Sawarkar et al., 2024 — https://arxiv.org/abs/2404.07220

### Empirical Results

Combining BM25 (keyword), dense vector (KNN), and sparse encoder with rank fusion:

| Dataset | Metric | Score | vs Benchmark |
|---|---|---|---|
| TREC-COVID | NDCG@10 | 0.87 | +8.2% vs COCO-DR Large |
| NQ | NDCG@10 | 0.67 | +5.8% vs monoT5-3B |
| SQuAD RAG | F1 | 68.4 | +30% relative vs RAG-end2end |
| SQuAD EM | EM | 57.63 | +44% vs baseline |
| TREC-COVID | Top-10 recall | 98% | — |

Industry consensus (Weaviate, Elastic, OpenSearch): hybrid search yields **15–30% better recall** than either BM25 or dense search alone.

**Key finding:** No single retrieval method dominates across all query types. Different queries favor different methods. Hybrid fusion consistently outperforms any individual method.

### Relevance to Our Implementation

Our 4-signal hybrid search (semantic 40% + keyword 30% + graph 20% + community 10%) is architecturally aligned with this research. The semantic + keyword combination is the validated baseline. Adding graph proximity is supported by the KG RAG research above. The community weight (10%) is the least validated signal for code queries.

For code specifically: keyword search matters more than for NL documents because developers search by exact symbol names. Our 30% keyword weight may be conservative — consider 35%.

---

## Paper 5: Graph-Augmented Hybrid Retrieval

**"Graph Retrieval-Augmented Generation: A Survey"**
ACM TOIS 2025 — https://dl.acm.org/doi/10.1145/3777378

Adding graph structure to hybrid retrieval:
- +6.4 points multi-hop QA recall over baseline retrieval
- Dual-Pathway KG-RAG: **18% hallucination reduction** in biomedical QA

The graph signal provides structural context that neither keyword nor semantic similarity can provide — it answers "how are these entities related?" rather than "how similar are these entities?"

---

## Summary: What the Research Proves

| Claim | Paper | Confidence |
|---|---|---|
| Graph structure improves retrieval | All papers | High |
| Hybrid (keyword + semantic) beats single-method | Blended RAG | High |
| For code: AST-derived graphs >> LLM/pattern-extracted | AST KG paper | High |
| Multi-hop traversal helps cross-document reasoning | HippoRAG | High |
| Community detection helps thematic/global queries | GraphRAG | Medium (NL only) |
| Community detection helps code retrieval | None | Low (unvalidated) |
| Hybrid works for code specifically | Blended RAG (partial) | Medium |
| AST graph proximity should be weighted higher for code | AST KG paper (implied) | Medium |

---

## Anti-Patterns (Evidence-Based)

| Anti-pattern | Evidence | Consequence |
|---|---|---|
| Use LLM/pattern extraction for code entities | AST KG paper: 31.2% miss rate | Incomplete, unreliable graph |
| Rely solely on vector search | AST KG paper: 68.9% vs 95.6% | Structural relationships missed |
| Apply NL community detection to code without adaptation | GraphRAG: no code eval | Possible noise in retrieval |
| Use RAPTOR clustering on code | RAPTOR: no code eval | Lossy vs actual AST hierarchy |
| Skip keyword/BM25 for code | Blended RAG: hybrid always wins | Exact symbol names missed |
| Parallel KG alongside AST (not integrated) | AST KG paper architecture | Duplication, inconsistency |

---

## RAPTOR — Brief Note

**"RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval"**
Sarthi et al., ICLR 2024 — https://arxiv.org/abs/2401.18059

RAPTOR recursively clusters and summarizes document chunks into a tree for multi-resolution retrieval. Results: +20% absolute on QuALITY benchmark (full-document comprehension). Not implemented in dragonfly and not recommended for code: code already has a precise hierarchical structure (AST → file → module → package). Embedding-based clustering of code chunks would be lossy relative to the deterministic AST hierarchy we already have via the AST module.

---

## Conclusions

1. **The KG module's architecture is sound.** Hybrid search + graph traversal + entity/relation model is research-validated for retrieval improvement.

2. **The entity extraction strategy has a critical flaw.** `kg_ingest` (pattern-based) is the wrong tool for code. `kg_ingest_ast` (AST-derived) is the right tool and is already built.

3. **Community detection is the weakest signal.** Architecturally included but empirically unvalidated for code. Should be weighted at 5% or less and positioned as an opt-in feature for architectural queries.

4. **Graph proximity should be weighted higher for code.** Code relationships are structural, not just semantic. The 20% graph weight may be conservative given AST paper results.

5. **The hybrid kernel is correct.** Semantic + keyword is validated. The graph signal adds what neither can provide. Community is speculative.

6. **ANE acceleration is correctly implemented.** The shared embedder singleton with CoreML/ANE execution provider benefits both the Semantic and Memory modules with no additional configuration.
