import { Capacitor, registerPlugin } from '@capacitor/core';

interface VoiceRecorderPlugin {
  startRecording(): Promise<void>;
  stopRecording(): Promise<VoiceRecorderStopResult>;
  requestAudioRecordingPermission(): Promise<{ value: boolean }>;
  hasAudioRecordingPermission(): Promise<{ value: boolean }>;
}

interface VoiceRecorderStopResult {
  value: {
    mimeType?: string;
    recordDataBase64: string;
  };
}

type RecorderMode = 'web' | 'capacitor' | null;

type NodeBufferConstructor = {
  from(data: string, encoding: string): { toString(format: string): string };
};

let recorderMode: RecorderMode = null;
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: BlobPart[] = [];
let stopPromise: Promise<void> | null = null;
let nativeBlob: Blob | null = null;

const voiceRecorder = Capacitor.isNativePlatform()
  ? registerPlugin<VoiceRecorderPlugin>('VoiceRecorder')
  : null;

function ensureMediaRecorderSupport(): void {
  if (typeof window === 'undefined' || !('MediaRecorder' in window)) {
    throw new Error('이 브라우저는 MediaRecorder API를 지원하지 않습니다.');
  }
}

export async function start(): Promise<void> {
  if (recorderMode) {
    return;
  }

  if (Capacitor.isNativePlatform() && voiceRecorder) {
    recorderMode = 'capacitor';
    const permission = await voiceRecorder.hasAudioRecordingPermission();
    if (!permission.value) {
      const granted = await voiceRecorder.requestAudioRecordingPermission();
      if (!granted.value) {
        recorderMode = null;
        throw new Error('마이크 권한이 필요합니다. 설정에서 마이크 접근을 허용해주세요.');
      }
    }
    await voiceRecorder.startRecording();
    return;
  }

  ensureMediaRecorderSupport();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  recordedChunks = [];
  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };
  stopPromise = new Promise<void>((resolve) => {
    if (!mediaRecorder) {
      resolve();
      return;
    }
    mediaRecorder.onstop = () => {
      resolve();
    };
  });
  mediaRecorder.start();
  recorderMode = 'web';
}

export async function stop(): Promise<void> {
  if (recorderMode === 'capacitor') {
    if (!voiceRecorder) {
      recorderMode = null;
      throw new Error('음성 녹음 플러그인이 초기화되지 않았습니다.');
    }
    const result = await voiceRecorder.stopRecording();
    const { recordDataBase64, mimeType } = result.value;
    nativeBlob = base64ToBlob(recordDataBase64, mimeType ?? 'audio/m4a');
    recorderMode = null;
    return;
  }

  if (recorderMode === 'web') {
    if (!mediaRecorder) {
      recorderMode = null;
      throw new Error('MediaRecorder가 초기화되지 않았습니다.');
    }
    mediaRecorder.stop();
    await stopPromise;
    mediaRecorder.stream.getTracks().forEach((track) => track.stop());
    mediaRecorder = null;
    recorderMode = null;
    return;
  }
}

export async function getBlob(): Promise<Blob | null> {
  if (nativeBlob) {
    const blob = nativeBlob;
    nativeBlob = null;
    return blob;
  }

  if (recordedChunks.length > 0) {
    const blob = new Blob(recordedChunks, { type: 'audio/webm' });
    recordedChunks = [];
    return blob;
  }

  return null;
}

function base64ToBlob(base64Data: string, mimeType: string): Blob {
  const binaryString = decodeBase64(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function decodeBase64(base64Data: string): string {
  if (typeof atob === 'function') {
    return atob(base64Data);
  }
  const globalBuffer = (globalThis as unknown as { Buffer?: NodeBufferConstructor }).Buffer;
  if (globalBuffer) {
    return globalBuffer.from(base64Data, 'base64').toString('binary');
  }
  throw new Error('Base64 decoding not supported in this environment');
}

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}
