# cluely

A desktop copilot for live calls. It listens to your microphone and the audio your computer is playing, transcribes the two streams separately, detects questions from the other side, retrieves relevant prep material, and streams an answer into a floating overlay.

The default stack is local: whisper.cpp for speech-to-text, Ollama for answers and retrieval embeddings. Your call audio and prep material do not need to leave your machine.

```text
 mic ─────────────► whisper.cpp (ME)   ─┐
                                        ├─► transcript ─► question? ─┐
 system loopback ─► whisper.cpp (THEM) ─┘                            │
                                                                     ▼
                     Files / Notes ──► retrieve context ──► Ollama ──► overlay
```

## What the app now handles for you

The overlay has an in-app **Setup** panel, **Notes** editor, and **Files** library. You should not need Cursor just to prepare for a call.

- **Setup** checks the Whisper binary/model, macOS Screen Recording and Microphone permissions, Ollama, and the answer/embed/vision models.
- **Whisper model** can be selected from disk or downloaded as `ggml-base.en.bin` from Setup. The app also auto-detects common model locations such as `~/ggml-base.en.bin`.
- **Notes** edits the always-included context inside the overlay instead of opening `context.md` in your default editor.
- **Files** lets you select prep material from the app, creates local text copies for indexing, and shows the indexed library. Text/Markdown work everywhere; on macOS Word/RTF-family documents are converted locally and PDFs are extracted locally when possible.
- **Movement** has a dedicated `⋮⋮ drag` area so the overlay is easy to reposition.
- **Resize** targets are larger: use the right edge, bottom edge, or visible bottom-right corner grip.
- **Ghost** has a recovery hotkey: `⌘/Ctrl+Shift+G` toggles click-through even when the overlay itself cannot be clicked.
- **Reset window** in Setup restores the overlay to a reachable default size/position.

## Setup

Requires Node 20+. On macOS, Apple Silicon with 16GB+ is recommended because local answer generation and two transcription streams are a real workload.

### 1. Install the local engines

```bash
brew install whisper-cpp
```

Install Ollama, launch it, then pull the default models:

```bash
ollama pull llama3.1:8b       # answers
ollama pull nomic-embed-text  # semantic retrieval over your files
ollama pull llava:7b          # optional: screen questions
```

You no longer need to manually download the Whisper model in Terminal. Open **Setup → Download base.en** after starting the app. If you already have a ggml model, use **Setup → Choose…** instead.

### 2. Install and start the app

```bash
git clone https://github.com/riyagoelrs/cluelydupe.git
cd cluelydupe
npm install
npm start
```

`.env` is optional for overrides. The app can configure the Whisper model through Setup and persists that choice in its per-user configuration.

For command-line diagnostics you can still use:

```bash
npm run doctor
npm run typecheck
npm test
npm run check:resize
```

### 3. macOS permissions

Capturing the other person requires access to the audio your Mac is playing. On macOS 14.4+ that goes through ScreenCaptureKit and therefore requires **Screen Recording / Screen & System Audio Recording** permission.

Open **Setup** and use the **Open Settings** buttons for:

- Screen Recording / Screen & System Audio Recording
- Microphone

After granting **Screen Recording**, **fully quit cluely and reopen it**. macOS does not grant that capability to an already-running Electron process. A bare Electron `Failed to get sources` error is usually this permission problem.

If system loopback is still silent on an older macOS version, use BlackHole and set `SYSTEM_AUDIO_DEVICE=BlackHole`.

## Preparing answers

### Notes

Click **Notes** and keep the always-relevant facts here: who you are, the role or meeting, resume facts, deal details, stories, numbers you blank on, and answer-style constraints. Save inside the overlay. The file is re-read for every answer, so edits take effect during the call.

### Files

Click **Files → Add files…** and select your interview prep, technical notes, deal sheets, product docs, past call notes, or other reference material.

The answer model is not being fine-tuned or retrained. This is retrieval-augmented generation (RAG): the app indexes your local material, finds the passages that match each incoming question, and puts only those passages in front of the answer model.

The index itself consumes `.md`, `.markdown`, `.txt`, and `.text` files. The Files importer converts supported source documents into local `.txt` copies before indexing:

- `.txt`, `.md`, `.csv`, `.json`, `.yaml`: imported directly
- `.doc`, `.docx`, `.rtf`, `.odt` on macOS: converted locally with `textutil`
- `.pdf`: tries local `pdftotext`; on macOS it also tries Spotlight metadata extraction

For the most reliable PDF extraction on macOS:

```bash
brew install poppler
```

Nothing is uploaded by the Files importer. With `ANSWER_PROVIDER=ollama`, retrieval and answering stay local.

## Using it on a call

Hit **Listen**, then join the call normally. The transcript strip shows `ME` and `THEM` separately. Question-shaped final utterances from `THEM` trigger answers automatically when **Auto** is on.

| Hotkey | Action |
|---|---|
| `⌘/Ctrl+Shift+L` | Start / stop listening |
| `⌘/Ctrl+Shift+Space` | Answer whatever they just said now |
| `⌘/Ctrl+Shift+S` | Answer using the current screen |
| `⌘/Ctrl+Shift+G` | Toggle Ghost / click-through |
| `⌘/Ctrl+Shift+H` | Hide / show the overlay |
| `⌘/Ctrl+Shift+K` | Clear transcript and answers |
| `⌘/Ctrl+Shift+P` | Pin / unpin the overlay |
| `⌘/Ctrl+Shift+←/→` | Nudge the overlay sideways |
| `⌘/Ctrl+Shift+Q` | Quit |

