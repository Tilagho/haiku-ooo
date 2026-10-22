// What lands on the clipboard when a reader taps a poem: the three lines, the author (if the poem is signed),
// then the site address so a shared haiku carries its way home.
export const SITE_URL = 'https://haiku.ooo';
const UNSIGNED = new Set(['', 'you', 'anon', 'anonymous']);
export function authorOf(post) {
  const a = (post.author || '').trim();
  return post.sample || UNSIGNED.has(a.toLowerCase()) ? '' : a;
}
export function copyText(post, url = SITE_URL) {
  const lines = post.text.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 3).join('\n');
  const a = authorOf(post);
  return `${lines}\n\n${a ? `— ${a}\n` : ''}${url}`;
}
