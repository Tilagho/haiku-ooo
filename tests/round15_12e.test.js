// Round 15.12e: the report ask has three short chimes. Open is neutral, the check is positive
// only once the report lands, and X / dismiss is negative. Inky's report hold is unchanged.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

ok('report open is a single neutral mallet, check rises, dismiss falls', () => {
  const sound = src('src/sound.js');
  const open = sound.slice(sound.indexOf('reportOpen(E, t)'), sound.indexOf('reportYes(E, t)'));
  const yes = sound.slice(sound.indexOf('reportYes(E, t)'), sound.indexOf('reportNo(E, t)'));
  const no = sound.slice(sound.indexOf('reportNo(E, t)'), sound.indexOf('copyCharm(E, t)'));
  assert.ok(/mallet\(E, t, d, 587\.33, 0\.18, 0\.4, 0\)/.test(open), 'open is one centered D5');
  assert.equal(open.split('mallet(').length, 2, 'open does not climb to a second note');
  assert.ok(!/chime\(/.test(open), 'open has no glass wink');
  assert.ok(!/880|1174\.7/.test(open), 'open is not the picker figure');
  assert.ok(/bloop\(E, t, ink, 360, 640/.test(yes), 'check rises, and not from the picker hello');
  assert.ok(/mallet\(E, t \+ 0\.04, d, 1046\.5/.test(yes) && /mallet\(E, t \+ 0\.15, d, 1318\.5/.test(yes), 'C6 then E6');
  assert.ok(/chime\(E, t \+ 0\.15, d, 2093/.test(yes));
  assert.ok(/mallet\(E, t, d, 622\.25/.test(no) && /mallet\(E, t \+ 0\.11, d, 523\.25/.test(no), 'Eb5 then C5');
  assert.ok(/bloop\(E, t \+ 0\.1, ink, 280, 150/.test(no), 'a falling sigh, not the error beep');
  assert.ok(!/errBeep|sadNotes/.test(no));
  assert.ok(/pickerChime\(E, t\)/.test(sound) && /pickerBack\(E, t\)/.test(sound), 'the picker cues stay');
});

ok('the ask chimes when it appears and when it is dismissed, and the check waits for a real report', () => {
  const app = src('src/app.js'), report = src('src/report.js');
  const ask = app.slice(app.indexOf('function ask('), app.indexOf('clock.onTick'));
  const already = ask.slice(0, ask.indexOf('return new Promise'));
  assert.ok(!/sfx\(/.test(already), 'already reported is a line, not the ask, so it stays quiet');
  const end = ask.slice(ask.indexOf('const end ='), ask.indexOf('const st ='));
  assert.ok(/if \(opened && !ans\) sfx\('reportNo'\)/.test(end));
  assert.ok(!/reportYes|reportOpen/.test(end), 'closing with ✔ does not itself play the positive chime');
  const shown = ask.slice(ask.indexOf("say('report?'"), ask.indexOf('no.addEventListener'));
  assert.ok(/if \(!bubble\.hidden && row\.isConnected\) \{ opened = true; sfx\('reportOpen'\); \}/.test(shown));
  assert.equal(ask.split("sfx('reportOpen')").length, 2);
  assert.equal(ask.split("sfx('reportNo')").length, 2);
  assert.ok(!/reportYes|pickerChime|pickerBack/.test(ask));
  const open = report.slice(report.indexOf('async function open'), report.indexOf('function stampMark'));
  const yes = open.indexOf("sfx('reportYes')");
  const filed = open.indexOf('await store.report');
  const bail = open.indexOf('if (!yes || already)');
  const fail = open.indexOf('catch (err)');
  assert.ok(bail >= 0 && bail < filed && filed < yes, 'the positive chime is after a report comes back');
  assert.ok(fail >= 0 && fail < yes, 'a thrown report returns before the chime');
  assert.equal(open.split("sfx('reportYes')").length, 2);
  assert.ok(!/reportOpen|reportNo|pickerChime|pickerBack/.test(open));
});

ok('Inky still holds under the report bubble, and the new cues share the one-shot path', () => {
  const app = src('src/app.js'), wire = src('src/sound-wire.js');
  assert.ok(/inky\.holdBubble\('report', true\)/.test(app) && /inky\.holdBubble\('report', false\)/.test(app));
  assert.ok(/const unpin = anchor === null \? pinReport\(\)/.test(app));
  assert.ok(/name === 'reportOpen' \|\| name === 'reportYes' \|\| name === 'reportNo'/.test(wire));
  assert.ok(/name === 'pickerChime' \|\| name === 'pickerBack'/.test(wire), 'the picker cues still defer on the first tap');
});

ok('report chimes stay on 15.12e; the board entry moved with the 15.12g count clearance', () => {
  const html = src('index.html'), app = src('src/app.js'), wire = src('src/sound-wire.js');
  assert.ok(/src\/app\.js\?v=15\.14"/.test(html));
  assert.ok(/sound-wire\.js\?v=15\.14/.test(app));
  assert.ok(/report\.js\?v=15\.13/.test(app));
  assert.ok(/sound\.js\?v=15\.14/.test(wire));
  assert.ok(/reactions\.js\?v=15\.14/.test(app), 'the date line moved for the count clearance');
  assert.ok(/inky\.js\?v=15\.12c/.test(app));
  assert.ok(/store\.js\?v=15\.14/.test(app));
  assert.ok(!/firestore\.rules/.test(app + wire + src('src/sound.js') + src('src/report.js')));
});

console.log(n + ' round 15.12e checks passed');
