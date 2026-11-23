"""The character when a webcam reads the dancer, and the relay paths the display page uses.

Runs without the analysis stack (no app.main import): the relay is mounted on a small app of its own.
Run: python -m unittest tests.test_webcam_guide -v
"""
import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app import projection
from app.display_agent import MovementGuide, Observation

ROOM = '0123456789abcdef'
CELLS = [0.0] * 64


def mini_app():
    app = FastAPI()
    app.include_router(projection.router)
    return app


class WebcamGuideTests(unittest.TestCase):
    """Defaults: warm-up 15 s, persistence 8 s, cooldown 30 s, same target 60 s, answer 12 s, tried-it window 60 s."""

    def setUp(self):
        self.g = MovementGuide()
        self.t = 0.0

    def obs(self, under=('leg_l',), **kw):
        return Observation(True, .7, .3, tuple(under), webcam=True, **kw)

    def run_until(self, t_end, step=.5, **kw):  # one clock per test: self.t carries over between calls
        out = None
        while self.t <= t_end + 1e-9:
            out = self.g.observe(self.obs(**kw), self.t)
            self.t += step
        return out

    def ask(self, **kw):
        self.assertIsNone(self.run_until(14.5, **kw)['proposal'])
        proposal = self.run_until(15, **kw)['proposal']
        self.assertIsNotNone(proposal)
        return proposal

    def test_webcam_asks_after_warmup_and_persistence_without_phone(self):
        ask = self.ask()
        self.assertEqual((ask['kind'], ask['trigger'], ask['target']), ('help', 'sustained', 'leg_l'))

    def test_picks_the_longest_lacking_target(self):
        self.run_until(1.5, under=('low',))
        self.assertEqual(self.run_until(15, under=('arm_l', 'low'))['proposal']['target'], 'low')

    def test_ties_follow_limbs_before_heights(self):
        self.assertEqual(self.ask(under=('leg_l', 'low'))['target'], 'leg_l')

    def test_no_answer_for_12_s_is_no(self):
        self.ask(under=('leg_l', 'low'))
        self.assertEqual(self.run_until(26.5, under=('leg_l', 'low'))['state'], 'asking')
        out = self.run_until(27, under=('leg_l', 'low'))
        self.assertEqual((out['state'], out['proposal']), ('unanswered', None))
        self.assertIsNone(self.run_until(44.5, under=('leg_l', 'low'))['proposal'], 'cooldown 30 s from the question')
        self.assertEqual(self.run_until(45, under=('leg_l', 'low'))['proposal']['target'], 'low', 'leg_l waits 60 s')

    def test_answering_keeps_the_question_open(self):
        ask = self.ask()
        self.run_until(26.5)
        self.assertEqual(self.run_until(28, answering=True)['state'], 'asking')
        self.assertTrue(self.g.respond(ask['id'], 'accept', 28.2))
        self.assertEqual(self.g.public(28.2)['proposal']['kind'], 'suggestion')

    def test_tried_it_after_accepting(self):
        ask = self.ask()
        self.assertTrue(self.g.respond(ask['id'], 'accept', 15.2))
        self.assertEqual(self.run_until(18)['state'], 'offered')
        out = self.run_until(21, explored=('leg_l',))
        self.assertEqual((out['state'], out['proposal']), ('explored', None))
        self.assertEqual(self.run_until(26.5)['state'], 'observing', 'shown for 5 s')

    def test_tried_it_window_closes(self):
        ask = self.ask()
        self.assertTrue(self.g.respond(ask['id'], 'accept', 15.2))
        self.run_until(76)
        self.assertNotEqual(self.run_until(77, explored=('leg_l',))['state'], 'explored')

    def test_leaving_the_frame_withdraws_the_question(self):
        self.ask()
        out = self.g.observe(Observation(False, webcam=True), 15.5)
        self.assertEqual((out['state'], out['proposal']), ('waiting', None))

    def test_phone_rules_unchanged(self):
        for i in range(400):
            self.assertIsNone(self.g.observe(Observation(True, .7, .3, ('leg_l',)), i * .5)['proposal'])

    def test_timers_are_reported(self):
        timers = self.run_until(5)['timers']
        self.assertEqual(timers, {'warmup': 10.0, 'cooldown': 0.0, 'holding': {'leg_l': 5.0}, 'answer': None})
        self.ask()
        timers = self.run_until(20)['timers']
        self.assertEqual((timers['answer'], timers['cooldown']), (7.0, 25.0))


