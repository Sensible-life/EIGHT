export const MOVEMENT_AXES = {
  primitive: { label: 'Movement', symbol: '↻', prompts: ['Spin', 'Reach', 'Fold', 'Wave', 'Bounce', 'Push', 'Pull', 'Sway', 'Twist', 'Drop', 'Jump', 'Pause'] },
  steps: { label: 'Steps', symbol: '⇢', prompts: ['Add a step', 'Walk', 'Slide', 'Change direction', 'Travel across the space', 'Move in place', 'Move in a circle', 'Move forward and back'] },
  pose: { label: 'Pose', symbol: '✳', prompts: ['Strike a pose', 'Hold a pose', 'Change your pose', 'Freeze while moving', 'Alternate movement and stillness'] },
  timing: { label: 'Timing', symbol: '♩', prompts: ['Subdivide the beat', 'Stretch one beat', 'Skip a beat', 'Move off the beat', 'Fill the space between beats'] },
  tempo: { label: 'Speed', symbol: '◷', prompts: ['Move slower', 'Move faster', 'Gradually speed up', 'Gradually slow down', 'Change speed suddenly'] },
  amplitude: { label: 'Size', symbol: '↔', prompts: ['Move bigger', 'Move smaller', 'Expand your range', 'Move close to your body', 'Reach all the way'] },
  dynamics: { label: 'Dynamics', symbol: '〰', prompts: ['Move strongly', 'Move softly', 'Move heavily', 'Move lightly', 'Move with a bounce'] },
  flow: { label: 'Flow', symbol: '∞', prompts: ['Move in sharp stops', 'Connect your movements', 'Move continuously', 'Repeat without stopping'] },
  direction: { label: 'Direction', symbol: '↑', prompts: ['Move upward', 'Move downward', 'Reach sideways', 'Turn to face another direction', 'Try the opposite direction'] },
  level: { label: 'Level', symbol: '↕', prompts: ['Move low', 'Move high', 'Change levels', 'Go down and come back up'] },
  body: { label: 'Body', symbol: '◉', prompts: ['Start with your arms', 'Start with your legs', 'Lead with your shoulders', 'Lead with your hips', 'Use your upper body', 'Use your lower body'] },
  isolation: { label: 'Isolation', symbol: '◌', prompts: ['Move one body part', 'Separate upper and lower body', 'Move left and right differently', 'Move only one side'] },
  repetition: { label: 'Repetition', symbol: '⟳', prompts: ['Repeat the movement', 'Repeat it twice', 'Change it a little each time', 'Repeat it in reverse'] },
  variation: { label: 'Variation', symbol: '◇', prompts: ['Make the last move bigger', 'Reverse the last move', 'Slow down the last move', 'Change its direction'] },
  transition: { label: 'Transition', symbol: '→', prompts: ['Connect to the next move', 'Connect slowly', 'Add a pose between moves', 'Connect with a step', 'Connect with a turn'] },
  contrast: { label: 'Contrast', symbol: '◐', prompts: ['Alternate big and small', 'Alternate fast and slow', 'Alternate strong and soft', 'Move then freeze'] },
  space: { label: 'Space', symbol: '⊕', prompts: ['Use more space', 'Move in a smaller space', 'Explore the front of the space', 'Move around a point', 'Create a path'] },
  composition: { label: 'Composition', symbol: '＋', prompts: ['Add a pose', 'Add a step', 'Remove a move', 'Bring back an earlier move', 'Make a short sequence'] },
} as const;
export type MovementAxis = keyof typeof MOVEMENT_AXES;
export type CreativePrompt = { id: string; title: string; symbol: string; axes: MovementAxis[] };
export function createCreativePrompt(enabled: MovementAxis[], random: () => number = Math.random): CreativePrompt | null {
  const allowed = enabled.filter((axis, index) => axis in MOVEMENT_AXES && enabled.indexOf(axis) === index);
  if (!allowed.length) return null;
  const pick = <T,>(items: readonly T[]): T => items[Math.min(items.length - 1, Math.max(0, Math.floor(random() * items.length)))];
  const first = pick(allowed), rest = allowed.filter(a => a !== first);
  const second = rest.length ? pick(rest) : null;
  const phrase = pick(MOVEMENT_AXES[first].prompts);
  const addition = second ? pick(MOVEMENT_AXES[second].prompts) : null;
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, title: addition ? `${phrase}. ${addition}.` : `${phrase}.`, symbol: `${MOVEMENT_AXES[first].symbol}${second ? ` ${MOVEMENT_AXES[second].symbol}` : ''}`, axes: second ? [first, second] : [first] };
}
