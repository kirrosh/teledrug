import { ImageResponse } from "@vercel/og";

export interface DailyDigestCard {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
  readonly lines: ReadonlyArray<string>;
  readonly accentColor?: string;
}

export interface DailyDigestImagePayload {
  readonly dateLabel: string;
  readonly cards: ReadonlyArray<DailyDigestCard>;
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

const getCardAccent = (card: DailyDigestCard, fallback: string) =>
  card.accentColor ?? fallback;

const cardLines = (lines: ReadonlyArray<string>) => {
  if (lines.length === 0) {
    return (
      <div
        style={{
          fontSize: 24,
          color: "rgba(226, 232, 240, 0.7)",
          marginTop: 12,
        }}
      >
        Нет данных
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        marginTop: 16,
      }}
    >
      {lines.map((line, index) => (
        <div
          key={index}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 4,
              height: 4,
              borderRadius: 9999,
              backgroundColor: "rgba(226, 232, 240, 0.5)",
              marginTop: 12,
            }}
          />
          <span
            style={{
              color: "rgba(248, 250, 252, 0.92)",
              fontSize: 26,
              lineHeight: 1.35,
              wordBreak: "break-word",
            }}
          >
            {line}
          </span>
        </div>
      ))}
    </div>
  );
};

const renderCard = (
  card: DailyDigestCard,
  options: Required<DailyDigestImageOptions>,
  columnCount: number
) => (
  <div
    key={card.id}
    style={{
      flex: "1 1 0px",
      display: "flex",
      flexDirection: "column",
      background: options.panelColor,
      borderRadius: 24,
      padding: columnCount === 1 ? "28px 32px" : "24px 28px",
      border: "1px solid rgba(148, 163, 184, 0.35)",
      minWidth: 0,
      minHeight: 0,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      {card.icon ? (
        <div
          style={{
            width: columnCount === 1 ? 60 : 56,
            height: columnCount === 1 ? 60 : 56,
            borderRadius: 20,
            backgroundColor: `${getCardAccent(card, options.accentColor)}22`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: columnCount === 1 ? 34 : 32,
          }}
        >
          {card.icon}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <span
          style={{
            fontSize: 24,
            color: "rgba(148, 163, 184, 0.9)",
            textTransform: "uppercase",
            letterSpacing: 4,
          }}
        >
          {card.title}
        </span>
        <div
          style={{
            width: 44,
            height: 3,
            borderRadius: 9999,
            backgroundColor: getCardAccent(card, options.accentColor),
          }}
        />
      </div>
    </div>
    {cardLines(card.lines)}
  </div>
);

const chunkCards = (cards: ReadonlyArray<DailyDigestCard>, size: number) => {
  const rows: DailyDigestCard[][] = [];
  for (let index = 0; index < cards.length; index += size) {
    rows.push(cards.slice(index, index + size));
  }
  return rows;
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

  const cards =
    payload.cards.length > 0
      ? payload.cards
      : [
          {
            id: "fallback",
            title: "Сегодня",
            icon: "🧘",
            lines: ["Свободный день 🙌"],
          },
        ];

  const columnCount = cards.length === 1 ? 1 : 2;
  const stackGap = columnCount === 1 ? 16 : 24;

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
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            padding: "48px 72px",
            gap: 32,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
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
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flexGrow: 1,
              gap: stackGap,
            }}
          >
            {chunkCards(cards, columnCount).map((row, rowIndex) => (
              <div
                key={`row-${row[0]?.id ?? rowIndex}`}
                style={{
                  display: "flex",
                  flexDirection: columnCount === 1 ? "column" : "row",
                  gap: stackGap,
                  width: "100%",
                  alignItems: "stretch",
                }}
              >
                {row.map((card) => renderCard(card, options, columnCount))}
              </div>
            ))}
          </div>
          {payload.footnote ? (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 22,
                color: "rgba(148, 163, 184, 0.85)",
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
