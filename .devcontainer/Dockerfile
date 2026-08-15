FROM buildpack-deps:jammy-curl

ARG TARGETARCH
ARG JUICEFS_VERSION=1.4.1

# common tools
RUN apt update && export DEBIAN_FRONTEND=noninteractive \
    && apt -y install --no-install-recommends apt-utils vim htop telnet socat expect-dev tini psmisc libgit2-dev \
    python3 python3-pip libx11-dev libxtst-dev libxext-dev libxrandr-dev libxinerama-dev libxi-dev \
    libx11-6 libxrandr2 libxext6 libxrender1 libxfixes3 libxss1 libxtst6 libxi6 \
    xvfb x11vnc novnc xfce4 xfce4-terminal dbus-x11 dnsmasq gettext-base

# build tools
RUN apt update && export DEBIAN_FRONTEND=noninteractive \
    && apt -y install --no-install-recommends protobuf-compiler libprotobuf-dev

# Mount-s3 (AWS S3 FUSE driver)
RUN /bin/bash -c 'apt update && export DEBIAN_FRONTEND=noninteractive \
    && apt -y install --no-install-recommends fuse libfuse2 \
    && MOUNT_S3_ARCH=$([ "$TARGETARCH" = "amd64" ] && echo "x86_64" || echo "arm64") \
    && wget https://s3.amazonaws.com/mountpoint-s3-release/1.20.0/${MOUNT_S3_ARCH}/mount-s3-1.20.0-${MOUNT_S3_ARCH}.deb \
    && apt install -y ./mount-s3-1.20.0-${MOUNT_S3_ARCH}.deb \
    && rm -f mount-s3-1.20.0-${MOUNT_S3_ARCH}.deb'

# JuiceFS Community client
RUN /bin/bash -c 'set -euo pipefail \
    && JUICEFS_ARCH=$([ "$TARGETARCH" = "amd64" ] && echo "amd64" || echo "arm64") \
    && JUICEFS_SHA256=$([ "$JUICEFS_ARCH" = "amd64" ] \
      && echo "01ee09a21a9351a465e09906f113845e1c6a19bea70f530e5e2b2125b2dd3b82" \
      || echo "1015ade83a7a93180a29f6c93ee5780a3eda52522331934ef2ef0cc0921995fd") \
    && wget -q "https://github.com/juicedata/juicefs/releases/download/v${JUICEFS_VERSION}/juicefs-${JUICEFS_VERSION}-linux-${JUICEFS_ARCH}.tar.gz" -O /tmp/juicefs.tar.gz \
    && echo "${JUICEFS_SHA256}  /tmp/juicefs.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/juicefs.tar.gz -C /usr/local/bin juicefs \
    && chmod +x /usr/local/bin/juicefs \
    && rm /tmp/juicefs.tar.gz'
# Telepresence
RUN curl -fL https://app.getambassador.io/download/tel2oss/releases/download/v2.17.0/telepresence-linux-${TARGETARCH} -o /usr/local/bin/telepresence && \
    chmod a+x /usr/local/bin/telepresence

RUN echo "address=/proxy.localhost/127.0.0.1" >> /etc/dnsmasq.conf

CMD ["sh", "-c", "service dnsmasq start && echo 'nameserver 127.0.0.1' > /etc/resolv.conf && tail -f /dev/null"]
