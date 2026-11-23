import unittest
from fastapi.testclient import TestClient
from app.main import app

class ProjectionTest(unittest.TestCase):
    def test_webcam_record_commands_and_responses(self):
        room = 'abcdef0123456789'
        with TestClient(app) as client:
            with client.websocket_connect(f'/projection/ws/{room}/publish') as phone:
                phone.send_json({'type': 'record_command', 'action': 'start'})
                self.assertEqual(phone.receive_json()['state'], 'error')
                with client.websocket_connect(f'/projection/ws/{room}/camera') as camera:
                    phone.send_json({'type': 'record_command', 'action': 'start'})
                    cmd = camera.receive_json()
                    self.assertEqual(cmd['action'], 'start')
                    take = cmd['take']
                    camera.send_json({'type': 'record_event', 'state': 'started', 'take': take})
                    self.assertEqual(phone.receive_json()['state'], 'started')
                    phone.send_json({'type': 'record_command', 'action': 'stop'})
                    self.assertEqual(camera.receive_json()['take'], take)
                    camera.send_json({'type': 'record_event', 'state': 'stopped', 'take': take})
                    self.assertEqual(phone.receive_json()['state'], 'stopped')
                    camera.send_json({'type': 'record_event', 'state': 'saved', 'take': take})
                    self.assertEqual(phone.receive_json()['url'], f'/projection/recordings/{room}/{take}')
                    self.assertEqual(client.get(f'/projection/recordings/{room}/bad').status_code, 404)

    def test_relay_validated_aggregate_and_inactive_state(self):
        room = '1234567890abcdef'
        with TestClient(app) as client:
            self.assertEqual(client.get('/projection/' + room).status_code, 200)
            self.assertEqual(client.get('/projection/not-valid').status_code, 404)
            with client.websocket_connect(f'/projection/ws/{room}/view') as viewer:
                with client.websocket_connect(f'/projection/ws/{room}/publish') as publisher:
                    cells = [0.0] * 64
                    cells[7] = 1.0
                    publisher.send_json({'active': True, 'cells': cells, 'pose': [1, 2, 3]})
                    self.assertEqual(viewer.receive_json(), {'active': True, 'calibrated': False, 'cells': cells})
                    movement = {'speed': 'slow', 'size': 'large', 'direction': 'side to side', 'texture': 'smooth', 'lead': 'arm_l', 'timing': None}
                    publisher.send_json({'active': True, 'cells': cells, 'movement': movement})
                    self.assertEqual(viewer.receive_json(), {'active': True, 'calibrated': False, 'cells': cells, 'movement': movement})
                    for bad in ({**movement, 'speed': 'warp'}, {**movement, 'extra': 1}, {'speed': 'slow'}, {**movement, 'lead': ['arm_l']}, 'fast'):
                        publisher.send_json({'active': True, 'cells': cells, 'movement': bad})
                        self.assertEqual(viewer.receive_json(), {'active': True, 'calibrated': False, 'cells': cells})
                    hold = {'kind': 'hold', 'speed': 'still', 'size': 'small', 'texture': None, 'toward': 'down', 'timing': None}
                    parts = {'arm_l': {**hold, 'kind': 'circle', 'speed': 'medium', 'texture': 'smooth'}, 'arm_r': hold, 'leg_l': hold, 'leg_r': hold, 'torso': {**hold, 'toward': None}}
                    space = {'zone': 'left', 'level': 'mid', 'depth': 'home', 'weight': 'center', 'x': 1.12, 'y': 0, 'width': 1.4}
                    publisher.send_json({'active': True, 'cells': cells, 'parts': parts, 'space': space})
                    self.assertEqual(viewer.receive_json(), {'active': True, 'calibrated': False, 'cells': cells, 'parts': parts, 'space': space})
                    for bad in ({'parts': {**parts, 'arm_l': {**hold, 'kind': 'fly'}}}, {'parts': {'arm_l': hold}}, {'space': {**space, 'zone': 'attic'}}, {'space': {**space, 'x': 'far'}}):
                        publisher.send_json({'active': True, 'cells': cells, **bad})
                        self.assertEqual(viewer.receive_json(), {'active': True, 'calibrated': False, 'cells': cells})
                    publisher.send_json({'active': False, 'calibrated': False, 'cells': [0.0] * 64})
                    self.assertEqual(viewer.receive_json(), {'active': False, 'calibrated': False, 'cells': [0.0] * 64})
