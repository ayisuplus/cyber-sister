// appReducer 全分支覆盖 — 每个 action 的合法迁移 + 非法状态下的守卫 (返回原引用)
// + 未知 action 兜底.

import { describe, expect, it } from 'vitest';
import { initialState, reducer, type AppState } from '../src/frontend/state/appReducer';
import type { FaceFeatures, MakeupLook, MakeupStep } from '../src/shared/types';

const features: FaceFeatures = {
  upperThirdRatio: 0.33,
  middleThirdRatio: 0.34,
  lowerThirdRatio: 0.33,
  fiveEyeFit: 1,
  faceShape: 'oval',
  skinTone: 'cool_fair',
  eyeType: 'almond',
  noseType: 'straight',
  eyeDistanceRatio: 0.4,
  faceWidthHeightRatio: 0.8,
  lipFullnessRatio: 0.3,
  browArchAngle: 15,
  noseBridgeWidth: 0.2,
  confidence: 0.9,
};

function makeStep(id: string, order: number): MakeupStep {
  return { id, title: id, area: 'base', instruction: '', overlayZones: [], order };
}

const look: MakeupLook = {
  id: 'look_1',
  name: '测试妆容',
  scenario: '日常',
  suitableFor: ['oval'],
  reason: '匹配',
  steps: [makeStep('s1', 1), makeStep('s2', 2)],
  productHints: [],
};

const look2: MakeupLook = { ...look, id: 'look_2', name: '第二妆容' };

const imageData = { width: 2, height: 2, data: new Uint8ClampedArray(16) } as ImageData;

// ---------- 各状态实例 ----------

const idle: AppState = { stage: 'idle' };
const loadingModel: AppState = { stage: 'loading_model', progress: 10 };
const ready: AppState = {
  stage: 'ready',
  imageData,
  previewUrl: 'blob:x',
  imageWidth: 2,
  imageHeight: 2,
};
const analyzing: AppState = { stage: 'analyzing' };
const analysisDone: AppState = { stage: 'analysis_done', features, warnings: [] };
const recommending: AppState = { stage: 'recommending' };
const looksReady: AppState = { stage: 'looks_ready', looks: [look, look2], selected: 1 };
const teachingResources: AppState = {
  stage: 'teaching_resources',
  lookId: look.id,
  looks: [look, look2],
  selected: 1,
};
const tutorialStep: AppState = {
  stage: 'tutorial_step',
  look,
  stepIndex: 0,
  previewUrl: 'blob:x',
  imageWidth: 2,
  imageHeight: 2,
};
const tutorialDone: AppState = { stage: 'tutorial_done', look };
const result: AppState = { stage: 'result', look, features };
const survey: AppState = { stage: 'survey', look };
const errorState: AppState = { stage: 'error', message: 'm', recoverable: true };

describe('initialState', () => {
  it('初始为 idle', () => {
    expect(initialState).toEqual({ stage: 'idle' });
  });
});

describe('模型加载阶段', () => {
  it('START_LOAD_MODEL 从任意状态进入 loading_model 且进度归零', () => {
    expect(reducer(idle, { type: 'START_LOAD_MODEL' })).toEqual({
      stage: 'loading_model',
      progress: 0,
    });
    expect(reducer(errorState, { type: 'START_LOAD_MODEL' })).toEqual({
      stage: 'loading_model',
      progress: 0,
    });
  });

  it('MODEL_PROGRESS 在 loading_model 更新进度', () => {
    expect(reducer(loadingModel, { type: 'MODEL_PROGRESS', progress: 55 })).toEqual({
      stage: 'loading_model',
      progress: 55,
    });
  });

  it('MODEL_PROGRESS 在非 loading_model 状态返回原引用', () => {
    expect(reducer(idle, { type: 'MODEL_PROGRESS', progress: 55 })).toBe(idle);
  });

  it('MODEL_READY 从 loading_model 进入 ready 并携带图像信息', () => {
    expect(
      reducer(loadingModel, {
        type: 'MODEL_READY',
        imageData,
        previewUrl: 'blob:x',
        imageWidth: 2,
        imageHeight: 2,
      }),
    ).toEqual(ready);
  });

  it('MODEL_READY 在非 loading_model 状态返回原引用', () => {
    expect(
      reducer(ready, {
        type: 'MODEL_READY',
        imageData,
        previewUrl: 'blob:y',
        imageWidth: 1,
        imageHeight: 1,
      }),
    ).toBe(ready);
  });
});

