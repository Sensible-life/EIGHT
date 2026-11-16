import type { Mix } from './mix';

type LayerCommand = { session: string; stem: string } & ({ delta: -10 | 10 } | { percent: number } | { muted: boolean } | { solo: boolean });
export type WatchMixerCommand = LayerCommand | { session: string; masterPercent: number };

export function isWatchMixerCommand(value: unknown, session: string): value is WatchMixerCommand {
  if (!value || typeof value !== 'object') return false;
  const command = value as Record<string, unknown>;
  if (command.session !== session) return false;
  const fields = ['delta', 'percent', 'muted', 'solo', 'masterPercent'].filter(key => command[key] !== undefined);
  if (fields.length !== 1) return false;
  if (fields[0] === 'masterPercent') return command.stem === undefined && typeof command.masterPercent === 'number' && Number.isInteger(command.masterPercent) && command.masterPercent >= 0 && command.masterPercent <= 100;
  if (typeof command.stem !== 'string' || !command.stem || command.stem.length > 100) return false;
  if (fields[0] === 'delta') return command.delta === -10 || command.delta === 10;
  if (fields[0] === 'percent') return typeof command.percent === 'number' && Number.isInteger(command.percent) && command.percent >= 0 && command.percent <= 150;
  return typeof command[fields[0]] === 'boolean';
}

export function applyWatchMixerCommands(mix: Mix, commands: WatchMixerCommand[]): Mix {
  let next = mix;
  for (const command of commands) {
    if (!('stem' in command) || !Object.hasOwn(next, command.stem)) continue;
    const layer = next[command.stem];
    if (!layer) continue;
    let updated = layer;
    if ('muted' in command) updated = { ...layer, muted: command.muted };
    else if ('solo' in command) updated = { ...layer, solo: command.solo };
    else {
      const percent = 'percent' in command ? command.percent : Math.round(layer.volume * 100) + command.delta;
      updated = { ...layer, volume: Math.max(0, Math.min(150, percent)) / 100 };
    }
    if (next === mix) next = { ...mix };
    next[command.stem] = updated;
  }
  return next;
}

export function applyWatchMasterCommands(master: number, commands: WatchMixerCommand[]): number {
  for (const command of commands) if ('masterPercent' in command) master = command.masterPercent / 100;
  return master;
}
