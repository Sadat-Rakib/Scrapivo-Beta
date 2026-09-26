# PERSONALIZED_QUESTION_AUDIT

Flows: (1) deterministic `outreach-draft.ts`; (2) 360 LLM
`outreach.functions.ts:43 → entity-draft.server.ts (research, t=0.7)`; (3) research
`run-research.server.ts (t=0.3) → generateOutreach (extract, t=0.6)`, PRIMARY HOOK
rule; (4) clarifier `clarify-ai.functions.ts + question-generator.server.ts`;
relevance `scoring.ts`, `intent-lexicon.ts:buildIntentWhy`,
`card-adapters.ts:generateRelevantBecause`.

## P0: dead dispatch `src/lib/outreach-draft.ts:322-341`

`case "company": case "job": return companyEmail/...; default: return investorEmail/...`
leaves `jobEmail/jobMessage` (sole `two smart questions` owners) unreachable; any
`vertical==undefined|"business"|typo` → investor raise pitch. Test
`outreach-draft.test.ts:15` codifies it. Contributors: 4 mismatched enums (no mapper);
`discover.tsx:320-331,970-981` forces person→investor; `thesisBits()` `—`-only split
vs `. ` producers; hook-rewrite fake-specificity; clarifier cross-vertical leaks.

## Groundedness rule (locked)

Facts vs Signals vs Relevance separated; templates/LLM use only supplied fields with
`{source,source_url,confidence,timestamp,method}`; missing ⇒ omit, never invent.
Relevance computed per query (deterministic rank → LLM only for shown leads).
Fix needs approval: dispatch + vertical mapper + grounded prompts + fixtures.
