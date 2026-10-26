# New generation and three sequential increments

Test date: 2026-10-27, Asia/Shanghai.

Status: **PASS**. All four website jobs completed successfully before this report was committed.

Application: Eazo Counter QA. Website requirement: `req_web_1793054489565_6ce23a3c`.

[Open the generated application details](https://mig-everything.github.io/loop-collab-dashboard/eazo/detail.html?id=req_web_1793054489565_6ce23a3c) (admin login required).

## Contract

All application UI locators, test steps and expected values are English. Android runs with `en-US`; HarmonyOS runs with `en-Latn-US`. Each round starts from a fresh app process at `Count: 0`.

| Round | Requested change | Retained behavior |
| --- | --- | --- |
| New | Increase adds exactly one | Initial count is zero |
| Increment 1 | Reset sets the count to zero | Increase still adds one |
| Increment 2 | Decrease subtracts one, clamped at zero | Increase and Reset still work |
| Increment 3 | Add five adds exactly five | Increase, Decrease, Reset and the lower bound still work |

## Results

| Round | HarmonyOS build | Android build | English UI assertions, both platforms | Source ZIPs | Retained increments |
| --- | --- | --- | --- | --- | --- |
| New | 297.3 s | 269.0 s | 6/6 passed | 2/2 passed | 0 |
| Increment 1: Reset | 291.4 s | 131.0 s | 10/10 passed | 2/2 passed | 1 |
| Increment 2: Decrease | 283.2 s | 108.6 s | 14/14 passed | 2/2 passed | 2 |
| Increment 3: Add five | 237.7 s | 89.4 s | 22/22 passed | 2/2 passed | 3 |

Eight real platform builds, 52 English UI assertions and eight authenticated source downloads passed. Every downloaded archive passed ZIP integrity checks and matched the corresponding generated project's source bytes. All four versions retained the same bundle identifier, `io.eazo.a474af84`, on both platforms. Each increment inherited the previous successful version; earlier versions' source files remained unchanged.

The website retained all three incremental prompts in order. The protected analytics API recorded one generation and three increments, all with successful outcomes, exact submitted prompts, and a captured visitor IP from `cf-connecting-ip`. No IP addresses or login credentials are included in this report.

The final interaction sequence also verified Add five → Count: 5, Decrease → Count: 4, Increase → Count: 5, Reset → Count: 0. Generated evaluation scores were not used as proof of functional correctness.

## Fixes verified

Incremental snapshots previously read only the current engine requirement's immediate increment list. After advancing the baseline, earlier increments could disappear from the website. The runner now follows requirement ancestry and returns a cumulative, ordered, deduplicated history, including failed attempts. Missing ancestors and ancestry cycles fail explicitly. Four regression tests cover these cases. The runner also surfaces engine future exceptions immediately, including failures occurring before a child is created.

The detail page now waits until the current job finishes before requesting its comparison report. Browser verification observed zero premature report requests while a job was running and a visible comparison table after completion.

`node tests/service.mjs` passed authentication, session expiry/revocation, permissions, CORS, visit deduplication, IP capture, prompt auditing, job authorization, leases and result synchronization. `tests/incremental_bridge.py` passed baseline preservation, isolated outputs, real orchestrator invocation and build/commit pipeline reuse.

## Environment and reproduction

A concurrent Cofi evaluation took control of the first shared HarmonyOS emulator despite its advisory lease. The original failure evidence was retained, and unchanged artifacts for all four versions were rechecked successfully on a separate emulator at `127.0.0.1:10088`. Initial emulator launcher and lock-screen failures were resolved before final app checks. The test harness validates launch output, waits for the target foreground bundle and keeps devices awake. Generated application source was not manually patched.

The service repository contains `tests/fixtures/eazo-counter-plan.json`, `tests/e2e_devices.py`, `tests/test_incremental_history.py` and `tests/verify_e2e_evidence.py`. No read-only benchmark gold datasets were changed.

Local device dumps, screenshots, API snapshots, failed environment attempts, source archives, hashes and the machine-checked summary are retained in `output/playwright/eazo-qa-20261027/`, excluded from Git.
