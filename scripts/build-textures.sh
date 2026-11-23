#!/usr/bin/env bash
# Builds the top's finish textures in src/assets/textures/ from the source
# packs: Poly Haven's oak_veneer_01 and walnut_veneer (4K) and the white
# marble pack, each as downloaded.
#
#   scripts/build-textures.sh oak_veneer_01_4k.zip walnut_veneer_4k.zip white-marble-bl.zip
#
# Needs ImageMagick 7 (magick), OpenImageIO (oiiotool) and KTX-Software 4.4
# (ktx) on the PATH.
#
# Every map is KTX2 (Basis Universal), which the GPU samples still
# compressed, at the smallest size and encoding that looks the same as the
# source on the table. The top is seen at a slant, which shrinks it on
# screen, so even zoomed in on a 2x screen, double these sizes looks no
# different:
# - Wood color: 1024 px, ETC1S. A tile spans 1.8 m, about 560 px per meter;
#   ETC1S is a fifth of UASTC's size here with no visible loss on the grain's
#   busy detail.
# - Wood roughness: 512 px, ETC1S. It only shapes the reflections, so half
#   the color's size is enough.
# - Wood normal: 512 px, UASTC. Half size too, but ETC1S's blocks would show
#   as facets in the lighting.
# - Marble color: 512 px, UASTC. Its veining is soft, and its smooth grays
#   band under ETC1S. Its other maps are constants, which the material's
#   values already cover.
#
# The wood is turned a quarter turn, so the grain runs along the table's
# length, the model's x axis, which its UVs map to u. Also writes each map's
# average to textures.json, to tint them to the finishes' specified values.
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "usage: $0 <oak zip> <walnut zip> <marble zip>" >&2
  exit 1
fi

out="$(cd "$(dirname "$0")/.." && pwd)/src/assets/textures"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$out" "$work/oak" "$work/walnut" "$work/marble"
unzip -q "$1" -d "$work/oak"
unzip -q "$2" -d "$work/walnut"
unzip -q "$3" -d "$work/marble"

# Sharpest downscale; color is averaged in linear light.
color() { # source size output
  magick "$1" -colorspace RGB -filter Lanczos -resize "$2" -colorspace sRGB \
    -type TrueColor "PNG24:$3"
}

etc1s() { # format transfer input output
  ktx create --format "$1" --assign-tf "$2" --encode basis-lz \
    --clevel 4 --qlevel 255 --generate-mipmap "$3" "$4"
}

uastc() { # format transfer input output [extra options]
  ktx create --format "$1" --assign-tf "$2" --encode uastc --uastc-quality 2 \
    --uastc-rdo --uastc-rdo-l 1 --zstd 20 --generate-mipmap "${@:5}" "$3" "$4"
}

# The mean of an image's channels in linear light, as sRGB hex.
average() {
  magick "$1" -colorspace RGB -resize '1x1!' -colorspace sRGB \
    -format '#%[hex:p{0,0}]' info: | tr 'A-F' 'a-f' | cut -c1-7
}

mean() {
  magick "$1" -format '%[fx:mean]' info:
}

wood() { # name source prefix
  local name=$1 prefix=$2
  local w="$work/$name"

  color "${prefix}_diff_4k.jpg" 1024 "$w/color.png"
  magick "$w/color.png" -rotate 90 "$w/color.png"
  etc1s R8G8B8_SRGB srgb "$w/color.png" "$out/${name}_color.ktx2"

  # Roughness is linear; gray in every channel, so any channel reads it.
  oiiotool "${prefix}_rough_4k.exr" --ch 0 --resize 512x512 --rotate90 \
    -d uint8 -o "$w/rough.png"
  magick "$w/rough.png" -type TrueColor "PNG24:$w/rough.png"
  etc1s R8G8B8_UNORM linear "$w/rough.png" "$out/${name}_roughness.ktx2"

  # OpenGL normals (+y up). Turned with the image, the old up is the new
  # right and the old right the new down: x' = y, y' = -x.
  oiiotool "${prefix}_nor_gl_4k.exr" --resize 512x512 --rotate90 \
    -d uint8 -o "$w/normal.png"
  magick "$w/normal.png" \
    \( -clone 0 -channel G -separate \) \
    \( -clone 0 -channel R -separate -negate \) \
    \( -clone 0 -channel B -separate \) \
    -delete 0 +channel -combine -type TrueColor "PNG24:$w/normal.png"
  uastc R8G8B8_UNORM linear "$w/normal.png" "$out/${name}_normal.ktx2" --normalize

  echo "  \"$name\": { \"color\": \"$(average "$w/color.png")\", \"roughness\": $(mean "$w/rough.png") }"
}

marble() {
  local w="$work/marble"
  color "$w/white-marble-bl/white-marble_albedo.png" 512 "$w/color.png"
  uastc R8G8B8_SRGB srgb "$w/color.png" "$out/marble_color.ktx2"
  echo "  \"marble\": { \"color\": \"$(average "$w/color.png")\" }"
}

{
  echo "{"
  echo "$(wood oak "$work/oak/textures/oak_veneer_01"),"
  echo "$(wood walnut "$work/walnut/textures/walnut_veneer"),"
  marble
  echo "}"
} >"$out/textures.json"

ls -l "$out"
cat "$out/textures.json"
