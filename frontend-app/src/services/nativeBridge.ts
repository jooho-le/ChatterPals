import { Capacitor, registerPlugin } from '@capacitor/core';

type OverlayMode = 'show' | 'hide';

interface FloatingPetPlugin {
  enableOverlay(): Promise<{ value: boolean }>;
  disableOverlay(): Promise<{ value: boolean }>;
  isOverlayEnabled(): Promise<{ value: boolean }>;
  requestOverlayPermission(): Promise<{ value: boolean }>;
  setOverlayPosition(options: { x: number; y: number }): Promise<void>;
  addListener(eventName: 'sharedData', listenerFunc: (payload: { text?: string | null }) => void): Promise<{ remove: () => void }>;
}

const floatingPet = Capacitor.isNativePlatform()
  ? registerPlugin<FloatingPetPlugin>('FloatingPet')
  : null;

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export async function toggleOverlay(mode: OverlayMode): Promise<void> {
  if (!floatingPet) return;
  if (mode === 'show') {
    const permission = await floatingPet.requestOverlayPermission();
    if (!permission.value) {
      throw new Error('오버레이 권한이 필요합니다.');
    }
    await floatingPet.enableOverlay();
  } else {
    await floatingPet.disableOverlay();
  }
}

export async function syncOverlayPosition(position: { x: number; y: number }): Promise<void> {
  if (!floatingPet) return;
  await floatingPet.setOverlayPosition(position);
}

export function onSharedData(callback: (text: string | null) => void): void {
  if (!floatingPet) return;
  void floatingPet.addListener('sharedData', (payload) => {
    callback(payload.text ?? null);
  });
}
