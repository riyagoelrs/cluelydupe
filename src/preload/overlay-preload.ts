import { contextBridge, ipcRenderer } from 'electron';
import type { AnswerPatch, MaterialImportResult, SetupState, Status, TranscriptLine } from '../shared/types';

const api = {
  onStatus: (cb: (status: Status) => void) =>
    ipcRenderer.on('ui:status', (_e, status: Status) => cb(status)),
  onTranscript: (cb: (line: TranscriptLine) => void) =>
    ipcRenderer.on('ui:transcript', (_e, line: TranscriptLine) => cb(line)),
  onAnswer: (cb: (patch: AnswerPatch) => void) =>
    ipcRenderer.on('ui:answer', (_e, patch: AnswerPatch) => cb(patch)),
  onClear: (cb: () => void) => ipcRenderer.on('ui:clear', () => cb()),

  ready: () => ipcRenderer.send('ctl:ready'),
  toggleListen: () => ipcRenderer.send('ctl:toggle-listen'),
  answerNow: () => ipcRenderer.send('ctl:answer-now'),
  answerScreen: () => ipcRenderer.send('ctl:answer-screen'),
  toggleAuto: () => ipcRenderer.send('ctl:toggle-auto'),
  clear: () => ipcRenderer.send('ctl:clear'),
  setClickThrough: (enabled: boolean) => ipcRenderer.send('ctl:click-through', enabled),
  hide: () => ipcRenderer.send('ctl:hide'),
  togglePin: () => ipcRenderer.send('ctl:toggle-pin'),
  moveBegin: () => ipcRenderer.send('ctl:move-begin'),
  moveEnd: () => ipcRenderer.send('ctl:move-end'),
  resizeBegin: () => ipcRenderer.send('ctl:resize-begin'),
  resizeTo: (width: number | null, height: number | null) =>
    ipcRenderer.send('ctl:resize-to', width, height),
  resizeEnd: () => ipcRenderer.send('ctl:resize-end'),
  resetWindow: () => ipcRenderer.send('ctl:reset-window'),
  reloadMaterials: () => ipcRenderer.send('ctl:reload-materials'),
  quit: () => ipcRenderer.send('ctl:quit'),

  // Kept for compatibility with the original renderer. The new panels intercept
  // the Notes/Files clicks before these legacy handlers fire, so normal use stays
  // entirely in-app instead of launching Cursor/Finder.
  openContext: () => ipcRenderer.send('ctl:open-context'),
  openMaterials: () => ipcRenderer.send('ctl:open-materials'),

  getContext: (): Promise<string> => ipcRenderer.invoke('data:get-context'),
  saveContext: (text: string): Promise<boolean> => ipcRenderer.invoke('data:save-context', text),
  listMaterials: (): Promise<string[]> => ipcRenderer.invoke('data:list-materials'),
  importMaterials: (): Promise<MaterialImportResult> => ipcRenderer.invoke('data:import-materials'),
  revealMaterials: (): Promise<string> => ipcRenderer.invoke('data:reveal-materials'),

  getSetup: (): Promise<SetupState> => ipcRenderer.invoke('setup:get'),
  chooseWhisperModel: (): Promise<SetupState> => ipcRenderer.invoke('setup:choose-whisper-model'),
  downloadWhisperModel: (): Promise<SetupState> => ipcRenderer.invoke('setup:download-whisper-model'),
  openPrivacySettings: (kind: 'screen' | 'microphone'): Promise<void> =>
    ipcRenderer.invoke('setup:open-privacy', kind),
};

export type OverlayApi = typeof api;

contextBridge.exposeInMainWorld('cluely', api);
