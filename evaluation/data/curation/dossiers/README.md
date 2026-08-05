# Source-pair curation dossiers

This directory prepares a locally validated vulnerable/patched source pair for a future **targeted internal** evaluation case. It is evaluator-only and is never mounted into an audit agent.

A dossier binds one source-pair manifest to independent advisory provenance and records only source-backed preparation: the review question, the narrow source area to inspect, and the paired-negative condition. It is neither an answer key nor a reviewed plan. In particular, a dossier must not be used as model input, a deterministic finding rule, a readiness contribution, or evidence of model quality.

## Statuses

| Status | Meaning | Next step |
| --- | --- | --- |
| `materialized` | A separate research-corpus case already has an AI-assisted key and reviewed plan. | It can be used for diagnostic provider evaluation only. |
| `ready-for-key-authoring` | The pair, advisory, source anchor, review question, and patched-negative condition are known. | Create a separate AI-assisted answer key, reviewed plan, and isolated corpus copy. |

## Required dossier content

Every dossier records the snapshot id and pair digest, both immutable revisions, source/research references, a source-only review question, the vulnerable and patched source anchors, the paired-negative condition, and known scope limitations. A future key must be authored independently from this preparation and must keep the answer key outside the agent target view.

The acquisition workspace remains closed: do not place these dossiers in `evaluation/data/acquisition/snapshots/`.
