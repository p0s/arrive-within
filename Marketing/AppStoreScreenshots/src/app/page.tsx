import planDocument from "../../screenshot-plan.json";
import alternativesDocument from "../../narrative-alternatives.json";

type DeviceId = "iphone-6.9" | "ipad-13";
type LocaleId = "en-US" | "de-DE";

type Slide = {
  index: number;
  id: string;
  idea: string;
  headline: Record<LocaleId, string[]>;
  runtime_surface: string;
};

type RenderSlide = Slide & {
  composition: string;
  capture_ids: string[];
};

type Narrative = {
  id: string;
  title: string;
  slides: RenderSlide[];
};

const plan = planDocument as typeof planDocument & { slides: Slide[] };
const alternatives = alternativesDocument as typeof alternativesDocument & {
  narratives: Narrative[];
};

const devices: Record<DeviceId, { width: number; height: number }> = {
  "iphone-6.9": { width: 1320, height: 2868 },
  "ipad-13": { width: 2064, height: 2752 },
};

function queryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function capturePath(locale: LocaleId, device: DeviceId, captureId: string): string {
  return `/runtime-ui/${locale}/${device}/${captureId}.png`;
}

function DeviceCapture({
  captureId,
  device,
  locale,
  className = "",
}: {
  captureId: string;
  device: DeviceId;
  locale: LocaleId;
  className?: string;
}) {
  return (
    <div className={`device-frame ${device === "ipad-13" ? "tablet" : "phone"} ${className}`}>
      <div className="device-screen">
        <img
          alt=""
          data-source-capture={`${locale}/${device}/${captureId}`}
          draggable={false}
          src={capturePath(locale, device, captureId)}
        />
      </div>
    </div>
  );
}

const singleCaptureByComposition: Record<string, string> = {
  "garden-single": "garden-hero",
  "garden-seed-single": "garden-seed",
  journal: "journal",
  "journey-calendar": "journey-calendar",
  "journey-milestones": "journey-milestones",
};

function SlideComposition({
  composition,
  device,
  locale,
}: {
  composition: string;
  device: DeviceId;
  locale: LocaleId;
}) {
  const singleCapture = singleCaptureByComposition[composition];
  if (singleCapture) {
    return <DeviceCapture captureId={singleCapture} device={device} locale={locale} />;
  }
  if (composition === "garden-growth") {
    return (
      <>
        <DeviceCapture captureId="garden-seed" className="before" device={device} locale={locale} />
        <div className="growth-line" aria-hidden="true"><span /></div>
        <DeviceCapture captureId="garden-hero" className="after" device={device} locale={locale} />
      </>
    );
  }
  throw new Error(`Unsupported screenshot composition: ${composition}`);
}

export default async function ScreenshotStudio({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const device: DeviceId = queryValue(query.device) === "ipad-13" ? "ipad-13" : "iphone-6.9";
  const locale: LocaleId = queryValue(query.locale) === "de-DE" ? "de-DE" : "en-US";
  const spec = devices[device];
  const requestedNarrative = queryValue(query.narrative);
  const narrative = alternatives.narratives.find((candidate) => candidate.id === requestedNarrative);
  const slides: RenderSlide[] = narrative?.slides ?? plan.slides.map((slide) => ({
    ...slide,
    composition: ({
      "growth-arrive": "garden-single",
      "growth-take-root": "garden-growth",
      "growth-rhythm": "journey-calendar",
      "growth-stays": "journey-milestones",
      "growth-reflect": "journal",
      "growth-refuge": "garden-single",
    } as Record<string, string>)[slide.id],
    capture_ids: [],
  }));

  return (
    <main
      data-device={device}
      data-locale={locale}
      data-narrative={narrative?.id ?? "current"}
      data-screenshot-status={narrative ? alternatives.status : plan.status}
      data-slide-count={slides.length}
    >
      {slides.map((slide) => (
        <section
          className={`slide slide-${slide.index} ${device}`}
          data-export-slide={slide.id}
          data-runtime-surface={slide.runtime_surface}
          key={slide.id}
          lang={locale.slice(0, 2)}
          style={{ height: spec.height, width: spec.width }}
        >
          <header>
            <h1>
              {slide.headline[locale].map((line) => (
                <span key={line}>{line}</span>
              ))}
            </h1>
          </header>

          <div className={`composition composition-${slide.composition}`}>
            <SlideComposition composition={slide.composition} device={device} locale={locale} />
          </div>
        </section>
      ))}
    </main>
  );
}
