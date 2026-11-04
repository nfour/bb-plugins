/**
 * Guest View's mark: two people over a chain link ("a link for guests"). Drawn out in a 24-unit box (stroke 1.75,
 * round caps), not scaled by the browser, so the stroke stays 1.75 at any size. The people are cut out of the link
 * by a mask whose stroke (4.75) is the people's 1.75 plus a gap of 1.5 each side, so they read at 14px.
 * One drawing for the app's icon ({@link ShareIcon} in `Icons.tsx`) and the guest page's guest count (`page.ts`).
 */
export const MARK = {
  link: [
    "M7.8 10.14a3.9 3.9 0 0 0 5.88 0.42l2.34 -2.34a3.9 3.9 0 0 0 -5.51 -5.51l-1.34 1.33",
    "M10.92 8.58a3.9 3.9 0 0 0 -5.88 -0.42l-2.34 2.34a3.9 3.9 0 0 0 5.51 5.51l1.33 -1.33",
  ],
  people: [
    "M19.04 23v-1.32a2.64 2.64 0 0 0 -2.64 -2.64H12.44a2.64 2.64 0 0 0 -2.64 2.64v1.32",
    "M23 23v-1.32a2.64 2.64 0 0 0 -1.98 -2.55",
    "M19.04 11.21a2.64 2.64 0 0 1 0 5.12",
  ],
  head: { cx: 14.42, cy: 13.76, r: 2.64 },
  cut: 4.75,
} as const;

/** The mark as SVG markup for a plain HTML page; `id` names its mask, so each copy on a page needs its own. */
export function markSvg(size: number, id: string): string {
  const { link, people, head, cut } = MARK;
  const person = `<path d="${people[0]}"/><circle cx="${head.cx}" cy="${head.cy}" r="${head.r}"/><path d="${people[1]}"/><path d="${people[2]}"/>`;
  const hole = `<path d="${people[0]}" fill="none"/><circle cx="${head.cx}" cy="${head.cy}" r="${head.r}"/><path d="${people[1]}" fill="none"/><path d="${people[2]}" fill="none"/>`;
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff" stroke="none"/><g stroke="#000" stroke-width="${cut}" fill="#000">${hole}</g></mask>` +
    `<g mask="url(#${id})"><path d="${link[0]}"/><path d="${link[1]}"/></g>` +
    person +
    `</svg>`
  );
}
