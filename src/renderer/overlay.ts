import type { AnswerPatch, Status, TranscriptLine } from '../shared/types';

interface OverlayApi {
  onStatus(cb: (status: Status) => void): void;
  onTranscript(cb: (line: TranscriptLine) => void): void;
  onAnswer(cb: (patch: AnswerPatch) => void): void;
  onClear(cb: () => void): void;
  ready(): void;
  toggleListen(): void;
  answerNow(): void;
  answerScreen(): void;
  toggleAuto(): void;
  clear(): void;
  setClickThrough(enabled: boolean): void;
  hide(): void;
  togglePin(): void;
  moveBegin(): void;
  moveEnd(): void;
  resizeBegin(): void;
  resizeTo(width: number | null, height: number | null): void;
  resizeEnd(): void;
  openContext(): void;
  openMaterials(): void;
  reloadMaterials(): void;
  quit(): void;
}

declare global {
  interface Window {
    cluely: OverlayApi;
  }
}

const COMPACT_HEIGHT = 58;
const PANEL_HEIGHT = 520;
const MAX_OVERLAY_HEIGHT = 390;
const MAX_ANSWER_AREA = 285;
const MAX_TRANSCRIPT_LINES = 40;
const MAX_CARDS = 3;

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

const answersEl = el('answers');
const transcriptEl = el('transcript');
const noticeEl = el<HTMLButtonElement>('notice');
const recEl = el('rec');
const chipMic = el('chip-mic');
const chipSys = el('chip-sys');
const chipDocs = el('chip-docs');
const btnListen = el<HTMLButtonElement>('btn-listen');
const btnAuto = el<HTMLButtonElement>('btn-auto');
const btnGhost = el<HTMLButtonElement>('btn-ghost');
const btnPin = el<HTMLButtonElement>('btn-pin');
const btnMore = el<HTMLButtonElement>('btn-more');
const moreMenu = el('more-menu');
const panelEl = el('panel');

interface CardNodes {
  root: HTMLElement;
  question: HTMLElement;
  body: HTMLElement;
}

const cards = new Map<string, CardNodes>();
const lines = new Map<string, HTMLElement>();
let ghost = false;
let fitFrame = 0;

function setWindowHeight(height: number): void {
  const target = Math.max(COMPACT_HEIGHT, Math.round(height));
  if (Math.abs(window.innerHeight - target) < 2) return;
  window.cluely.resizeBegin();
  window.cluely.resizeTo(null, target);
  window.cluely.resizeEnd();
}

function desiredHeight(): number {
  if (!panelEl.hidden) return PANEL_HEIGHT;

  let height = COMPACT_HEIGHT;
  if (!moreMenu.hidden) height += 43;
  if (!noticeEl.hidden) height += Math.max(34, noticeEl.scrollHeight);

  if (!answersEl.hidden && cards.size) {
    const answerHeight = Math.min(MAX_ANSWER_AREA, Math.max(118, answersEl.scrollHeight + 4));
    height += answerHeight;
  }

  return Math.min(MAX_OVERLAY_HEIGHT, height);
}

function scheduleFit(): void {
  if (fitFrame) cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    fitFrame = 0;
    setWindowHeight(desiredHeight());
  });
}

function friendlyProblem(problem: string | undefined): string | undefined {
  if (!problem) return undefined;
  if (/failed to get sources|screen access|screen recording/i.test(problem)) {
    return 'Call audio is blocked by macOS. Click here → enable Screen Recording for cluely/Electron → fully quit and reopen the app.';
  }
  if (/whisper_model|whisper model/i.test(problem)) {
    return 'Whisper needs a speech model. Click here to finish Setup.';
  }
  if (/ollama/i.test(problem) && /isn.t running|not reachable|could not reach/i.test(problem)) {
    return 'The answer model is not running. Click here to check Setup.';
  }
  return problem;
}

// ------------------------------------------------------------------ answers

