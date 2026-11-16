import tempfile
import os
import time
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app
from app import service

class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = service.DB
        service.DB = Path(self.tmp.name) / 'service.sqlite'
        service._attempts.clear()
        service.initialize()
        self.client = TestClient(app)
        def register(name):
            result = self.client.post('/service/register', json={'name':name,'password':'example-password-123'})
            self.assertEqual(result.status_code,200, result.text)
            return result.json()
        self.alice = register('alice')
        self.bob = register('bob')
        self.a = {'Authorization': 'Bearer ' + self.alice['token']}
        self.b = {'Authorization': 'Bearer ' + self.bob['token']}
    def tearDown(self):
        self.client.close(); service.DB = self.old; self.tmp.cleanup()
    def test_private_database_cannot_use_public_audio_directory(self):
        old = os.environ.get('DATA_DIR')
        os.environ['DATA_DIR'] = self.tmp.name
        try:
            with self.assertRaisesRegex(RuntimeError, 'outside the public audio'):
                with service.db(): pass
        finally:
            if old is None: os.environ.pop('DATA_DIR', None)
            else: os.environ['DATA_DIR'] = old
    def test_accounts_and_revision_conflict(self):
        self.assertEqual(self.client.post('/service/login',json={'name':'alice','password':'wrong-password'}).status_code,401)
        self.assertEqual(self.client.get('/service/snapshot').status_code,401)
        payload={'revision':0,'data':{'version':1,'projects':[]}}
        self.assertEqual(self.client.put('/service/snapshot',headers=self.a,json=payload).json()['revision'],1)
        self.assertEqual(self.client.put('/service/snapshot',headers=self.a,json=payload).status_code,409)
        self.assertIsNone(self.client.get('/service/snapshot',headers=self.b).json()['data'])
        self.assertEqual(self.client.get('/service/snapshot',headers=self.a).json()['data']['version'],1)
        self.client.post('/service/logout',headers=self.a)
        self.assertEqual(self.client.get('/service/snapshot',headers=self.a).status_code,401)
    def test_media_is_private_and_deduplicated(self):
        payload = b'video content for testing'
        one = self.client.post('/service/media',headers=self.a,files={'file':('clip.mp4',payload,'video/mp4')})
        self.assertEqual(one.status_code,200,one.text)
        mid = one.json()['id']
        two = self.client.post('/service/media',headers=self.a,files={'file':('clip.mp4',payload,'video/mp4')})
        self.assertEqual(two.json()['id'],mid)
        self.assertEqual(self.client.get('/service/media/'+mid,headers=self.a).content,payload)
        self.assertEqual(self.client.get('/service/media/'+mid,headers=self.b).status_code,404)
        self.assertEqual(self.client.get('/files/service-media/'+mid).status_code,404)
        self.assertEqual(self.client.get('/service/media/'+mid).status_code,401)
    def test_community_and_mission(self):
        pid=self.client.post('/service/posts',headers=self.a,json={'text':'hello'}).json()['id']
        self.assertEqual(self.client.delete('/service/posts/'+pid,headers=self.b).status_code,403)
        self.client.put('/service/posts/'+pid+'/like',headers=self.b)
        self.client.post('/service/posts/'+pid+'/comments',headers=self.b,json={'text':'nice'})
        post=self.client.get('/service/posts',headers=self.a).json()[0]
        self.assertEqual((post['likes'],len(post['comments'])),(1,1))
        self.client.put('/service/blocks/'+self.alice['userId'],headers=self.b)
        self.assertEqual(self.client.get('/service/posts',headers=self.b).json(),[])
        self.client.delete('/service/blocks/'+self.alice['userId'],headers=self.b)
        self.assertEqual(len(self.client.get('/service/posts',headers=self.b).json()),1)
        complete={'session_id':'session-1','seconds':31,'started_at':time.time()}
        self.assertEqual(self.client.post('/service/mission/complete',headers=self.a,json=complete).status_code,400)
        self.client.post('/service/mission/join',headers=self.a)
        complete['started_at'] = time.time()
        self.client.post('/service/mission/complete',headers=self.a,json=complete)
        self.client.post('/service/mission/complete',headers=self.a,json=complete)
        self.assertEqual(self.client.get('/service/mission',headers=self.a).json()['progress'],1)
        self.assertEqual(self.client.put('/service/admin/mission/2026-10-26',json={'title':'a','goal':3}).status_code,403)
