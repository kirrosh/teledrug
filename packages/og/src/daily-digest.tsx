import { ImageResponse } from "@vercel/og";

export interface DailyDigestCard {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
  readonly lines: ReadonlyArray<string>;
  readonly accentColor?: string;
}

export interface DailyDigestMetadata {
  readonly weather?: string;
  readonly fx?: string;
}

export interface DailyDigestImagePayload {
  readonly dateLabel: string;
  readonly greeting: string;
  readonly metadata?: DailyDigestMetadata;
  readonly footnote?: string;
}

export interface DailyDigestImageOptions {
  readonly width?: number;
  readonly height?: number;
  readonly background?: string;
  readonly textColor?: string;
  readonly panelColor?: string;
  readonly accentColor?: string;
}

const baseOptions: Required<DailyDigestImageOptions> = {
  width: 1200,
  height: 630,
  background: "#0F172A",
  textColor: "#F8FAFC",
  panelColor: "#111B2A",
  accentColor: "#38BDF8",
};

const renderMetadata = (metadata: DailyDigestMetadata | undefined) => {
  if (!metadata || (!metadata.weather && !metadata.fx)) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 48,
        right: 72,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        alignItems: "flex-end",
      }}
    >
      {metadata.weather && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 20px",
            background: "rgba(17, 27, 42, 0.8)",
            borderRadius: 16,
            border: "1px solid rgba(148, 163, 184, 0.2)",
          }}
        >
          <span style={{ fontSize: 24 }}>🌤️</span>
          <span
            style={{
              fontSize: 20,
              color: "rgba(248, 250, 252, 0.9)",
            }}
          >
            {metadata.weather}
          </span>
        </div>
      )}
      {metadata.fx && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 20px",
            background: "rgba(17, 27, 42, 0.8)",
            borderRadius: 16,
            border: "1px solid rgba(148, 163, 184, 0.2)",
          }}
        >
          <span style={{ fontSize: 24 }}>💱</span>
          <span
            style={{
              fontSize: 20,
              color: "rgba(248, 250, 252, 0.9)",
            }}
          >
            {metadata.fx}
          </span>
        </div>
      )}
    </div>
  );
};

export const renderDailyDigestImage = async (
  payload: DailyDigestImagePayload,
  opts?: DailyDigestImageOptions
): Promise<Uint8Array> => {
  const options: Required<DailyDigestImageOptions> = {
    ...baseOptions,
    ...opts,
    width: opts?.width ?? baseOptions.width,
    height: opts?.height ?? baseOptions.height,
  };

  const response = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          background: options.background,
          color: options.textColor,
          fontFamily: "'Inter', 'Segoe UI', 'SF Pro Display', sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {renderMetadata(payload.metadata)}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            padding: "48px 72px",
            justifyContent: "center",
            gap: 32,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <span
              style={{
                fontSize: 48,
                letterSpacing: 4,
                textTransform: "uppercase",
                color: "rgba(248, 250, 252, 0.92)",
                lineHeight: 1.1,
              }}
            >
              {payload.dateLabel}
            </span>
            <div
              style={{
                width: 120,
                height: 4,
                borderRadius: 9999,
                background: `linear-gradient(90deg, ${options.accentColor} 0%, rgba(56, 189, 248, 0.3) 100%)`,
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 24,
              maxWidth: "70%",
            }}
          >
            <span
              style={{
                fontSize: 64,
                fontWeight: 700,
                color: "rgba(248, 250, 252, 0.95)",
                lineHeight: 1.2,
              }}
            >
              {payload.greeting}
            </span>
          </div>

          {payload.footnote ? (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 22,
                color: "rgba(148, 163, 184, 0.85)",
                marginTop: "auto",
              }}
            >
              <span style={{ maxWidth: "72%", wordBreak: "break-word" }}>
                {payload.footnote}
              </span>
              <span style={{ fontWeight: 600, letterSpacing: 4 }}>TELEDRUG</span>
            </div>
          ) : null}
        </div>
      </div>
    ),
    {
      width: options.width,
      height: options.height,
    }
  );

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
};
