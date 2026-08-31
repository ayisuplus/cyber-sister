import { describe, expect, it } from 'vitest';
import { reducer, type AppState } from '../src/frontend/state/appReducer';
import type { FaceFeatures, MakeupLook } from '../src/shared/types';

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

const look: MakeupLook = {
  id: 'look_1',
  name: '测试妆容',
  scenario: '日常',
  suitableFor: ['oval'],
  reason: '匹配',
  steps: [],
  productHints: [],
};

describe('用户控制的流程转换', () => {
  it('analysis_done 不接受推荐结果，直到用户触发 START_RECOMMEND', () => {
    const analysisDone: AppState = { stage: 'analysis_done', features, warnings: [] };
    expect(reducer(analysisDone, { type: 'LOOKS_READY', looks: [look], selected: 0 })).toBe(
      analysisDone,
    );
    expect(reducer(analysisDone, { type: 'START_RECOMMEND' })).toEqual({
      stage: 'recommending',
    });
  });

  it('tutorial_done 不进入总结，直到用户触发 ENTER_RESULT', () => {
    const tutorialDone: AppState = { stage: 'tutorial_done', look };
    expect(tutorialDone.stage).toBe('tutorial_done');
    expect(reducer(tutorialDone, { type: 'ENTER_RESULT', look, features })).toEqual({
      stage: 'result',
      look,
      features,
    });
  });

  it('教学资源关闭后恢复原 looks_ready 选择', () => {
    const looksReady: AppState = { stage: 'looks_ready', looks: [look], selected: 0 };
    const resources = reducer(looksReady, {
      type: 'OPEN_TEACHING_RESOURCES',
      lookId: look.id,
    });
    expect(resources).toEqual({
      stage: 'teaching_resources',
      lookId: look.id,
      looks: [look],
      selected: 0,
    });
    expect(reducer(resources, { type: 'CLOSE_TEACHING_RESOURCES' })).toEqual(looksReady);
  });
});
