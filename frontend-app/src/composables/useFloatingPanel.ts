import { computed, reactive, toRefs, watch } from 'vue';

type PanelMode = 'half' | 'drawer' | 'full';

interface FloatingPanelState {
  isOpen: boolean;
  panelMode: PanelMode;
  userPrefDefault: PanelMode;
  petPosition: { x: number; y: number };
  isPetHidden: boolean;
  sharedText: string | null;
}

const STORAGE_KEY = 'floating-panel@chatterpals';

const defaultState: FloatingPanelState = {
  isOpen: false,
  panelMode: 'half',
  userPrefDefault: 'drawer',
  petPosition: { x: 0, y: 0 },
  isPetHidden: false,
  sharedText: null,
};

const state = reactive<FloatingPanelState>(loadState());

function loadState(): FloatingPanelState {
  if (typeof window === 'undefined') {
    return { ...defaultState };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return initializePosition({ ...defaultState });
    }
    const parsed = JSON.parse(raw) as Partial<FloatingPanelState> | null;
    const merged = {
      ...defaultState,
      ...parsed,
      petPosition: {
        ...defaultState.petPosition,
        ...(parsed?.petPosition ?? {}),
      },
    } satisfies FloatingPanelState;
    return initializePosition(merged);
  } catch (error) {
    console.warn('Failed to restore floating panel state from storage:', error);
    return initializePosition({ ...defaultState });
  }
}

function initializePosition(initial: FloatingPanelState): FloatingPanelState {
  if (typeof window === 'undefined') return initial;
  const padding = 24;
  const bubbleSize = 72;
  if (initial.petPosition.x === 0 && initial.petPosition.y === 0) {
    initial.petPosition = {
      x: window.innerWidth - bubbleSize - padding,
      y: window.innerHeight - bubbleSize - padding,
    };
  }
  return initial;
}

watch(
  () => ({ ...state }),
  (value) => {
    if (typeof window === 'undefined') return;
    const { sharedText, ...toPersist } = value;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist));
  },
  { deep: true }
);

function setMode(mode: PanelMode) {
  state.panelMode = mode;
}

function open(mode: PanelMode | undefined = undefined) {
  state.isOpen = true;
  if (mode) {
    state.panelMode = mode;
  } else {
    state.panelMode = state.userPrefDefault;
  }
}

function close() {
  state.isOpen = false;
  state.panelMode = state.userPrefDefault;
}

function toggle(mode?: PanelMode) {
  if (state.isOpen) {
    close();
  } else {
    open(mode);
  }
}

function setPetPosition(position: { x: number; y: number }) {
  state.petPosition = position;
}

function setUserPrefDefault(mode: PanelMode) {
  state.userPrefDefault = mode;
}

function hidePet() {
  state.isPetHidden = true;
}

function restorePet() {
  state.isPetHidden = false;
}

function setSharedText(payload: string | null) {
  state.sharedText = payload;
}

function consumeSharedText(): string | null {
  const payload = state.sharedText;
  state.sharedText = null;
  return payload;
}

export function useFloatingPanel() {
  return {
    ...toRefs(state),
    isOpen: computed({
      get: () => state.isOpen,
      set: (value: boolean) => {
        state.isOpen = value;
      },
    }),
    panelMode: computed({
      get: () => state.panelMode,
      set: (mode: PanelMode) => setMode(mode),
    }),
    open,
    close,
    toggle,
    setMode,
    setPetPosition,
    setUserPrefDefault,
    hidePet,
    restorePet,
    setSharedText,
    consumeSharedText,
  };
}

export type { PanelMode };
