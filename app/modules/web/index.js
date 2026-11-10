// Audio Nook's native views on the web. A browser has no second window for the Mini Player
// (the Mac's `NSPanel`, modules/apple/MiniPlayer.swift), so the tag draws nothing here and the
// in-page mini player stays the web's.
export const abi = 1;
export const roster = { 'nook-mini-player': { snapshot: false } };

export function create(_tag, element) {
  (element.shadowRoot ?? element.attachShadow({ mode: 'open' })).replaceChildren();
  return {};
}
export function setProps() {}
export function snapshot() {}
export function destroy() {}