describe('分析阶段', () => {
  it('START_ANALYZE 从 ready 进入 analyzing', () => {
    expect(reducer(ready, { type: 'START_ANALYZE' })).toEqual({ stage: 'analyzing' });
  });

  it('START_ANALYZE 在非 ready 状态返回原引用', () => {
    expect(reducer(idle, { type: 'START_ANALYZE' })).toBe(idle);
  });

  it('ANALYSIS_DONE 从 analyzing 进入 analysis_done 并携带 features/warnings', () => {
    expect(reducer(analyzing, { type: 'ANALYSIS_DONE', features, warnings: ['w'] })).toEqual({
      stage: 'analysis_done',
      features,
      warnings: ['w'],
    });
  });

  it('ANALYSIS_DONE 在非 analyzing 状态返回原引用', () => {
    expect(reducer(ready, { type: 'ANALYSIS_DONE', features, warnings: [] })).toBe(ready);
  });
});

describe('推荐阶段', () => {
  it('START_RECOMMEND 从 analysis_done 进入 recommending', () => {
    expect(reducer(analysisDone, { type: 'START_RECOMMEND' })).toEqual({ stage: 'recommending' });
  });

  it('START_RECOMMEND 在非 analysis_done 状态返回原引用', () => {
    expect(reducer(analyzing, { type: 'START_RECOMMEND' })).toBe(analyzing);
  });

  it('LOOKS_READY 从 recommending 进入 looks_ready', () => {
    expect(reducer(recommending, { type: 'LOOKS_READY', looks: [look], selected: 0 })).toEqual({
      stage: 'looks_ready',
      looks: [look],
      selected: 0,
    });
  });

  it('LOOKS_READY 在非 recommending 状态返回原引用', () => {
    expect(reducer(analysisDone, { type: 'LOOKS_READY', looks: [look], selected: 0 })).toBe(
      analysisDone,
    );
  });

  it('SELECT_LOOK 在 looks_ready 更新选中下标', () => {
    const next = reducer(looksReady, { type: 'SELECT_LOOK', index: 0 });
    expect(next).toEqual({ stage: 'looks_ready', looks: [look, look2], selected: 0 });
    expect(next).not.toBe(looksReady);
  });

  it('SELECT_LOOK 在非 looks_ready 状态返回原引用', () => {
    expect(reducer(recommending, { type: 'SELECT_LOOK', index: 0 })).toBe(recommending);
  });
  it('SELECT_LOOK 越界下标 (负数/超出 looks 长度) 返回原引用', () => {
    expect(reducer(looksReady, { type: 'SELECT_LOOK', index: -1 })).toBe(looksReady);
    expect(reducer(looksReady, { type: 'SELECT_LOOK', index: 2 })).toBe(looksReady);
  });
});

describe('教程阶段', () => {
  it('START_TUTORIAL 取当前选中妆容, 从第 0 步开始', () => {
    expect(
      reducer(looksReady, {
        type: 'START_TUTORIAL',
        previewUrl: 'blob:p',
        imageWidth: 4,
        imageHeight: 4,
      }),
    ).toEqual({
      stage: 'tutorial_step',
      look: look2, // selected = 1
      stepIndex: 0,
      previewUrl: 'blob:p',
      imageWidth: 4,
      imageHeight: 4,
    });
  });

  it('START_TUTORIAL 在非 looks_ready 状态返回原引用', () => {
    expect(
      reducer(ready, { type: 'START_TUTORIAL', previewUrl: 'p', imageWidth: 1, imageHeight: 1 }),
    ).toBe(ready);
  });

  it('NEXT_STEP 推进 stepIndex', () => {
    const next = reducer(tutorialStep, { type: 'NEXT_STEP' });
    expect(next).toEqual({ ...tutorialStep, stepIndex: 1 });
  });

  it('NEXT_STEP 到最后一步之后进入 tutorial_done', () => {
    const lastStep: AppState = { ...tutorialStep, stepIndex: 1 } as AppState;
    expect(reducer(lastStep, { type: 'NEXT_STEP' })).toEqual({
      stage: 'tutorial_done',
      look,
    });
  });

  it('NEXT_STEP 在非 tutorial_step 状态返回原引用', () => {
    expect(reducer(tutorialDone, { type: 'NEXT_STEP' })).toBe(tutorialDone);
  });

  it('PREV_STEP 回退 stepIndex, 第 0 步时钳制在 0', () => {
    expect(reducer({ ...tutorialStep, stepIndex: 1 } as AppState, { type: 'PREV_STEP' })).toEqual({
      ...tutorialStep,
      stepIndex: 0,
    });
    expect(reducer(tutorialStep, { type: 'PREV_STEP' })).toEqual({
      ...tutorialStep,
      stepIndex: 0,
    });
  });

  it('PREV_STEP 在非 tutorial_step 状态返回原引用', () => {
    expect(reducer(idle, { type: 'PREV_STEP' })).toBe(idle);
  });

  it('GOTO_STEP 跳转到指定步', () => {
    expect(reducer(tutorialStep, { type: 'GOTO_STEP', index: 1 })).toEqual({
      ...tutorialStep,
      stepIndex: 1,
    });
  });

  it('GOTO_STEP 在非 tutorial_step 状态返回原引用', () => {
    expect(reducer(result, { type: 'GOTO_STEP', index: 1 })).toBe(result);
  });
  it('GOTO_STEP 越界下标 (负数/超出 steps 长度) 返回原引用', () => {
    expect(reducer(tutorialStep, { type: 'GOTO_STEP', index: -1 })).toBe(tutorialStep);
    expect(reducer(tutorialStep, { type: 'GOTO_STEP', index: 2 })).toBe(tutorialStep);
  });

  it('TUTORIAL_DONE 从 tutorial_step 进入 tutorial_done', () => {
    expect(reducer(tutorialStep, { type: 'TUTORIAL_DONE' })).toEqual({
      stage: 'tutorial_done',
      look,
    });
  });

  it('TUTORIAL_DONE 在非 tutorial_step 状态返回原引用', () => {
    expect(reducer(looksReady, { type: 'TUTORIAL_DONE' })).toBe(looksReady);
  });
});

