# Session generation and Player corrections

Changes were implemented in increasing order of complexity on the existing branch.

- The check-in uses the same region selector as the weekly Composer: Abdos / gainage, Dos, upper/lower and Full Body. Core remains the internal identifier.
- Overview rows offer a direct swap action. Loading, errors and lack of alternatives are visible instead of silently removing the action.
- Native Strength/cardio blocks select the environment Player from the actual payload, even when Composer source metadata is missing.
- Both Players track at least three warm-up rounds; exercises are completed only on the final round. Round state survives opening the overview and swaps within the same in-memory session.
- Pistol EX478 is unilateral in the catalogue and common prescriptions. Skill fitting counts both sides, including rests/setup. A five-minute allocation can reduce six repetitions per side to five to respect its existing buffer.
- Specific preparation excludes the Tabata's functional families while continuing to derive targets from the final Skill/WOD.
- Full Body repair can append a complementary WOD exercise, not just replace an existing station. It recompiles the complete workload and applies the existing safety, equipment and time gates. Missing-region repair takes priority over the soft score floor; other improvements retain that floor. Active C4 plans with unresolved coverage do not report READY. Exact retests keep their dedicated identity protections.
- Composer automatic defaults prioritize missing upper/lower coverage across training blocks. User selections remain editable.
- Back selection uses primary Grand Dorsal, Lombaires or Trapezes catalogue links, without inventing a Back body_region. The stimulus builder, candidate pool, Skill path selection, final candidate gate and Gym region resolver accept the target. Bodyweight back work remains possible without pretending a pulling load or equipment exists.

Backend migrations are applied on DEV. Existing started sessions are not rewritten. The interface changes require the frontend branch to be integrated/deployed; a successful local web export is not a deployment.

Follow-up: final signature selection excludes the functional families of the actual WOD, Skill and preparation. It reselects the signature rather than changing a selected WOD target. The WOD persistence boundary also rejects a recompile/format change that would reintroduce a signature family, including when the Tabata has already been performed. The live session is not silently rewritten.

Timed movements in the Circuit/AMRAP/For Time work lists have individual countdown controls derived from numeric duration prescriptions (for example Hollow Hold 35 seconds). Local pause/reset is available, the main WOD pause freezes the countdown, and a new round resets it. Repetition counts and block budgets are never interpreted as hold durations. This is a local execution aid, not proof that the movement was performed.

Validation: 13 Composer regression checks, Strength routing/warm-up navigation checks, Expo web export, unilateral Skill SQL checks, 30-minute Full Body coverage and preparation exclusions, Back primary-muscle selection, and the existing environment plan matrix. The global backend suite still has its previously documented SAFE-001 catalogue gaps; it is not claimed green.
