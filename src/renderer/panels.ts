import type { MaterialImportResult, SetupState, Status } from '../shared/types';

type PanelApi = {
  reloadMaterials(): void;
  resetWindow(): void;
  getContext(): Promise<string>;
  saveContext(text: string): Promise<boolean>;
  listMaterials(): Promise<string[]>;
  importMaterials(): Promise<MaterialImportResult>;
  revealMaterials(): Promise<string>;
  getSetup(): Promise<SetupState>;
  chooseWhisperModel(): Promise<SetupState>;
  downloadWhisperModel(): Promise<SetupState>;
  openPrivacySettings(kind: 'screen' | 'microphone'): Promise<void>;
};

const api = window.cluely as typeof window.cluely & PanelApi;
const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

type PanelName = 'notes' | 'materials' | 'setup';
const answersEl = el('answers');
const noticeEl = el<HTMLButtonElement>('notice');
const panelEl = el('panel');
const panelTitle = el('panel-title');
const panelSubtitle = el('panel-subtitle');
const panelNotes = el('panel-notes');
const panelMaterials = el('panel-materials');
const panelSetup = el('panel-setup');
const contextEditor = el<HTMLTextAreaElement>('context-editor');
const contextFeedback = el('context-feedback');
const materialsFeedback = el('materials-feedback');
const materialsList = el('materials-list');
const setupFeedback = el('setup-feedback');
const btnSetup = el<HTMLButtonElement>('btn-setup');

let activePanel: PanelName | undefined;
let setupAutoOpened = false;
let lastStatus: Status | undefined;

function setFeedback(target: HTMLElement, value: unknown, kind: 'ok' | 'error' | '' = ''): void {
  target.textContent = value instanceof Error ? value.message : String(value ?? '');
  target.dataset.kind = kind;
}

function setPanelView(name: PanelName): void {
  panelNotes.hidden = name !== 'notes';
  panelMaterials.hidden = name !== 'materials';
  panelSetup.hidden = name !== 'setup';
}

async function openPanel(name: PanelName): Promise<void> {
  activePanel = name;
  panelEl.hidden = false;
  answersEl.hidden = true;
  setPanelView(name);

  if (name === 'notes') {
    panelTitle.textContent = 'Notes';
    panelSubtitle.textContent = 'Always included with every answer. Edits apply immediately after Save.';
    contextFeedback.textContent = 'Loading…';
    try {
      contextEditor.value = await api.getContext();
      contextFeedback.textContent = '';
      contextEditor.focus();
    } catch (err) {
      setFeedback(contextFeedback, err, 'error');
    }
    return;
  }

  if (name === 'materials') {
    panelTitle.textContent = 'Files';
    panelSubtitle.textContent = 'Prep material is indexed locally and retrieved per question.';
    api.reloadMaterials();
    await refreshMaterials();
    return;
  }

  panelTitle.textContent = 'Setup';
  panelSubtitle.textContent = 'Everything needed for a live call, in one place.';
  await refreshSetup();
}

function closePanel(): void {
  activePanel = undefined;
  panelEl.hidden = true;
  answersEl.hidden = false;
}

async function refreshMaterials(): Promise<void> {
  materialsFeedback.textContent = 'Loading…';
  materialsFeedback.dataset.kind = '';
  try {
    const files = await api.listMaterials();
    materialsList.replaceChildren();
    if (!files.length) {
      const empty = document.createElement('div');
      empty.className = 'file-empty';
      empty.textContent = 'No prep files yet. Click “Add files…” to import them.';
      materialsList.append(empty);
    } else {
      for (const file of files) {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.textContent = file;
        materialsList.append(item);
      }
    }
    materialsFeedback.textContent = lastStatus?.materials && lastStatus.materials !== 'none'
      ? `Indexed: ${lastStatus.materials}`
      : `${files.length} file${files.length === 1 ? '' : 's'}`;
  } catch (err) {
    setFeedback(materialsFeedback, err, 'error');
  }
}

function formatImportResult(result: MaterialImportResult): string {
  const parts: string[] = [];
  if (result.added.length) parts.push(`Added ${result.added.length}: ${result.added.join(', ')}`);
  if (result.errors.length) parts.push(result.errors.join('\n'));
  return parts.join('\n') || 'Nothing was added.';
}

function setDot(id: string, state: 'ok' | 'warn' | 'bad'): void {
  el(id).dataset.state = state;
}

