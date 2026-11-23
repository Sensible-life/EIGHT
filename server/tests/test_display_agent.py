import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.display_agent import LocalPromptGenerator, MovementGuide, Observation
from app.main import app

class GuideTests(unittest.TestCase):
    def test_project_history_prioritizes_underused_target(self):
        guide = MovementGuide(warmup=0, persistence=0, no_save_after=0)
        observation = Observation(True, .5, .5, ('arm_l', 'leg_r'), save_revision=0,
                                  project_usage={'arm_l': .8, 'leg_r': .1},
                                  overall_usage={'arm_l': .1, 'leg_r': .8})
        self.assertEqual(guide.observe(observation, 0)['proposal']['target'], 'leg_r')

    def test_feedback_changes_target_choice_and_prompts_rotate(self):
        guide = MovementGuide(warmup=0, persistence=0, no_save_after=0, cooldown=0, target_cooldown=0)
        observation = Observation(True, .5, .5, ('arm_l', 'leg_r'), save_revision=0)
        first = guide.observe(observation, 0)['proposal']
        self.assertEqual(first['target'], 'arm_l')
        self.assertTrue(guide.respond(first['id'], 'dismiss', 0.1))
        second = guide.observe(observation, 6)['proposal']
        self.assertEqual(second['target'], 'leg_r')
        self.assertTrue(guide.respond(second['id'], 'accept', 6.1))
        suggestion = guide.public(6.1)['proposal']
        self.assertIn('right leg', suggestion['title'])
        self.assertTrue(guide.respond(suggestion['id'], 'accept', 6.2))
        self.assertEqual(guide.observe(observation, 12)['proposal']['target'], 'leg_r')
        generator = LocalPromptGenerator()
        one = generator.generate(observation, 'arm_l')
        two = generator.generate(observation, 'arm_l')
        self.assertNotEqual(one.title, two.title)
        self.assertIn('left arm', two.title)

    def setUp(self):
        self.guide = MovementGuide(warmup=0, persistence=0, no_save_after=1, cooldown=30, target_cooldown=60, proposal_lifetime=10)
        self.seen = Observation(True, .7, .3, ('leg_l',), save_revision=0)

    def ask(self):
        self.guide.observe(self.seen, 0)
        self.assertIsNone(self.guide.observe(self.seen, .5)['proposal'])
        return self.guide.observe(self.seen, 1)['proposal']

    def test_asks_before_generating_and_checks_response_ids(self):
        ask = self.ask()
        self.assertEqual((ask['kind'], ask['trigger'], ask['target']), ('help', 'no_save', 'leg_l'))
        self.assertFalse(self.guide.respond('stale', 'accept', 1.1))
        self.assertTrue(self.guide.respond(ask['id'], 'accept', 1.1))
        suggestion = self.guide.public(1.1)['proposal']
        self.assertEqual(suggestion['kind'], 'suggestion')
        self.assertIn('left leg', suggestion['reason'])
        self.assertIn('no new save', suggestion['reason'])
        self.assertNotEqual(ask['id'], suggestion['id'])
        self.assertFalse(self.guide.respond(ask['id'], 'dismiss', 1.2))
        self.assertTrue(self.guide.respond(suggestion['id'], 'accept', 1.2))
        self.assertEqual(self.guide.public(1.3)['state'], 'accepted')
        self.assertIsNone(self.guide.observe(self.seen, 2)['proposal'])

    def test_save_resets_timer_and_inactive_time_is_excluded(self):
        self.guide.observe(self.seen, 0)
        self.guide.observe(self.seen, .5)
        saved = Observation(True, .7, .3, ('leg_l',), save_revision=1)
        self.assertIsNone(self.guide.observe(saved, 1)['proposal'])
        self.assertEqual(self.guide.observe(Observation(False), 10)['state'], 'waiting')
        self.assertIsNone(self.guide.observe(saved, 100)['proposal'])
        self.assertIsNone(self.guide.observe(saved, 100.5)['proposal'])
        self.assertEqual(self.guide.observe(saved, 101)['state'], 'asking')

    def test_repeated_loop_triggers_question(self):
        guide = MovementGuide(warmup=0, persistence=0, no_save_after=999, repeat_threshold=3)
        for index, position in enumerate([9.8, .2, 9.8, .2, 9.8, .2]):
            result = guide.observe(Observation(True, .6, .4, ('arm_l',), position, 0, 10, 0), index * .25)
        self.assertEqual(result['proposal']['trigger'], 'repetition')

    def test_repeated_loop_without_recording_is_remembered_for_the_next_take(self):
        guide = MovementGuide(warmup=0, persistence=0, no_save_after=999, repeat_threshold=3)
        for index, position in enumerate([9.8, .2, 9.8, .2, 9.8, .2]):
            result = guide.observe(Observation(False, position=position, loop_start=0, loop_end=10, save_revision=0, playing=True), index * .25)
            self.assertEqual(result['state'], 'waiting')
        result = guide.observe(Observation(True, .6, .4, ('arm_l',), position=1, save_revision=0, playing=True), 2)
        self.assertEqual(result['proposal']['trigger'], 'repetition')

    def test_expiration_disabled_and_generator_failure(self):
        class BrokenGenerator:
            def generate(self, observation, target):
                raise RuntimeError('unavailable')
        self.guide.generator = BrokenGenerator()
        ask = self.ask()
        self.assertTrue(self.guide.respond(ask['id'], 'accept', 1.2))
        self.assertEqual(self.guide.public(1.2)['state'], 'unavailable')
        self.guide.set_enabled(False)
        self.assertEqual(self.guide.observe(self.seen, 10)['state'], 'paused')
        other = MovementGuide(warmup=0, persistence=0, no_save_after=0, proposal_lifetime=1)
        ask = other.observe(self.seen, 0)['proposal']
        self.assertFalse(other.respond(ask['id'], 'accept', 1))
        self.assertEqual(other.observe(self.seen, 1)['state'], 'expired')

