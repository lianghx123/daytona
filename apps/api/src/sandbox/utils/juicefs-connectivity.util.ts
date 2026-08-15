/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { lookup as dnsLookup } from 'node:dns/promises'
import { connect as netConnect, Socket } from 'node:net'
import { BadRequestError } from '../../exceptions/bad-request.exception'

const DEFAULT_PROBE_TIMEOUT_MS = 5000

const DEFAULT_PORTS: Record<string, number> = {
  redis: 6379,
  rediss: 6379,
  postgres: 5432,
  postgresql: 5432,
  mysql: 3306,
  mariadb: 3306,
  tikv: 2379,
  etcd: 2379,
  http: 80,
  https: 443,
}

export type JuiceFSEndpointKind = 'metadata' | 'bucket'

export interface JuiceFSEndpoint {
  url: string
  hostname: string
  port: number
  displayAddress: string
}

interface ProbeDependencies {
  lookup: typeof dnsLookup
  connect: (options: { host: string; port: number }) => Socket
}

const defaultProbeDependencies: ProbeDependencies = {
  lookup: dnsLookup,
  connect: netConnect,
}

function endpointCode(kind: JuiceFSEndpointKind): string {
  return kind === 'metadata' ? 'JUICEFS_METADATA_UNREACHABLE' : 'JUICEFS_BUCKET_UNREACHABLE'
}

function endpointLabel(kind: JuiceFSEndpointKind): string {
  return kind === 'metadata' ? 'metadata' : 'bucket'
}

export function parseJuiceFSEndpoint(
  value: string | undefined,
  kind: JuiceFSEndpointKind,
  options: { optional?: boolean; rejectUserInfo?: boolean } = {},
): JuiceFSEndpoint | undefined {
  const trimmedValue = value?.trim()
  if (!trimmedValue) {
    if (options.optional) return undefined
    throw new BadRequestError(`JuiceFS ${kind === 'metadata' ? 'metaUrl' : 'bucket'} is required`)
  }

  let parsed: URL
  try {
    parsed = new URL(trimmedValue)
  } catch {
    throw new BadRequestError(
      `JuiceFS ${kind === 'metadata' ? 'metaUrl' : 'bucket'} must be an absolute URL with a scheme`,
    )
  }

  if (!parsed.protocol || parsed.protocol === ':' || !parsed.hostname) {
    throw new BadRequestError(
      `JuiceFS ${kind === 'metadata' ? 'metaUrl' : 'bucket'} must be an absolute URL with a valid host`,
    )
  }
  if (options.rejectUserInfo && (parsed.username || parsed.password)) {
    throw new BadRequestError(`JuiceFS ${endpointLabel(kind)} must not contain embedded credentials`)
  }
  if (!options.rejectUserInfo && parsed.password) {
    throw new BadRequestError('JuiceFS metaUrl must not contain a password; use backend.credential.metaPassword')
  }

  const scheme = parsed.protocol.slice(0, -1).toLowerCase()
  const port = parsed.port ? Number(parsed.port) : DEFAULT_PORTS[scheme]
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new BadRequestError(
      `JuiceFS ${endpointLabel(kind)} URL scheme '${scheme}' has no known default port; include an explicit port`,
    )
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  const displayHost = hostname.includes(':') ? `[${hostname}]` : hostname
  return {
    url: trimmedValue,
    hostname,
    port,
    displayAddress: `${displayHost}:${port}`,
  }
}

function safeProbeReason(error: unknown): string {
  if (!(error instanceof Error)) return 'connection failed'
  const nodeError = error as NodeJS.ErrnoException
  if (nodeError.code === 'ENOTFOUND' || nodeError.code === 'EAI_AGAIN') return 'DNS lookup failed'
  if (nodeError.code === 'ECONNREFUSED') return 'connection refused'
  if (nodeError.code === 'ETIMEDOUT') return 'connection timed out'
  if (nodeError.code === 'ENETUNREACH' || nodeError.code === 'EHOSTUNREACH') return 'network is unreachable'
  return nodeError.code ? `connection failed (${nodeError.code})` : 'connection failed'
}

export async function probeJuiceFSEndpoint(
  endpoint: JuiceFSEndpoint,
  kind: JuiceFSEndpointKind,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  dependencies: ProbeDependencies = defaultProbeDependencies,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  try {
    const remainingTimeout = () => Math.max(1, deadline - Date.now())
    await Promise.race([
      dependencies.lookup(endpoint.hostname),
      new Promise<never>((_, reject) => {
        const timeout = setTimeout(() => {
          const error = new Error('DNS lookup timed out') as NodeJS.ErrnoException
          error.code = 'ETIMEDOUT'
          reject(error)
        }, remainingTimeout())
        timeout.unref()
      }),
    ])

    await new Promise<void>((resolve, reject) => {
      const socket = dependencies.connect({ host: endpoint.hostname, port: endpoint.port })
      const finish = (error?: Error) => {
        socket.removeAllListeners()
        socket.destroy()
        if (error) reject(error)
        else resolve()
      }
      socket.setTimeout(remainingTimeout())
      socket.once('connect', () => finish())
      socket.once('timeout', () => {
        const error = new Error('Connection timed out') as NodeJS.ErrnoException
        error.code = 'ETIMEDOUT'
        finish(error)
      })
      socket.once('error', finish)
    })
  } catch (error) {
    throw new BadRequestError(
      `${endpointCode(kind)}: API cannot reach JuiceFS ${endpointLabel(kind)} endpoint ${endpoint.displayAddress}: ${safeProbeReason(error)}`,
    )
  }
}
