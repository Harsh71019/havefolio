#!/bin/sh
# Operator release pipeline: immutable revision, protected BuildKit secret, no credential output.
set -eu
revision=$(git rev-parse HEAD)
if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  echo 'Release build requires a clean checkout.' >&2
  exit 1
fi
release="havefolio-${revision}"
secret_file=${HAVEFOLIO_MONITORING_BUILD_SECRET:?Set protected release configuration file path}
if [ ! -r "$secret_file" ]; then
  echo 'Protected monitoring build configuration is unavailable.' >&2
  exit 1
fi
# The build fails if enabled source-map upload fails; no partial release is rolled out.
for target in web api worker migration; do
  docker build --platform linux/amd64 --target "$target" \
    --build-arg "RELEASE=$release" \
    --secret "id=havefolio_monitoring,src=$secret_file" \
    -f deployment/Dockerfile -t "havefolio-$target:$release" .
done
printf 'Built release %s. Roll out only after review and candidate verification.\n' "$release"