function ensureCard(patch: AnswerPatch): CardNodes {
  const existing = cards.get(patch.id);
  if (existing) return existing;

  answersEl.hidden = false;

  const root = document.createElement('article');
  root.className = 'card';
  root.dataset.status = patch.status ?? 'thinking';

  const question = document.createElement('div');
  question.className = 'q';
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = patch.trigger === 'manual' ? 'ASKED' : 'THEM';
  const qtext = document.createElement('span');
  qtext.className = 'text';
  qtext.textContent = patch.question ?? '';
  question.append(tag, qtext);

  const body = document.createElement('div');
  body.className = 'a dots';

  root.append(question, body);
  answersEl.prepend(root);

  const nodes: CardNodes = { root, question: qtext, body };
  cards.set(patch.id, nodes);

  while (answersEl.querySelectorAll('.card').length > MAX_CARDS) {
    const last = answersEl.querySelector('.card:last-of-type');
    if (!last) break;
    for (const [id, card] of cards) {
      if (card.root === last) cards.delete(id);
    }
    last.remove();
  }

  scheduleFit();
  return nodes;
}

function applyAnswer(patch: AnswerPatch): void {
  // The answer is the primary UI. Close the controls automatically when the
  // other side asks something so the response gets the available space.
  moreMenu.hidden = true;
  const card = ensureCard(patch);
  if (patch.question !== undefined) card.question.textContent = patch.question;
  if (patch.body !== undefined) card.body.textContent = patch.body;
  if (patch.append) card.body.textContent = `${card.body.textContent ?? ''}${patch.append}`;
  if (patch.status) {
    card.root.dataset.status = patch.status;
    card.body.classList.toggle('dots', patch.status === 'thinking');
  }
  answersEl.scrollTop = 0;
  scheduleFit();
}

// --------------------------------------------------------------- transcript

function applyTranscript(line: TranscriptLine): void {
  let node = lines.get(line.id);
  if (!node) {
    node = document.createElement('div');
    node.className = 'line';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = line.speaker === 'me' ? 'ME' : 'THEM';
    const said = document.createElement('span');
    said.className = 'said';
    node.append(who, said);
    transcriptEl.append(node);
    lines.set(line.id, node);
  }

  node.dataset.speaker = line.speaker;
  node.dataset.final = String(line.final);
  const said = node.querySelector('.said');
  if (said) said.textContent = line.text;

  while (transcriptEl.children.length > MAX_TRANSCRIPT_LINES) {
    const first = transcriptEl.firstElementChild;
    if (!first) break;
    for (const [id, el2] of lines) {
      if (el2 === first) lines.delete(id);
    }
    first.remove();
  }
}

// ------------------------------------------------------------------- status

function applyStatus(status: Status): void {
  recEl.dataset.state = status.state;
  btnListen.textContent = status.state === 'idle' || status.state === 'error' ? 'Listen' : 'Stop';
  btnListen.dataset.on = String(status.state === 'listening' || status.state === 'starting');
  btnAuto.dataset.on = String(status.autoAnswer);
  btnGhost.dataset.on = String(status.clickThrough);
  btnPin.dataset.on = String(status.pinned);

  chipMic.dataset.live = status.mic.error ? 'error' : String(status.mic.capturing && status.mic.stt === 'up');
  chipSys.dataset.live = status.system.error ? 'error' : String(status.system.capturing && status.system.stt === 'up');
  chipMic.title = status.mic.error ?? `mic: ${status.mic.capturing ? 'capturing' : 'off'} / speech ${status.mic.stt}`;
  chipSys.title = status.system.error ?? `call audio: ${status.system.capturing ? 'capturing' : 'off'} / speech ${status.system.stt}`;

  const indexed = status.materials && status.materials !== 'none';
  chipDocs.dataset.live = String(Boolean(indexed));
  chipDocs.title = indexed ? `Prep indexed: ${status.materials}` : 'No prep files indexed';

  const rawProblem = status.message ?? status.mic.error ?? status.system.error;
  const problem = friendlyProblem(rawProblem);
  noticeEl.textContent = problem ?? '';
  noticeEl.hidden = !problem;
  scheduleFit();
}

// ------------------------------------------------------------------- wiring

