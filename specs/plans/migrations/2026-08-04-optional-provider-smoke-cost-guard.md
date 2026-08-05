# Optional provider-smoke cost guard

Date: 2026-08-04

## Change

The one-case provider smoke accepts an absent observed-cost ceiling. When an
operator configures one, it remains the shared observed-cost dispatch guard:
the request that crosses it is retained and only later dispatches stop.

## Reason

The normal provider evaluator and the public operational guidance already
describe the ceiling as optional. Requiring it in the smoke command was a
legacy configuration gate that prevented a valid diagnostic before any source
or provider work began.

## Clean break

There is no compatibility behavior to retain. The current smoke configuration
accepts either an absent guard or one strict positive value; no fixed source,
tool, output, or work limit is introduced.

## Verification

Parser tests cover both configured and absent guards. The normal smoke
lifecycle test continues to prove source-free artifact handling with an
in-process provider.
