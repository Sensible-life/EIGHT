"""In-memory movement guide: observation → eligibility → proposal → response.

This is a local, rule-based workflow, not a trained AI model. Its generator is a
small injectable boundary so a model can be evaluated separately later. It never
receives video, landmarks, names, or account information.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from uuid import uuid4

# Limbs, heights, the dancer's sides (app/src/tracking/targets.ts TARGET_ORDER): also the tie-break order.
TARGETS = ('arm_l', 'arm_r', 'leg_l', 'leg_r', 'low', 'high', 'left', 'right')


@dataclass(frozen=True)
class Observation:
    active: bool
    upper: float | None = None
    lower: float | None = None
    underused: tuple[str, ...] = ()
    position: float | None = None
    loop_start: float | None = None
    loop_end: float | None = None
    save_revision: int | None = None
    playing: bool | None = None
    webcam: bool = False  # a webcam reads the dancer: no phone save / loop needed, answers by an overhead O
    explored: tuple[str, ...] = ()  # targets tried in the last 8-count
    answering: bool = False  # an overhead O is being held


@dataclass(frozen=True)
class ProposalText:
    title: str
    detail: str
    symbol: str


class ProposalGenerator(Protocol):
    """Generates a bounded suggestion; does not get to control the workflow."""
    def generate(self, observation: Observation, target: str) -> ProposalText: ...


class LocalPromptGenerator:
    """Starter policy; these examples are creative prompts, not prescriptions."""
    PROMPTS = {
        'arm_l': ProposalText('Start with your left arm', 'Try a wider reach, then connect it to your next move.', '↗'),
        'arm_r': ProposalText('Start with your right arm', 'Try a wider reach, then connect it to your next move.', '↗'),
        'leg_l': ProposalText('Lead with your left leg', 'Add a small step and explore a new direction.', '↘'),
        'leg_r': ProposalText('Lead with your right leg', 'Add a small step and explore a new direction.', '↘'),
        'low': ProposalText('Go low', 'Bring your movement closer to the floor for the next counts.', '↓'),
        'high': ProposalText('Go high', 'Rise up and reach above your usual height.', '↑'),
        'left': ProposalText('Explore your left side', 'Travel a few steps to your left and dance there.', '←'),
        'right': ProposalText('Explore your right side', 'Travel a few steps to your right and dance there.', '→'),
    }

    def generate(self, observation: Observation, target: str) -> ProposalText:
        return self.PROMPTS[target]


class MovementGuide:
    """One instance per publisher session. Time is supplied by a monotonic clock."""
    def __init__(self, generator: ProposalGenerator | None = None, *, warmup: float = 20,
                 persistence: float = 6, cooldown: float = 90, target_cooldown: float = 180,
                 proposal_lifetime: float = 20, no_save_after: float = 120, repeat_threshold: int = 3,
                 webcam_warmup: float = 15, webcam_persistence: float = 8, webcam_cooldown: float = 30,
                 webcam_target_cooldown: float = 60, answer_window: float = 12, explore_window: float = 60):
        self.generator = generator or LocalPromptGenerator()
        self.warmup, self.persistence, self.cooldown = warmup, persistence, cooldown
        self.target_cooldown, self.proposal_lifetime = target_cooldown, proposal_lifetime
        # When a webcam reads the dancer there is no phone save or loop: a lack that lasts is reason enough to ask.
        self.webcam_rules = {'warmup': webcam_warmup, 'persistence': webcam_persistence, 'cooldown': webcam_cooldown, 'target_cooldown': webcam_target_cooldown}
        self.answer_window, self.explore_window = answer_window, explore_window
        self.webcam = False
        self.watching: tuple[str, float] | None = None  # an accepted suggestion's target, and since when
        self.response_target: str | None = None
        self.started: float | None = None
        self.holding: dict[str, float] = {}
        self.last_offered: float | None = None
        self.target_offered: dict[str, float] = {}
        self.pending: dict | None = None
        self.response: str | None = None
        self.response_until = 0.0
        self.enabled = True
        self.no_save_after, self.repeat_threshold = no_save_after, repeat_threshold
        self.active_without_save = 0.0
        self.last_observed: float | None = None
        self.save_revision: int | None = None
        self.last_position: float | None = None
        self.last_loop: tuple[float, float] | None = None
        self.repetitions = 0
        self.repeat_ready = False
        self.last_observation: Observation | None = None

    def observe(self, observation: Observation, now: float) -> dict:
        playing = observation.playing if observation.playing is not None else observation.active
        if observation.save_revision is not None:
            saved = self.save_revision is not None and observation.save_revision != self.save_revision
            if saved:
                self.active_without_save = 0
                self.repetitions = 0
                self.repeat_ready = False
            self.save_revision = observation.save_revision
            if playing and self.last_observed is not None and not saved:
                self.active_without_save += max(0, min(now - self.last_observed, 0.5))
        self.last_observed = now if playing else None
        loop = (observation.loop_start, observation.loop_end) if observation.loop_start is not None and observation.loop_end is not None else None
        if loop != self.last_loop:
            self.repetitions = 0
            self.last_position = None
        if playing and loop and observation.position is not None and self.last_position is not None:
            tolerance = min(1.0, (loop[1] - loop[0]) / 3)
            if self.last_position >= loop[1] - tolerance and observation.position <= loop[0] + tolerance and self.last_position > observation.position:
                self.repetitions += 1
                if self.repetitions >= self.repeat_threshold:
                    self.repeat_ready = True
        self.last_loop, self.last_position = loop, observation.position if playing else None
        if not observation.active or observation.upper is None or observation.lower is None:
            self.started = None
            self.holding.clear()
            self.pending = None
            self.response = None
            return self.public(now, tracking=False)
        if self.started is None:
            self.started = now
        self.last_observation = observation
        self.webcam = observation.webcam
        rules = self.rules()
        allowed = [target for target in TARGETS if target in observation.underused]
        self.holding = {target: self.holding.get(target, now) for target in allowed}
        if self.watching:  # did the dancer try the accepted suggestion?
            target, since = self.watching
            if now - since > self.explore_window:
                self.watching = None
            elif target in observation.explored:
                self.watching = None
                if self.pending and self.pending['kind'] == 'suggestion':
                    self.pending = None
                self.response, self.response_target, self.response_until = 'explored', target, now + 5
                return self.public(now)
        if (observation.webcam and self.pending and self.pending['kind'] == 'help' and not observation.answering
                and now - self.pending['createdAt'] >= self.answer_window):  # no O in time: a no
            self.pending = None
            self.response = 'unanswered'
            self.response_until = now + 4
            return self.public(now)
        if self.pending and now - self.pending['createdAt'] >= self.proposal_lifetime:
            self.pending = None
            self.response = 'expired'
            self.response_until = now + 4
        if not self.enabled or self.pending or now < self.response_until:
            return self.public(now)
        if now - self.started < rules['warmup'] or (self.last_offered is not None and now - self.last_offered < rules['cooldown']):
            return self.public(now)
        ready = [target for target, since in self.holding.items()
                 if now - since >= rules['persistence'] and now - self.target_offered.get(target, float('-inf')) >= rules['target_cooldown']]
        if not ready:
            return self.public(now)
        if observation.webcam:
            trigger = 'sustained'
        else:
            trigger = 'repetition' if self.repeat_ready else 'no_save' if observation.save_revision is not None and self.active_without_save >= self.no_save_after else None
        if not trigger:
            return self.public(now)
        # The webcam names what has been missing longest; ties go by TARGETS order. The phone keeps its first-ready pick.
        target = min(ready, key=lambda t: (self.holding[t], TARGETS.index(t))) if observation.webcam else ready[0]
        self.pending = {'id': uuid4().hex, 'kind': 'help', 'target': target,
                        'title': 'Need some help?', 'detail': 'Want a movement idea?',
                        'symbol': '✦', 'trigger': trigger, 'createdAt': now}
        self.last_offered = now
        self.target_offered[target] = now
        self.holding.pop(target, None)
        self.repetitions = 0
        self.repeat_ready = False
        self.active_without_save = 0
        return self.public(now)

    def respond(self, proposal_id: str, choice: str, now: float) -> bool:
        if not self.pending or self.pending['id'] != proposal_id or choice not in ('accept', 'dismiss'):
            return False
        if now - self.pending['createdAt'] >= self.proposal_lifetime:
            return False
        if self.pending['kind'] == 'help' and choice == 'accept':
            try:
                text = self.generator.generate(self.last_observation, self.pending['target'])
                if not isinstance(text, ProposalText) or not all(isinstance(value, str) and 0 < len(value) <= limit for value, limit in ((text.title, 100), (text.detail, 200), (text.symbol, 8))):
                    raise ValueError('Invalid proposal')
                self.pending = {'id': uuid4().hex, 'kind': 'suggestion', 'target': self.pending['target'], 'title': text.title, 'detail': text.detail, 'symbol': text.symbol, 'createdAt': now}
                self.watching = (self.pending['target'], now)
            except Exception:
                self.pending = None
                self.response = 'unavailable'
                self.response_until = now + 5
        else:
            self.pending = None
            self.response = 'accepted' if choice == 'accept' else 'dismissed'
            self.response_until = now + 5
        return True

    def set_enabled(self, enabled: bool) -> None:
        self.enabled = enabled
        if not enabled:
            self.pending = None
            self.response = None

    def rules(self) -> dict:
        """Warm-up, persistence and cooldowns for whoever reads the dancer now."""
        if self.webcam:
            return self.webcam_rules
        return {'warmup': self.warmup, 'persistence': self.persistence, 'cooldown': self.cooldown, 'target_cooldown': self.target_cooldown}

    def public(self, now: float, *, tracking: bool = True) -> dict:
        state = 'paused' if not self.enabled else 'waiting' if not tracking else ('asking' if self.pending['kind'] == 'help' else 'offered') if self.pending else self.response if self.response and now < self.response_until else 'observing'
        proposal = {key: value for key, value in self.pending.items() if key != 'createdAt'} if self.pending else None
        rules, left = self.rules(), lambda span, since: round(max(0.0, span - (now - since)), 2)
        timers = {  # seconds left, for the display's debug view
            'warmup': left(rules['warmup'], self.started) if self.started is not None else float(rules['warmup']),
            'cooldown': left(rules['cooldown'], self.last_offered) if self.last_offered is not None else 0.0,
            'holding': {target: round(now - since, 2) for target, since in self.holding.items()},
            'answer': left(self.answer_window, self.pending['createdAt']) if self.webcam and self.pending and self.pending['kind'] == 'help' else None,
        }
        return {'state': state, 'proposal': proposal, 'mode': 'local', 'timers': timers,
                'target': self.response_target if state == 'explored' else None}
