// Round 15.12b: a placed reaction is spelled with the typing babble, then a stamp chime. Clearing plays the existing poof.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RX_SAY, spellSteps, babbleSyl, SPELL_STEP, BABBLE } from '../src/sound.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

ok('each reaction spells its word, and a bang punches the last letter only', () => {
  assert.deepEqual(RX_SAY, { cry: 'Cry', eyes: 'Look', heart: 'Love', star: 'Star', flushed: 'Oof!', relieved: 'Joy!' });
  assert.deepEqual(spellSteps('Cry').map(s => s.i), [0, 1, 2]);
  assert.ok(spellSteps('Cry').every(s => !s.punch));
  assert.deepEqual(spellSteps('Look').map(s => s.i), [0, 1, 2, 3]);
  assert.deepEqual(spellSteps('Love').map(s => s.i), [0, 1, 2, 3]);
  assert.deepEqual(spellSteps('Star').map(s => s.i), [0, 1, 2, 3]);
  const oof = spellSteps('Oof!');
  assert.deepEqual(oof.map(s => s.i), [0, 1, 2], 'the bang is not its own syllable');
  assert.deepEqual(oof.map(s => s.punch), [false, false, true]);
  const joy = spellSteps('Joy!');
  assert.deepEqual(joy.map(s => s.punch), [false, false, true]);
  assert.equal(babbleSyl('Oof!', 3), null, 'punctuation stays silent in the babble engine');
  assert.equal(babbleSyl('Joy!', 3), null);
  assert.ok(SPELL_STEP > 1 / BABBLE.maxRate, 'letters are spaced so the babble does not merge them');
});

ok('the live react path spells a placed kind and poofs a clear', () => {
  const js = src('src/reactions.js');
  assert.ok(/if \(res\.mine\) sfx\('reactSay', \{ kind: res\.mine \}\)/.test(js), 'success with a kind spells it');
  assert.ok(/else sfx\('poof'\)/.test(js), 'clearing plays the existing poof');
  assert.ok(!/reactOff|reactClear|un-?stamp/.test(js), 'clearing does not grow a new sound');
  const wire = src('src/sound-wire.js');
  assert.ok(/name === 'reactSay'/.test(wire) && /sayReaction\(p\.kind\)/.test(wire));
  const sound = src('src/sound.js');
  assert.ok(/sayReaction\(kind/.test(sound) && /reactStamp\(/.test(sound));
  assert.ok(/poof\(E, t0\)/.test(sound), 'the poof shot already lives in the sound engine');
  assert.ok(sound.includes("this.babble({ line: word, i: step.i"), 'the spell uses the typing babble, one call per letter');
  assert.ok(/sfx\('poof'\)/.test(src('src/credits.js')) && /sfx\('poof'\)/.test(src('src/noren.js')), 'credits and the noren egg already call the same key');
});

console.log(n + ' react-say checks passed');