describe('结果 / 问卷 / 教学资源', () => {
  it('ENTER_RESULT 从 tutorial_done 进入 result', () => {
    expect(reducer(tutorialDone, { type: 'ENTER_RESULT', look, features })).toEqual({
      stage: 'result',
      look,
      features,
    });
  });

  it('ENTER_RESULT 在非 tutorial_done 状态返回原引用', () => {
    expect(reducer(tutorialStep, { type: 'ENTER_RESULT', look, features })).toBe(tutorialStep);
  });

  it('OPEN_TEACHING_RESOURCES 从 looks_ready 打开并保留 looks/selected', () => {
    expect(reducer(looksReady, { type: 'OPEN_TEACHING_RESOURCES', lookId: look.id })).toEqual({
      stage: 'teaching_resources',
      lookId: look.id,
      looks: [look, look2],
      selected: 1,
    });
  });

  it('OPEN_TEACHING_RESOURCES 在非 looks_ready 状态返回原引用', () => {
    expect(reducer(tutorialDone, { type: 'OPEN_TEACHING_RESOURCES', lookId: 'x' })).toBe(
      tutorialDone,
    );
  });

  it('CLOSE_TEACHING_RESOURCES 恢复 looks_ready', () => {
    expect(reducer(teachingResources, { type: 'CLOSE_TEACHING_RESOURCES' })).toEqual({
      stage: 'looks_ready',
      looks: [look, look2],
      selected: 1,
    });
  });

  it('CLOSE_TEACHING_RESOURCES 在非 teaching_resources 状态返回原引用', () => {
    expect(reducer(looksReady, { type: 'CLOSE_TEACHING_RESOURCES' })).toBe(looksReady);
  });

  it('OPEN_SURVEY 从 tutorial_done 进入 survey', () => {
    expect(reducer(tutorialDone, { type: 'OPEN_SURVEY' })).toEqual({ stage: 'survey', look });
  });

  it('OPEN_SURVEY 在非 tutorial_done 状态返回原引用', () => {
    expect(reducer(result, { type: 'OPEN_SURVEY' })).toBe(result);
  });

  it('CLOSE_SURVEY 回到 tutorial_done', () => {
    expect(reducer(survey, { type: 'CLOSE_SURVEY' })).toEqual({ stage: 'tutorial_done', look });
  });

  it('CLOSE_SURVEY 在非 survey 状态返回原引用', () => {
    expect(reducer(tutorialDone, { type: 'CLOSE_SURVEY' })).toBe(tutorialDone);
  });
});

describe('全局 action', () => {
  it('ERROR 从任意状态进入 error 并携带 message/recoverable', () => {
    for (const s of [idle, tutorialStep, result]) {
      expect(reducer(s, { type: 'ERROR', message: '爆了', recoverable: false })).toEqual({
        stage: 'error',
        message: '爆了',
        recoverable: false,
      });
    }
  });

  it('RESET 从任意状态回到 idle', () => {
    for (const s of [errorState, result, teachingResources]) {
      expect(reducer(s, { type: 'RESET' })).toEqual({ stage: 'idle' });
    }
  });

  it('未知 action 返回原状态引用', () => {
    const unknown = { type: 'NOPE_NOT_AN_ACTION' } as unknown as Parameters<typeof reducer>[1];
    expect(reducer(tutorialStep, unknown)).toBe(tutorialStep);
    expect(reducer(idle, unknown)).toBe(idle);
  });
});
