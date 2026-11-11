#!/bin/sh
# Renders art/app-icon.svg to the 1024 px PNG app.json's `icons` names; the Mac build makes
# its .icns from that. Run from app/ after changing the SVG. Needs rsvg-convert (brew install librsvg).
set -eu
cd "$(dirname "$0")/.."
rsvg-convert -w 1024 -h 1024 art/app-icon.svg -o art/app-icon-1024.png