### Move and resize

Drag the dedicated **`⋮⋮ drag`** area at the top to move the overlay. Buttons and status chips remain clickable rather than becoming accidental drag targets.

Resize from the **right edge**, **bottom edge**, or the larger visible **bottom-right corner grip**. Size and position are remembered between runs. If a saved position becomes awkward after a monitor change, open **Setup → Reset window**.

### Ghost

Ghost makes the overlay click-through so mouse input reaches the app underneath it. Because click-through necessarily makes the overlay difficult to click, use **`⌘/Ctrl+Shift+G`** as the reliable way to turn Ghost back off.

### Pin

Pinned mode floats above normal and full-screen call windows and follows you across workspaces. Turn Pin off when you want the overlay to behave like a normal window that other apps can cover.

### Screen

`⌘/Ctrl+Shift+S` temporarily hides the overlay, captures the primary display, and sends the image to `OLLAMA_VISION_MODEL`. This is useful when the question depends on something visual that audio alone cannot describe. Vision is usually slower than text-only answering.

## Configuration

The common setup is now handled in the UI. `.env` remains available for advanced overrides.

| Variable | Default | Purpose |
|---|---|---|
| `STT_PROVIDER` | `whisper` | Set `deepgram` for cloud transcription |
| `ANSWER_PROVIDER` | `ollama` | Set `claude` for cloud answers |
| `WHISPER_MODEL` | auto-detect / Setup | Optional explicit ggml model path |
| `WHISPER_BINARY` | `whisper-cli` | whisper.cpp CLI path/name |
| `OLLAMA_MODEL` | `llama3.1:8b` | Text answer model |
| `OLLAMA_VISION_MODEL` | `llava:7b` | Screen-question model |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Semantic retrieval model; blank disables embeddings |
| `MATERIALS_TOP_K` | `4` | Number of matching passages placed in the prompt |
| `ANSWER_MAX_TOKENS` | `1200` | Maximum answer generation length |
| `AUTO_ANSWER` | `true` | Automatically answer detected questions |
| `SYSTEM_AUDIO_DEVICE` | empty | Optional virtual-cable/monitor source |
| `CONTENT_PROTECTION` | `true` | Ask the OS to exclude the overlay from captures where supported |

### Model choices

| | Faster | Default | Sharper |
|---|---|---|---|
| Whisper | `ggml-tiny.en.bin` | **`ggml-base.en.bin`** | `ggml-small.en.bin` |
| Ollama | `llama3.2:3b` | **`llama3.1:8b`** | `qwen2.5:14b` |

For live calls, time-to-first-token matters more than benchmark quality. If answers routinely arrive after the moment has passed, drop a model tier before adding more prompt complexity.

## Rehearsal

Before an important call, put realistic questions in `rehearsal.txt` and run:

```bash
cp rehearsal.example.txt rehearsal.txt
npm run rehearse
```

This uses the same prompt, retrieval path, and answer model as the app and reports time to first token, total generation time, and answer length.

You can compare models without changing config:

```bash
npm run rehearse -- --model llama3.2:3b
```

## Architecture

```text
src/main/
  main.ts              live audio/answer orchestration, hotkeys, IPC
  operator-ui.ts       Setup, Notes, file-import and reset-window controller
  stt/
    whisper.ts         local transcription through whisper.cpp subprocesses
    vad.ts             utterance segmentation + WAV encoding
    deepgram.ts        cloud STT alternative
  answer/
    ollama.ts          local streaming answers
    claude.ts          cloud answer alternative
  materials.ts         local chunking, keyword retrieval, semantic ranking
  prompt.ts            answer prompt
  screen.ts            still-screen capture
  transcript.ts        rolling ME/THEM transcript
  question-detector.ts local question heuristic
  answer-engine.ts     prompt construction, retrieval and streaming
  windows.ts           overlay + hidden audio-capture window
src/renderer/
  capture.ts           browser audio graph → 16 kHz PCM
  overlay.*            live overlay/transcript UI
  panels.ts            in-app Setup, Notes and Files UI
src/preload/
  overlay-preload.ts   isolated renderer/main bridge
```

Whisper runs as a subprocess rather than an Electron native addon, avoiding Electron ABI rebuild problems. Audio is written only as short-lived temporary WAV clips for Whisper and deleted after transcription. Transcripts are held in memory and disappear with the process.

## Testing notes

The repository includes logic/audio tests, a smoke test, and a real Electron resize-drag check:

```bash
npm run typecheck
npm test
npm run smoke
npm run check:resize
```

A headless environment cannot prove that your physical microphone, macOS Screen Recording entitlement, system loopback, and local model weights work together on your specific Mac. After the code checks pass, test **THEM** against a YouTube video before relying on it in a real call.

## Before using it in a real meeting or interview

Local processing does not remove consent, workplace, interview, or recording-law requirements. Some jurisdictions require all participants to consent to recording, and some interviews or assessments prohibit outside assistance regardless of whether the tool is visible. Use the assistant only where its use is permitted and disclose recording/AI assistance when required.
