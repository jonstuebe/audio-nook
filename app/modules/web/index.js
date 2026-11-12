// Audio Nook's native views on the web. A page cannot resize its browser window, so the tag that
// shrinks the Mac's window into the Mini Player (modules/apple/MiniPlayer.swift) draws and moves
// nothing here; the page still swaps to the small player's layout.
export const abi = 1;
export const roster = { 'nook-mini-player': { snapshot: false } };

export function create(_tag, element) {
  (element.shadowRoot ?? element.attachShadow({ mode: 'open' })).replaceChildren();
  return {};
}
export function setProps() {}
export function snapshot() {}
export function destroy() {}
