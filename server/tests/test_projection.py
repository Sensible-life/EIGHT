import unittest
from fastapi.testclient import TestClient
from app.main import app

class ProjectionTest(unittest.TestCase):
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
                    publisher.send_json({'active': False, 'calibrated': False, 'cells': [0.0] * 64})
                    self.assertEqual(viewer.receive_json(), {'active': False, 'calibrated': False, 'cells': [0.0] * 64})
