export const C = {
  bg: '#F6F4F7',
  missionBg: '#1B1521',
  missionSurface: '#2C2332',
  missionNavMuted: '#C1B5C7',
  missionNavActive: '#F28BEF',
  card: '#FFFFFF',
  cardHi: '#F5EAF7',
  line: '#EBE5ED',
  text: '#261E2C',
  sub: '#736879',
  dim: '#827589',
  accent: '#B20BC2',
  ok: '#367A66',
  err: '#BE3954',
};

export const STEM_COLORS: Record<string, string> = {
  vocals: '#9550A5',
  instrumental: '#697C74',
  drums: '#A46964',
  bass: '#AE19C1',
  other: '#697C74',
  guitar: '#9B699A',
  electric_guitar: '#9B699A',
  acoustic_guitar: '#956574',
  synthesizer: '#7B62B0',
  strings: '#BC4B98',
  wind: '#4B8786',
  lead_vocals: '#9550A5',
  backing_vocals: '#A76AB0',
  piano: '#6877B1',
};

export const STEM_LABELS: Record<string, string> = {
  vocals: "Vocals",
  instrumental: "Accompaniment",
  drums: "Drums",
  bass: "Bass",
  other: "Other",
  guitar: "Guitar",
  electric_guitar: "Electric guitar",
  acoustic_guitar: "Acoustic guitar",
  synthesizer: "Synthesizer",
  strings: "Strings",
  wind: "Winds",
  lead_vocals: "Lead vocals",
  backing_vocals: "Backing vocals",
  piano: "Piano",
};

export const SECTION_COLORS = ['#3B3B8F', '#8F3B6B', '#2F7A6B', '#8F6A2F', '#5A3B8F', '#2F5E8F', '#7A2F2F'];

export const stemColor = (s: string) => STEM_COLORS[s] ?? '#BBBBBB';
export const sectionColor = (label: string) => SECTION_COLORS[(label.charCodeAt(0) - 65) % SECTION_COLORS.length];

export const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};
