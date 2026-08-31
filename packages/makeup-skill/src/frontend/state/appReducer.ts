import type { FaceFeatures, MakeupLook } from '../../shared/types';

export type AppState =
  | { stage: 'idle' }
  | { stage: 'loading_model'; progress: number }
  | { stage: 'analyzing' }
  | {
      stage: 'ready';
      imageData: ImageData;
      previewUrl: string;
      imageWidth: number;
      imageHeight: number;
    }
  | { stage: 'analysis_done'; features: FaceFeatures; warnings: string[] }
  | { stage: 'recommending' }
  | { stage: 'looks_ready'; looks: MakeupLook[]; selected: number }
  | {
      stage: 'tutorial_step';
      look: MakeupLook;
      stepIndex: number;
      previewUrl: string;
      imageWidth: number;
      imageHeight: number;
    }
  | { stage: 'tutorial_done'; look: MakeupLook }
  | { stage: 'result'; look: MakeupLook; features: FaceFeatures }
  | {
      stage: 'teaching_resources';
      lookId: string;
      looks: MakeupLook[];
      selected: number;
    }
  | { stage: 'survey'; look: MakeupLook }
  | { stage: 'error'; message: string; recoverable: boolean };

export type Action =
  | { type: 'START_LOAD_MODEL' }
  | { type: 'MODEL_PROGRESS'; progress: number }
  | {
      type: 'MODEL_READY';
      imageData: ImageData;
      previewUrl: string;
      imageWidth: number;
      imageHeight: number;
    }
  | { type: 'START_ANALYZE' }
  | { type: 'ANALYSIS_DONE'; features: FaceFeatures; warnings: string[] }
  | { type: 'START_RECOMMEND' }
  | { type: 'LOOKS_READY'; looks: MakeupLook[]; selected: number }
  | { type: 'SELECT_LOOK'; index: number }
  | { type: 'START_TUTORIAL'; previewUrl: string; imageWidth: number; imageHeight: number }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'GOTO_STEP'; index: number }
  | { type: 'TUTORIAL_DONE' }
  | { type: 'ENTER_RESULT'; look: MakeupLook; features: FaceFeatures }
  | { type: 'OPEN_TEACHING_RESOURCES'; lookId: string }
  | { type: 'CLOSE_TEACHING_RESOURCES' }
  | { type: 'OPEN_SURVEY' }
  | { type: 'CLOSE_SURVEY' }
  | { type: 'ERROR'; message: string; recoverable: boolean }
  | { type: 'RESET' };

export const initialState: AppState = { stage: 'idle' };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'START_LOAD_MODEL':
      return { stage: 'loading_model', progress: 0 };
    case 'MODEL_PROGRESS':
      if (state.stage !== 'loading_model') return state;
      return { stage: 'loading_model', progress: action.progress };
    case 'MODEL_READY':
      if (state.stage !== 'loading_model') return state;
      return {
        stage: 'ready',
        imageData: action.imageData,
        previewUrl: action.previewUrl,
        imageWidth: action.imageWidth,
        imageHeight: action.imageHeight,
      };
    case 'START_ANALYZE':
      if (state.stage !== 'ready') return state;
      return { stage: 'analyzing' };
    case 'ANALYSIS_DONE':
      if (state.stage !== 'analyzing') return state;
      return {
        stage: 'analysis_done',
        features: action.features,
        warnings: action.warnings,
      };
    case 'START_RECOMMEND':
      if (state.stage !== 'analysis_done') return state;
      return { stage: 'recommending' };
    case 'LOOKS_READY':
      if (state.stage !== 'recommending') return state;
      return { stage: 'looks_ready', looks: action.looks, selected: action.selected };
    case 'SELECT_LOOK':
      if (state.stage !== 'looks_ready') return state;
      // 越界下标拒绝 (与 NEXT/PREV_STEP 的防护一致)
      if (action.index < 0 || action.index >= state.looks.length) return state;
      return { ...state, selected: action.index };
    case 'START_TUTORIAL':
      if (state.stage !== 'looks_ready') return state;
      return {
        stage: 'tutorial_step',
        look: state.looks[state.selected]!,
        stepIndex: 0,
        previewUrl: action.previewUrl,
        imageWidth: action.imageWidth,
        imageHeight: action.imageHeight,
      };
    case 'NEXT_STEP':
      if (state.stage !== 'tutorial_step') return state;
      {
        const next = state.stepIndex + 1;
        if (next >= state.look.steps.length) {
          return { stage: 'tutorial_done', look: state.look };
        }
        return { ...state, stepIndex: next };
      }
    case 'PREV_STEP':
      if (state.stage !== 'tutorial_step') return state;
      return { ...state, stepIndex: Math.max(0, state.stepIndex - 1) };
    case 'GOTO_STEP':
      if (state.stage !== 'tutorial_step') return state;
      // 越界下标拒绝
      if (action.index < 0 || action.index >= state.look.steps.length) return state;
      return { ...state, stepIndex: action.index };
    case 'TUTORIAL_DONE':
      if (state.stage !== 'tutorial_step') return state;
      return { stage: 'tutorial_done', look: state.look };
    case 'ENTER_RESULT':
      if (state.stage !== 'tutorial_done') return state;
      return { stage: 'result', look: action.look, features: action.features };
    case 'OPEN_TEACHING_RESOURCES':
      if (state.stage !== 'looks_ready') return state;
      return {
        stage: 'teaching_resources',
        lookId: action.lookId,
        looks: state.looks,
        selected: state.selected,
      };
    case 'CLOSE_TEACHING_RESOURCES':
      if (state.stage !== 'teaching_resources') return state;
      return { stage: 'looks_ready', looks: state.looks, selected: state.selected };
    case 'OPEN_SURVEY':
      if (state.stage !== 'tutorial_done') return state;
      return { stage: 'survey', look: state.look };
    case 'CLOSE_SURVEY':
      if (state.stage !== 'survey') return state;
      return { stage: 'tutorial_done', look: state.look };
    case 'ERROR':
      return { stage: 'error', message: action.message, recoverable: action.recoverable };
    case 'RESET':
      return { stage: 'idle' };
    default:
      return state;
  }
}
