const RANK: Record<string, number> = { A: 1, B: 2, C: 3, D: 4 };

export function getSeismicDesignCategoryShortPeriod(sDs: number, riskCategory: string): string | null {
  if (riskCategory === "I" || riskCategory === "II" || riskCategory === "III") {
    if (sDs < 0.167) return "A";
    if (sDs >= 0.167 && sDs < 0.33) return "B";
    if (sDs >= 0.33 && sDs < 0.5) return "C";
    if (sDs >= 0.5) return "D";
  } else if (riskCategory === "IV") {
    if (sDs < 0.167) return "A";
    if (sDs >= 0.167 && sDs < 0.33) return "C";
    if (sDs >= 0.33 && sDs < 0.5) return "D";
    if (sDs >= 0.5) return "D";
  }
  return null;
}

export function getSeismicDesignCategory1sPeriod(sD1: number, riskCategory: string): string | null {
  if (riskCategory === "I" || riskCategory === "II" || riskCategory === "III") {
    if (sD1 < 0.067) return "A";
    if (sD1 >= 0.067 && sD1 < 0.133) return "B";
    if (sD1 >= 0.133 && sD1 < 0.2) return "C";
    if (sD1 >= 0.2) return "D";
  } else if (riskCategory === "IV") {
    if (sD1 < 0.067) return "A";
    if (sD1 >= 0.067 && sD1 < 0.133) return "C";
    if (sD1 >= 0.133 && sD1 < 0.2) return "D";
    if (sD1 >= 0.2) return "D";
  }
  return null;
}

export interface CategoryCheck {
  sDs: number | null;
  sD1: number | null;
  riskCategory: string;
  shortPeriod: string | null;
  oneSecond: string | null;
  governing: string | null;
  reported: string | null;
  matches: boolean | null;
  governs: string | null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "boolean" || value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function compareSeismicDesignCategory(
  sDs: unknown,
  sD1: unknown,
  riskCategory: unknown,
  reported?: unknown,
): CategoryCheck {
  const risk = String(riskCategory ?? "").trim().toUpperCase();
  const shortValue = asNumber(sDs);
  const oneValue = asNumber(sD1);
  const short = shortValue != null && risk ? getSeismicDesignCategoryShortPeriod(shortValue, risk) : null;
  const oneSecond = oneValue != null && risk ? getSeismicDesignCategory1sPeriod(oneValue, risk) : null;
  const ranked = [
    short != null && short in RANK ? (["short period", short] as const) : null,
    oneSecond != null && oneSecond in RANK ? (["1-second", oneSecond] as const) : null,
  ].filter((item): item is readonly ["short period" | "1-second", string] => item != null);
  const governing = ranked.length ? [...ranked].sort((a, b) => RANK[b[1]] - RANK[a[1]])[0][1] : null;
  let governs: string | null = null;
  if (ranked.length === 2 && ranked[0][1] === ranked[1][1]) governs = "both";
  else if (ranked.length) governs = [...ranked].sort((a, b) => RANK[b[1]] - RANK[a[1]])[0][0];
  const reportedText = String(reported ?? "").trim().toUpperCase() || null;
  return {
    sDs: shortValue,
    sD1: oneValue,
    riskCategory: risk,
    shortPeriod: short,
    oneSecond,
    governing,
    reported: reportedText,
    matches: governing && reportedText ? governing === reportedText : null,
    governs,
  };
}
