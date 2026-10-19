# SCN-014 — Privacy and Support links

Date: 2026-08-12
Status: source/config verified; frozen-candidate link proof pending

Version 1.0 has no feedback composer, endpoint binding, transport dependency, automatic support upload, or reachable send action. Settings exposes only ordinary links to `https://psapps.xyz/arrive-within/#privacy` and `https://psapps.xyz/arrive-within/#support`; opening either link attaches no Arrive Within data.

The app target and regenerated project do not link `ArriveWithinFeedback`. `Info.plist` and Base configuration contain no feedback endpoint. English and German retain only the direct Privacy and Support labels. The source-retained feedback package and reference receiver are explicitly non-shipping and do not affect the V1 App Privacy answer, which remains **Data Not Collected**.

Focused source validators pass the endpoint/UI absence, target isolation, empty collected-data manifest, and exact URL checks. The exact selected build-7 archive has no feedback endpoint or surface, and the owner-confirmed physical Garden-first flow includes the direct Settings links; public HTTPS readback passes. No deployed receiver is required for V1. A separate exact physical tap-through of both links remains accessibility/runtime evidence rather than feedback-transport proof.