class DisplayRelayTests(unittest.TestCase):
    def test_aggregate_and_two_step_response_without_pose_data(self):
        room = '0123456789abcdef'
        with patch('app.projection.MovementGuide', side_effect=lambda **kw: MovementGuide(warmup=0, persistence=0, no_save_after=0)):
            with TestClient(app) as client:
                self.assertEqual(client.get('/display/demo').status_code, 200)
                self.assertEqual(client.get('/display/not-a-room').status_code, 404)
                with client.websocket_connect(f'/projection/ws/{room}/view') as view:
                    with client.websocket_connect(f'/projection/ws/{room}/publish') as pub:
                        pub.send_json({'active': True, 'cells': [0] * 64, 'context': {'saveRevision': 0}, 'body': {'upper': .6, 'lower': .4, 'underused': ['leg_l']}, 'pose': [1, 2, 3]})
                        packet = view.receive_json()
                        self.assertNotIn('pose', packet)
                        self.assertEqual(packet['body']['upper'], .6)
                        self.assertEqual(packet['agent']['state'], 'asking')
                        ask = packet['agent']['proposal']
                        self.assertEqual(pub.receive_json()['agent']['proposal']['id'], ask['id'])
                        pub.send_json({'type': 'agent_response', 'proposalId': ask['id'], 'choice': 'accept'})
                        offered = view.receive_json()['agent']
                        self.assertEqual(offered['state'], 'offered')
                        self.assertEqual(pub.receive_json()['agent']['proposal']['id'], offered['proposal']['id'])
                        view.send_json({'type': 'agent_response', 'proposalId': offered['proposal']['id'], 'choice': 'accept'})
                        self.assertEqual(view.receive_json()['agent']['state'], 'accepted')
                        pub.send_json({'active': True, 'recording': True, 'cells': [0] * 64, 'body': {'upper': .6, 'lower': .4, 'underused': ['leg_l']}})
                        recording = view.receive_json()
                        self.assertTrue(recording['recording'])
                        self.assertEqual(recording['agent']['state'], 'accepted')
                        view.send_json({'type': 'agent_enabled', 'enabled': False})
                        self.assertEqual(view.receive_json()['agent']['state'], 'paused')
                        pub.send_json({'active': True, 'cells': [0] * 64, 'body': {'upper': float('nan'), 'lower': .5, 'underused': ['leg_l']}})
                        self.assertNotIn('body', view.receive_json())
                        pub.send_json({'active': False, 'cells': [0] * 64})
                        self.assertFalse(view.receive_json()['active'])
