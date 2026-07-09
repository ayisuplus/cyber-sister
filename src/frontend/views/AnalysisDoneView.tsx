import type { FaceFeatures } from '../../shared/types';

export function AnalysisDoneView({
  features,
  warnings,
  onContinue,
}: {
  features: FaceFeatures;
  warnings: string[];
  onContinue: () => void;
}) {
  return (
    <div className="text-left">
      <div className="text-center mb-5">
        <div className="inline-flex chip-rose-solid mb-2">✨ 分析完成</div>
        <h2 className="font-serif text-2xl font-bold text-ink">你的专属脸型报告</h2>
      </div>

      <div className="card-soft p-5 mb-4">
        <div className="grid grid-cols-2 gap-3">
          <FeatureChip label="脸型" value={cnFaceShape(features.faceShape)} color="rose" />
          <FeatureChip label="肤色" value={cnSkinTone(features.skinTone)} color="pink" />
          <FeatureChip label="眼型" value={cnEyeType(features.eyeType)} color="rose" />
          <FeatureChip label="鼻型" value={features.noseType} color="pink" />
        </div>

        <div
          className="mt-4 pt-4 border-t border-dashed"
          style={{ borderColor: 'rgba(200,107,119,0.2)' }}
        >
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[10px] text-ink-soft/60">上庭</div>
              <div className="font-semibold text-primary">
                {features.upperThirdRatio.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-ink-soft/60">中庭</div>
              <div className="font-semibold text-primary">
                {features.middleThirdRatio.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-ink-soft/60">下庭</div>
              <div className="font-semibold text-primary">
                {features.lowerThirdRatio.toFixed(2)}
              </div>
            </div>
          </div>
          <div className="mt-3 flex justify-between text-xs text-ink-soft/70">
            <span>五眼比例: {features.fiveEyeFit.toFixed(2)}</span>
            <span>置信度: {features.confidence.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {warnings.length > 0 && (
        <div
          className="rounded-2xl p-3 mb-4 space-y-1"
          style={{ background: 'rgba(234,182,188,0.2)' }}
        >
          {warnings.map((w, i) => (
            <div key={i} className="text-xs text-primary-deep">
              ⚠️ {w}
            </div>
          ))}
        </div>
      )}

      <button type="button" onClick={onContinue} className="btn-primary w-full">
        查看推荐妆容 →
      </button>
    </div>
  );
}

function FeatureChip({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: 'rose' | 'pink';
}) {
  return (
    <div
      className="rounded-2xl p-3"
      style={{
        background:
          color === 'rose'
            ? 'linear-gradient(135deg, rgba(253,242,243,0.9), rgba(234,182,188,0.4))'
            : 'linear-gradient(135deg, rgba(234,182,188,0.25), rgba(200,107,119,0.15))',
        border: '1px solid rgba(234,182,188,0.4)',
      }}
    >
      <div className="text-[10px] text-ink-soft/60 uppercase tracking-wide">{label}</div>
      <div className="font-semibold text-primary text-sm mt-0.5">{value}</div>
    </div>
  );
}

function cnFaceShape(s: string): string {
  return (
    (
      {
        oval: '椭圆脸',
        round: '圆脸',
        square: '方脸',
        heart: '心形脸',
        long: '长脸',
        diamond: '菱形脸',
      } as Record<string, string>
    )[s] ?? s
  );
}

function cnSkinTone(s: string): string {
  return (
    (
      {
        cool_fair: '冷白皮',
        cool_medium: '冷黄一白',
        neutral_fair: '中性一白',
        neutral_medium: '中性二白',
        warm_fair: '暖白皮',
        warm_medium: '暖黄一白',
        warm_deep: '暖黄二白',
        warm_deep_dark: '暖深色',
      } as Record<string, string>
    )[s] ?? s
  );
}

function cnEyeType(s: string): string {
  return (
    (
      {
        almond: '杏眼',
        round: '圆眼',
        hooded: '肿泡眼',
        monolid: '单眼皮',
        downturned: '下垂眼',
        upturned: '上挑眼',
        close_set: '眼距近',
        wide_set: '眼距远',
      } as Record<string, string>
    )[s] ?? s
  );
}