window.cluely.onAnswer(applyAnswer);
window.cluely.onTranscript(applyTranscript);
window.cluely.onStatus(applyStatus);
window.cluely.onClear(() => {
  cards.clear();
  lines.clear();
  answersEl.replaceChildren();
  transcriptEl.replaceChildren();
  answersEl.hidden = true;
  moreMenu.hidden = true;
  scheduleFit();
});

btnListen.addEventListener('click', () => window.cluely.toggleListen());
btnAuto.addEventListener('click', () => window.cluely.toggleAuto());
el('btn-clear').addEventListener('click', () => window.cluely.clear());
el('btn-context').addEventListener('click', () => window.cluely.openContext());
el('btn-materials').addEventListener('click', () => window.cluely.openMaterials());
el('btn-screen').addEventListener('click', () => window.cluely.answerScreen());
el('btn-hide').addEventListener('click', () => window.cluely.hide());
btnPin.addEventListener('click', () => window.cluely.togglePin());
el('btn-quit').addEventListener('click', () => window.cluely.quit());

btnMore.addEventListener('click', () => {
  moreMenu.hidden = !moreMenu.hidden;
  scheduleFit();
});

chipDocs.addEventListener('click', () => window.cluely.reloadMaterials());

btnGhost.addEventListener('click', () => {
  ghost = !ghost;
  window.cluely.setClickThrough(ghost);
});

// Panel code lives in panels.ts. Observe it here so opening setup/files/notes
// automatically gives the panel room and closing it returns to the tiny bar.
new MutationObserver(() => {
  if (!panelEl.hidden) {
    moreMenu.hidden = true;
    setWindowHeight(PANEL_HEIGHT);
  } else {
    answersEl.hidden = cards.size === 0;
    scheduleFit();
  }
}).observe(panelEl, { attributes: true, attributeFilter: ['hidden'] });

// -------------------------------------------------------------- move / resize

function makeGrip(id: string, axis: 'x' | 'y' | 'both'): void {
  const grip = el(id);
  let offset: { x: number; y: number } | undefined;

  grip.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    offset = {
      x: window.innerWidth - event.clientX,
      y: window.innerHeight - event.clientY,
    };
    window.cluely.resizeBegin();
  });

  grip.addEventListener('pointermove', (event: PointerEvent) => {
    if (!offset) return;
    window.cluely.resizeTo(
      axis === 'y' ? null : Math.round(event.clientX + offset.x),
      axis === 'x' ? null : Math.round(event.clientY + offset.y),
    );
  });

  const finish = (event: PointerEvent) => {
    if (!offset) return;
    offset = undefined;
    if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
    window.cluely.resizeEnd();
  };
  grip.addEventListener('pointerup', finish);
  grip.addEventListener('pointercancel', finish);
}

const dragSurface = document.querySelector('.drag-surface');
if (dragSurface) {
  let dragging = false;
  dragSurface.addEventListener('pointerdown', (event) => {
    const pointer = event as PointerEvent;
    if (pointer.button !== 0) return;
    if ((pointer.target as HTMLElement).closest('button, .chip')) return;
    pointer.preventDefault();
    (dragSurface as HTMLElement).setPointerCapture(pointer.pointerId);
    dragging = true;
    window.cluely.moveBegin();
  });

  const stopDrag = (event: Event) => {
    if (!dragging) return;
    dragging = false;
    const pointer = event as PointerEvent;
    if ((dragSurface as HTMLElement).hasPointerCapture(pointer.pointerId)) {
      (dragSurface as HTMLElement).releasePointerCapture(pointer.pointerId);
    }
    window.cluely.moveEnd();
  };
  dragSurface.addEventListener('pointerup', stopDrag);
  dragSurface.addEventListener('pointercancel', stopDrag);
}

makeGrip('grip-right', 'x');
makeGrip('grip-bottom', 'y');
makeGrip('grip-corner', 'both');

// Ghost mode makes the window click-through. Give the bar its clicks back while
// the pointer is over it; the global hotkey remains the guaranteed escape hatch.
document.querySelector('.bar')?.addEventListener('mouseenter', () => {
  if (ghost) window.cluely.setClickThrough(false);
});
document.addEventListener('mouseleave', () => {
  if (ghost) window.cluely.setClickThrough(true);
});

window.cluely.ready();
scheduleFit();
