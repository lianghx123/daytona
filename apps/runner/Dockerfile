FROM golang:1.25.11-alpine AS go-toolchain

FROM rust:1.89-alpine3.22 AS mount-s3-build

ARG MOUNT_S3_VERSION=1.20.0
ARG MOUNT_S3_REVISION=3e65af8a82499b8ff23ebead21e3003ba770bfbf
ENV RUSTFLAGS="-C target-feature=-crt-static"

# AWS does not publish Alpine/musl binaries for Mountpoint. Build the pinned
# release from source so mount-s3 is compatible with the runner's Alpine base.
RUN apk add --no-cache \
  build-base \
  clang \
  clang-dev \
  cmake \
  fuse3-dev \
  git \
  libunwind-dev \
  linux-headers \
  llvm-dev \
  pkgconf \
  zlib-dev \
  && git clone --branch "mountpoint-s3-${MOUNT_S3_VERSION}" --depth 1 --recurse-submodules \
    https://github.com/awslabs/mountpoint-s3.git /src/mountpoint-s3 \
  && cd /src/mountpoint-s3 \
  && test "$(git rev-parse HEAD)" = "${MOUNT_S3_REVISION}" \
  && cargo build --release --locked --package mountpoint-s3

FROM node:22-alpine AS build

ENV CI=true

# Build toolchain (python3/py3-setuptools/make/g++) is needed when a native
# module's prebuilt binary download fails and node-gyp falls back to compiling
# from source — it stays out of the runtime image. py3-setuptools provides the
# distutils module node-gyp needs on Python 3.12+.
RUN apk add --no-cache python3 py3-setuptools make g++

RUN npm install -g corepack && corepack enable

COPY --from=go-toolchain /usr/local/go/ /usr/local/go/

ENV PATH="/usr/local/go/bin:${PATH}"

RUN apk add --no-cache git

WORKDIR /daytona

# Yarn caching layer
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

# Nx config
COPY nx.json .nxignore ./

# Go dependency layer (cached unless go.mod/go.sum change)
COPY go.work go.work.sum ./
COPY apps/runner/go.mod apps/runner/go.sum apps/runner/
COPY apps/daemon/go.mod apps/daemon/go.sum apps/daemon/
COPY libs/common-go/go.mod libs/common-go/go.sum libs/common-go/
COPY libs/api-client-go/go.mod libs/api-client-go/go.sum libs/api-client-go/
RUN head -1 go.work > go.work.tmp && printf '\nuse (\n\t./apps/runner\n\t./apps/daemon\n\t./libs/common-go\n\t./libs/api-client-go\n)\n' >> go.work.tmp && mv go.work.tmp go.work

ENV NX_DAEMON=false
ENV GONOSUMDB=github.com/daytonaio/daytona

RUN go -C apps/runner mod download \
  && go -C apps/daemon mod download \
  && go -C libs/common-go mod download \
  && go -C libs/api-client-go mod download

# Go source
COPY apps/runner/ apps/runner/
COPY apps/daemon/ apps/daemon/
COPY libs/common-go/ libs/common-go/
COPY libs/api-client-go/ libs/api-client-go/
COPY libs/computer-use/ libs/computer-use/

# Pre-built computer-use binary and build script
COPY dist/libs/computer-use-amd64 dist/libs/computer-use-amd64

# Pin google.golang.org/genproto to a post-split version. The trimmed workspace
# lacks snapshot-manager -> distribution/v3 which normally bumps genproto past the
# split. Without this, in-toto-golang pulls in a pre-split version that conflicts
# with the split genproto/googleapis/{api,rpc} modules.
RUN GOWORK=off go -C apps/runner mod edit -require google.golang.org/genproto@v0.0.0-20240903143218-8af14fe29dc1

ARG VERSION=0.0.1
RUN --mount=type=cache,target=/root/.cache/go-build \
  SKIP_COMPUTER_USE_BUILD=true VERSION=$VERSION yarn nx build runner --configuration=production --nxBail=true

FROM docker:28.5.2-dind-alpine3.22 AS runner

ARG TARGETARCH
ARG JUICEFS_VERSION=1.4.1

RUN apk update && apk upgrade --no-cache openssl pcre2 \
  && apk add --no-cache curl rsync fuse3 libgcc libstdc++ libunwind util-linux \
  && JUICEFS_SHA256=$([ "$TARGETARCH" = "arm64" ] \
      && echo "1015ade83a7a93180a29f6c93ee5780a3eda52522331934ef2ef0cc0921995fd" \
      || echo "01ee09a21a9351a465e09906f113845e1c6a19bea70f530e5e2b2125b2dd3b82") \
  && wget -q "https://github.com/juicedata/juicefs/releases/download/v${JUICEFS_VERSION}/juicefs-${JUICEFS_VERSION}-linux-${TARGETARCH}.tar.gz" -O /tmp/juicefs.tar.gz \
  && echo "${JUICEFS_SHA256}  /tmp/juicefs.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/juicefs.tar.gz -C /usr/local/bin juicefs \
  && chmod +x /usr/local/bin/juicefs \
  && rm /tmp/juicefs.tar.gz

WORKDIR /usr/local/bin

COPY --from=build /daytona/dist/apps/runner daytona-runner
COPY --from=mount-s3-build /src/mountpoint-s3/target/release/mount-s3 mount-s3

RUN chmod +x daytona-runner mount-s3 \
  && mount-s3 --version \
  && juicefs version \
  && command -v mountpoint \
  && command -v umount

RUN mkdir -p /etc/docker && echo '{"insecure-registries": ["registry:6000"]}' > /etc/docker/daemon.json

HEALTHCHECK CMD [ "curl", "-f", "http://localhost:3003/" ]

ENTRYPOINT ["sh", "-c", "/usr/local/bin/dockerd-entrypoint.sh & daytona-runner"]
