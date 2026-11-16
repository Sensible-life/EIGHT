const assert = require('node:assert/strict');
const { portableLibrary } = require('../load-ts.cjs')('src/service/snapshot.ts');
const input = { version:1, server:'http://test', sessions:[], joinedWeeks:[], projects: [
  { id:'p', job:{ config:{model:'imported'}, files:{ bass:'file:///secret.wav', drums:'https://host/drums.mp3' } }, cached:true },
  { id:'demo', job:{ config:{model:'demo'}, files:{ bass:'http://localhost/demo.wav' } } },
], extras:{ motions:[{video:'file:///private.mp4'}], motifs:[{video:'file:///private.mp4'}], watch:{}, compositions:[], posts:[], badges:[], missionGoal:3 } };
const out = portableLibrary(input);
assert.deepEqual(JSON.parse(JSON.stringify(out.projects[0].job.files)), { drums:'https://host/drums.mp3' });
assert.equal(out.projects[0].cached, false);
assert.equal(out.projects[1].job.files, undefined);
assert.equal(out.extras.motions[0].video, undefined);
assert.equal(out.extras.motifs[0].video, undefined);
assert.equal(input.extras.motifs[0].video, 'file:///private.mp4', 'preparation does not mutate live state');
console.log('PASS: portable snapshots strip local paths without mutating the source');
