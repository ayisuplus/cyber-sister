import { Suspense, lazy } from 'react';
import type { MakeupLook } from '../../shared/types';
import type { Landmark } from '../../shared/faceFeatures';
import TutorialPanel from '../tutorial/TutorialPanel';
import { TutorialLoadingFallback } from './fallbacks';

const MakeupCanvas = lazy(
  () =>
    import(
      /* webpackChunkName: "makeup-canvas", webpackPrefetch: true */ '../tutorial/MakeupCanvas'
    ),
);

export function TutorialView({
  look,
  stepIndex,
  previewUrl,
  imageWidth,
  imageHeight,
  landmarks,
  onPrev,
  onNext,
  onRestart,
  onFinish,
}: {
  look: MakeupLook;
  stepIndex: number;
  previewUrl: string;
  imageWidth: number;
  imageHeight: number;
  landmarks: Landmark[] | null;
  onPrev: () => void;
  onNext: () => void;
  onRestart: () => void;
  onFinish: () => void;
}) {
  const step = look.steps[stepIndex];
  return (
    <div className="space-y-4">
      {landmarks && landmarks.length === 478 ? (
        <div className="card-soft p-2">
          <Suspense fallback={<TutorialLoadingFallback />}>
            <MakeupCanvas
              imageSrc={previewUrl}
              imageWidth={imageWidth}
              imageHeight={imageHeight}
              landmarks={landmarks}
              currentZones={step?.overlayZones ?? []}
              brushDirection={step?.brushDirection}
            />
          </Suspense>
        </div>
      ) : (
        <div className="w-full h-64 card-soft flex items-center justify-center text-ink-soft/60 text-sm">
          关键点不可用，分区预览略过
        </div>
      )}
      <TutorialPanel
        look={look}
        stepIndex={stepIndex}
        onPrev={onPrev}
        onNext={onNext}
        onRestart={onRestart}
        onFinish={onFinish}
      />
    </div>
  );
}
