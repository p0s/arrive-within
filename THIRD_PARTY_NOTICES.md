# Third-party notices

This inventory distinguishes software shipped in the renderer from development/generation tools. Exact transitive versions are pinned in the relevant `pnpm-lock.yaml`; upstream license files in installed packages control.

## Shipped renderer dependencies

| Component | Version | License | Use | Upstream |
|---|---:|---|---|---|
| Ajv | 8.18.0 | MIT | Runtime JSON-schema validation | <https://github.com/ajv-validator/ajv> |
| Three.js | 0.184.0 | MIT | Bundled real-time garden rendering | <https://github.com/mrdoob/three.js> |
| fast-deep-equal | 3.1.3 | MIT | Bundled Ajv runtime dependency | <https://github.com/epoberezkin/fast-deep-equal> |
| fast-uri | 3.1.5 | BSD-3-Clause | Bundled Ajv runtime dependency | <https://github.com/fastify/fast-uri> |
| json-schema-traverse | 1.0.0 | MIT | Bundled Ajv runtime dependency | <https://github.com/epoberezkin/json-schema-traverse> |
| require-from-string | 2.0.2 | MIT | Ajv dependency retained conservatively in distribution notices | <https://github.com/floatdrop/require-from-string> |

No third-party image, texture, model, font, music, speech recording, or sample is bundled by these dependencies.

The renderer also uses the Mulberry32 deterministic pseudo-random algorithm by Tommy Ettinger, dedicated to the public domain under CC0 1.0, and the standardized FNV-1a algorithm described by RFC 9923. Their provenance is recorded in `Renderer/src/seeded.ts`.

## Bundled dependency license texts

The following notices are reproduced with the app because the production renderer bundle incorporates these components.

### Three.js

The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

### Ajv

The MIT License (MIT)

Copyright (c) 2015-2021 Evgeny Poberezkin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### fast-deep-equal and json-schema-traverse

MIT License

Copyright (c) 2017 Evgeny Poberezkin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### require-from-string

The MIT License (MIT)

Copyright (c) Vsevolod Strukchinsky <floatdrop@gmail.com> (github.com/floatdrop)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

### fast-uri

Copyright (c) 2011-2021, Gary Court until <https://github.com/garycourt/uri-js/commit/a1acf730b4bba3f1097c9f52e7d9d3aba8cdcaae>

Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team>

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

- Redistributions of source code must retain the above copyright notice,
  this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.
- The names of any contributors may not be used to endorse or promote
  products derived from this software without specific prior written
  permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDERS OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.

The complete contributor list is available at <https://github.com/garycourt/uri-js/graphs/contributors>.

## Development and media-generation tools

These tools are not linked into the native shipping app merely because the repository uses them to build, test, or generate evidence.

| Component | Version | License | Role |
|---|---:|---|---|
| TypeScript | 6.0.2 / 5.9.3 | Apache-2.0 | Renderer and marketing type checking |
| Vite | 8.0.4 | MIT | Renderer build |
| Vitest | 4.1.3 | MIT | Renderer tests |
| Next.js | 16.3.0 | MIT | Local App Store screenshot generator UI |
| React / React DOM | 19.2.7 | MIT | Local screenshot generator UI |
| JSZip | 3.10.1 | MIT OR GPL-3.0-or-later; this project uses the MIT option | Deterministic screenshot ZIP creation/readback |
| Playwright | 1.61.1 | Apache-2.0 | Local browser capture and rendered validation |
| Sharp | 0.35.3 | Apache-2.0 | Image validation/contact-sheet generation |
| tsx | 4.23.0 | MIT | TypeScript script execution |
| XcodeGen | 2.46 or later | MIT | Deterministic Xcode project generation |
| FFmpeg / ffprobe | local pinned evidence records exact build | upstream LGPL/GPL components depend on the local build | Local encoding and objective media inspection; no FFmpeg binary/library is bundled |

The screenshot generator’s complete dependency graph and licenses are fixed by `Marketing/AppStoreScreenshots/pnpm-lock.yaml`; the renderer graph is fixed by `Renderer/pnpm-lock.yaml`.

## Local narration tooling

Chatterbox source/package/model revisions are used only for private local auditions and prospective offline narration production. The public-safe evidence, MIT license sources, commercial/output-use source, and unresolved redistribution/human gates are recorded in `docs/audio/CHATTERBOX_RIGHTS.md`. No Chatterbox code, model weight, reference recording, or private audition is bundled in the app or licensed by this repository.

## Generated-media services

App-icon concepts record the exact generation prompts, output hashes, input-role boundary, and output-rights source in `docs/brand/provenance/2026-08-10/concept-board/`. The generation service/model is not shipped. Concept presence does not imply selection, trademark permission, or production approval.

## Apple platform software

SwiftUI, Foundation, Core Data, CloudKit, WebKit, AVFoundation, Speech, UserNotifications, and other Apple SDK frameworks are platform components governed by Apple’s terms and are not relicensed by this repository.

If a dependency, asset, or notice changes, update this file and its manifest in the same pull request. Do not rely on this summary in place of an upstream license.
