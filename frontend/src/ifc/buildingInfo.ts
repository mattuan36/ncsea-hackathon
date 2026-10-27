export interface IfcBuildingInfo {
  hnFt: number;
  stories: number;
}

const ROOF = /roof|parapet/i;

/** Structural height and story count from IfcBuildingStorey elevations. */
export function readBuildingInfo(data: Uint8Array): IfcBuildingInfo | null {
  const text = new TextDecoder("latin1").decode(data);
  const levels: { name: string; elevation: number }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("IFCBUILDINGSTOREY(")) continue;
    const elev = line.match(/(-?\d+\.?\d*)\s*\)\s*;?\s*$/);
    if (!elev) continue;
    const quoted = [...line.matchAll(/'([^']*)'/g)].map((match) => match[1]);
    const name = quoted.find((item) => /level|roof|floor|story|storey/i.test(item)) ?? "Level";
    const elevation = Number(elev[1]);
    if (Number.isFinite(elevation)) levels.push({ name, elevation });
  }
  if (levels.length < 2) return null;

  levels.sort((a, b) => a.elevation - b.elevation);
  const gaps = levels.slice(1).map((level, index) => level.elevation - levels[index].elevation).filter((gap) => gap > 0);
  if (!gaps.length) return null;
  const ordered = [...gaps].sort((a, b) => a - b);
  const typical = ordered[Math.floor(ordered.length / 2)];
  // Revit writes these elevations in project feet. A metre export has a much smaller story spacing.
  const toFeet = typical < 6 ? 3.28084 : 1;
  const hnFt = (levels[levels.length - 1].elevation - levels[0].elevation) * toFeet;
  const stories = levels.filter((level) => !ROOF.test(level.name)).length;
  if (!(hnFt > 0) || stories < 1) return null;
  return { hnFt: Math.round(hnFt * 10) / 10, stories };
}
