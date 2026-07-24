ARG BUILD_FROM
FROM ${BUILD_FROM}

ARG S6_OVERLAY_VERSION=3.2.0.2

USER root

# postgresql16: bundled DB, kept on the 16.x line deliberately so
# scripts/backup/{backup.sh,restore.sh} (unmodified pg_dump/pg_restore
# custom-format dumps) stay version-matched - see docs/backup-restore.md.
# su-exec: drop from root to the postgres/nextjs users per s6 service.
# jq: parse HA's /data/options.json in cont-init.d without pulling in bashio.
RUN apk add --no-cache \
      curl \
      xz \
      jq \
      su-exec \
      postgresql16 \
      postgresql16-contrib \
  && curl -fsSL -o /tmp/s6-overlay-noarch.tar.xz \
       "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz" \
  && curl -fsSL -o /tmp/s6-overlay-x86_64.tar.xz \
       "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-x86_64.tar.xz" \
  && tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz \
  && tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz \
  && rm -rf /tmp/*.tar.xz /var/cache/apk/*

COPY rootfs /

# s6-overlay/execline binaries live under /command as symlinks looked up via
# PATH - HA's own ready-made base images set this already, but ours is built
# on top of the plain app image, so it has to be added explicitly or every
# execline-based helper (with-contenv, ifelse, ...) fails with "unable to
# exec": No such file or directory.
ENV PATH="/command:${PATH}"

ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2
ENV S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0

ENTRYPOINT ["/init"]