class WebcamRelayTests(unittest.TestCase):
    def setUp(self):
        projection.rooms.clear()

    def test_routes(self):
        with TestClient(mini_app()) as client:
            page = client.get('/display')
            self.assertEqual(page.status_code, 200)
            self.assertIn('/static/tracking.js', page.text)
            bundle = client.get('/static/tracking.js')
            self.assertEqual(bundle.status_code, 200)
            self.assertTrue(bundle.headers['content-type'].startswith('text/javascript'))
            self.assertIn('DisplayTracker', bundle.text)
            moved = client.get('/movement', follow_redirects=False)
            self.assertEqual((moved.status_code, moved.headers['location']), (307, '/display'))
            moved = client.get(f'/movement?room={ROOM}', follow_redirects=False)
            self.assertEqual(moved.headers['location'], f'/display?room={ROOM}')
            moved = client.get('/movement?room=../../x', follow_redirects=False)
            self.assertEqual(moved.headers['location'], '/display', 'only a room id is carried over')
            self.assertEqual(client.get('/movement.js').status_code, 404)

    def test_webcam_packet_drives_the_guide(self):
        with TestClient(mini_app()) as client:
            with client.websocket_connect(f'/projection/ws/{ROOM}/view') as viewer:
                with client.websocket_connect(f'/projection/ws/{ROOM}/publish') as publisher:
                    body = {'upper': .7, 'lower': .3, 'underused': ['low']}
                    publisher.send_json({'active': True, 'cells': CELLS, 'source': 'webcam', 'body': body, 'explored': ['arm_l'], 'answering': True})
                    packet = viewer.receive_json()
                    self.assertEqual(packet['body'], body)
                    for key in ('source', 'explored', 'answering'):
                        self.assertNotIn(key, packet)
                    self.assertEqual(packet['agent']['timers']['warmup'], 15.0, 'webcam rules: 15 s warm-up')

    def test_unknown_part_and_new_targets_pass_validation(self):
        hold = {'kind': 'hold', 'speed': 'still', 'size': 'small', 'texture': None, 'toward': 'down', 'timing': None}
        unknown = {k: None for k in hold}
        parts = {'arm_l': unknown, 'arm_r': hold, 'leg_l': hold, 'leg_r': hold, 'torso': {**hold, 'toward': None}}
        with TestClient(mini_app()) as client:
            with client.websocket_connect(f'/projection/ws/{ROOM}/view') as viewer:
                with client.websocket_connect(f'/projection/ws/{ROOM}/publish') as publisher:
                    publisher.send_json({'active': True, 'cells': CELLS, 'parts': parts, 'body': {'upper': .5, 'lower': .5, 'underused': ['left', 'right']}})
                    packet = viewer.receive_json()
                    self.assertEqual(packet['parts'], parts)
                    self.assertEqual(packet['body']['underused'], ['left', 'right'])
                    publisher.send_json({'active': True, 'cells': CELLS, 'body': {'upper': .5, 'lower': .5, 'underused': ['attic']}})
                    self.assertNotIn('body', viewer.receive_json())

    def test_camera_reading_counts_as_webcam(self):
        with TestClient(mini_app()) as client:
            with client.websocket_connect(f'/projection/ws/{ROOM}/view') as viewer:
                with client.websocket_connect(f'/projection/ws/{ROOM}/publish') as phone:
                    with client.websocket_connect(f'/projection/ws/{ROOM}/camera') as camera:
                        phone.send_json({'active': False, 'cells': CELLS, 'context': {'position': 1.0, 'playing': True, 'saveRevision': 0}})
                        viewer.receive_json()
                        camera.receive_json()  # the phone's clock, for the webcam's beat
                        camera.send_json({'body': {'upper': .6, 'lower': .4, 'underused': ['right']}, 'explored': [], 'answering': True})
                        phone.send_json({'active': False, 'cells': CELLS, 'context': {'position': 1.25, 'playing': True, 'saveRevision': 0}})
                        packet = viewer.receive_json()
                        self.assertEqual(packet['body']['underused'], ['right'], 'the webcam reading stands in for the phone camera')
                        self.assertEqual(packet['agent']['timers']['warmup'], 15.0, 'webcam rules even in a phone session')


if __name__ == '__main__':
    unittest.main()