function renderSetup(state: SetupState): void {
  setDot('setup-cli-dot', state.whisperBinary.ok ? 'ok' : 'bad');
  el('setup-cli-text').textContent = state.whisperBinary.ok
    ? `Found ${state.whisperBinary.value}`
    : 'Not found. Install once in Terminal: brew install whisper-cpp';

  setDot('setup-model-dot', state.whisperModel.ok ? 'ok' : 'bad');
  el('setup-model-text').textContent = state.whisperModel.ok
    ? state.whisperModel.path
    : 'No model selected. Choose an existing .bin or download base.en here.';

  const screenOk = state.screenPermission === 'granted' || state.screenPermission === 'unknown';
  setDot('setup-screen-dot', screenOk ? 'ok' : 'bad');
  el('setup-screen-text').textContent = state.screenPermission === 'granted'
    ? 'Granted — system audio capture can run.'
    : state.screenPermission === 'unknown'
      ? 'Not gated by macOS on this platform.'
      : `${state.screenPermission}. Enable Screen Recording, then fully quit and reopen cluely.`;

  const micOk = state.microphonePermission === 'granted' || state.microphonePermission === 'unknown';
  const micWaiting = state.microphonePermission === 'not-determined';
  setDot('setup-mic-dot', micOk ? 'ok' : micWaiting ? 'warn' : 'bad');
  el('setup-mic-text').textContent = state.microphonePermission === 'granted'
    ? 'Granted.'
    : state.microphonePermission === 'unknown'
      ? 'Not gated by macOS on this platform.'
      : micWaiting
        ? 'Not requested yet — macOS will ask when Listen starts.'
        : `${state.microphonePermission}. Enable Microphone access.`;

  setDot('setup-ollama-dot', state.ollama.running ? 'ok' : 'bad');
  el('setup-ollama-text').textContent = state.ollama.running
    ? `Running at ${state.ollama.url}`
    : `Not reachable at ${state.ollama.url}. Open Ollama or run “ollama serve”.`;

  const models = [state.ollama.answerModel, state.ollama.embedModel, state.ollama.visionModel];
  const missing = models.filter((model) => !model.ok).map((model) => model.name).filter(Boolean);
  setDot('setup-models-dot', missing.length ? 'warn' : 'ok');
  el('setup-models-text').textContent = missing.length
    ? `Missing: ${missing.join(', ')}. Pull with: ${missing.map((name) => `ollama pull ${name}`).join(' · ')}`
    : 'Answer, embedding, and screen models are available.';

  const critical = !state.whisperBinary.ok || !state.whisperModel.ok || !screenOk ||
    !state.ollama.running || !state.ollama.answerModel.ok;
  btnSetup.dataset.issue = String(critical);
}

async function refreshSetup(): Promise<void> {
  setupFeedback.textContent = 'Checking…';
  setupFeedback.dataset.kind = '';
  try {
    renderSetup(await api.getSetup());
    setupFeedback.textContent = '';
  } catch (err) {
    setFeedback(setupFeedback, err, 'error');
  }
}

function intercept(id: string, handler: () => void): void {
  el(id).addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    handler();
  }, true);
}

intercept('btn-context', () => void openPanel('notes'));
intercept('btn-materials', () => void openPanel('materials'));
intercept('chip-docs', () => void openPanel('materials'));
el('btn-setup').addEventListener('click', () => void openPanel('setup'));
el('panel-close').addEventListener('click', closePanel);

noticeEl.addEventListener('click', () => {
  if (btnSetup.dataset.issue === 'true') void openPanel('setup');
});

el('context-save').addEventListener('click', async () => {
  const button = el<HTMLButtonElement>('context-save');
  button.disabled = true;
  contextFeedback.textContent = 'Saving…';
  try {
    await api.saveContext(contextEditor.value);
    setFeedback(contextFeedback, 'Saved. New answers will use these notes.', 'ok');
  } catch (err) {
    setFeedback(contextFeedback, err, 'error');
  } finally {
    button.disabled = false;
  }
});

el('materials-add').addEventListener('click', async () => {
  const button = el<HTMLButtonElement>('materials-add');
  button.disabled = true;
  materialsFeedback.textContent = 'Importing and indexing…';
  try {
    const result = await api.importMaterials();
    setFeedback(materialsFeedback, formatImportResult(result), result.errors.length ? 'error' : 'ok');
    await refreshMaterials();
  } catch (err) {
    setFeedback(materialsFeedback, err, 'error');
  } finally {
    button.disabled = false;
  }
});

el('materials-refresh').addEventListener('click', async () => {
  api.reloadMaterials();
  await refreshMaterials();
  setFeedback(materialsFeedback, 'Re-index requested.', 'ok');
});
el('materials-reveal').addEventListener('click', () => void api.revealMaterials());

el('setup-refresh').addEventListener('click', () => void refreshSetup());
el('setup-reset-window').addEventListener('click', () => api.resetWindow());
el('setup-screen-settings').addEventListener('click', async () => {
  await api.openPrivacySettings('screen');
  setFeedback(setupFeedback, 'After enabling Screen Recording, fully quit and reopen cluely.', 'ok');
});
el('setup-mic-settings').addEventListener('click', async () => {
  await api.openPrivacySettings('microphone');
  setFeedback(setupFeedback, 'Enable microphone access, then return here and Refresh checks.', 'ok');
});
el('setup-choose-model').addEventListener('click', async () => {
  setupFeedback.textContent = 'Choosing model…';
  try {
    const state = await api.chooseWhisperModel();
    renderSetup(state);
    setFeedback(setupFeedback, state.whisperModel.ok ? 'Whisper model selected.' : 'No model selected.', state.whisperModel.ok ? 'ok' : '');
  } catch (err) {
    setFeedback(setupFeedback, err, 'error');
  }
});
el('setup-download-model').addEventListener('click', async () => {
  const button = el<HTMLButtonElement>('setup-download-model');
  const previous = button.textContent;
  button.disabled = true;
  button.textContent = 'Downloading…';
  setFeedback(setupFeedback, 'Downloading ggml-base.en.bin locally. Keep the app open.', '');
  try {
    const state = await api.downloadWhisperModel();
    renderSetup(state);
    setFeedback(setupFeedback, 'Whisper base.en downloaded and selected.', 'ok');
  } catch (err) {
    setFeedback(setupFeedback, err, 'error');
  } finally {
    button.disabled = false;
    button.textContent = previous;
  }
});

api.onStatus((status: Status) => {
  lastStatus = status;
  const problem = status.message ?? status.mic.error ?? status.system.error ?? '';
  const setupProblem = /WHISPER_MODEL|whisper model|screen access|screen recording|microphone|ollama|setup required/i.test(problem);
  if (setupProblem) btnSetup.dataset.issue = 'true';
  if (setupProblem && !setupAutoOpened && !activePanel) {
    setupAutoOpened = true;
    queueMicrotask(() => void openPanel('setup'));
  }
});
