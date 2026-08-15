/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { EventEmitter } from 'node:events'
import { Socket } from 'node:net'
import { parseJuiceFSEndpoint, probeJuiceFSEndpoint } from './juicefs-connectivity.util'

describe('JuiceFS connectivity utilities', () => {
  it.each([
    ['redis://metadata/1', 6379],
    ['postgresql://metadata/database', 5432],
    ['mysql://metadata/database', 3306],
    ['tikv://metadata/cluster', 2379],
    ['https://storage.example.com/bucket', 443],
    ['custom://metadata:1234/cluster', 1234],
  ])('resolves the endpoint port for %s', (url, expectedPort) => {
    expect(parseJuiceFSEndpoint(url, 'metadata')?.port).toBe(expectedPort)
  })

  it('requires an explicit port for an unknown scheme', () => {
    expect(() => parseJuiceFSEndpoint('custom://metadata/cluster', 'metadata')).toThrow('include an explicit port')
  })

  it('accepts bucket paths and query parameters without exposing them in the display address', () => {
    const endpoint = parseJuiceFSEndpoint('https://storage.example.com:9443/bucket?tls-insecure=true', 'bucket', {
      rejectUserInfo: true,
    })
    expect(endpoint).toMatchObject({
      hostname: 'storage.example.com',
      port: 9443,
      displayAddress: 'storage.example.com:9443',
    })
    expect(endpoint?.displayAddress).not.toContain('bucket')
    expect(endpoint?.displayAddress).not.toContain('tls-insecure')
  })

  it('normalizes IPv6 hosts for DNS and display', () => {
    expect(parseJuiceFSEndpoint('redis://[2001:db8::1]:6379/1', 'metadata')).toMatchObject({
      hostname: '2001:db8::1',
      displayAddress: '[2001:db8::1]:6379',
    })
  })

  it('rejects embedded bucket credentials', () => {
    expect(() =>
      parseJuiceFSEndpoint('https://user:secret@storage.example.com/bucket', 'bucket', { rejectUserInfo: true }),
    ).toThrow('must not contain embedded credentials')
  })

  it('classifies DNS failures without including the full URL', async () => {
    const endpoint = parseJuiceFSEndpoint('redis://metadata.internal:6379/1?secret=value', 'metadata')!
    const dnsError = Object.assign(new Error('lookup metadata.internal failed'), { code: 'ENOTFOUND' })

    await expect(
      probeJuiceFSEndpoint(endpoint, 'metadata', 100, {
        lookup: jest.fn().mockRejectedValue(dnsError),
        connect: jest.fn(),
      }),
    ).rejects.toThrow(
      'JUICEFS_METADATA_UNREACHABLE: API cannot reach JuiceFS metadata endpoint metadata.internal:6379: DNS lookup failed',
    )
  })

  it('classifies connection refusal', async () => {
    const endpoint = parseJuiceFSEndpoint('https://storage.example.com/bucket', 'bucket', {
      rejectUserInfo: true,
    })!
    const socket = new EventEmitter() as Socket
    socket.setTimeout = jest.fn().mockReturnValue(socket)
    socket.removeAllListeners = jest.fn().mockReturnValue(socket)
    socket.destroy = jest.fn().mockReturnValue(socket)
    const connectionError = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })

    const result = probeJuiceFSEndpoint(endpoint, 'bucket', 100, {
      lookup: jest.fn().mockResolvedValue({ address: '127.0.0.1', family: 4 }),
      connect: jest.fn().mockImplementation(() => {
        queueMicrotask(() => socket.emit('error', connectionError))
        return socket
      }),
    })

    await expect(result).rejects.toThrow('JUICEFS_BUCKET_UNREACHABLE')
    await expect(result).rejects.toThrow('connection refused')
  })

  it('shares one timeout budget between DNS lookup and TCP connect', async () => {
    const endpoint = parseJuiceFSEndpoint('redis://metadata.internal/1', 'metadata')!
    const socket = new EventEmitter() as Socket
    socket.setTimeout = jest.fn().mockReturnValue(socket)
    socket.removeAllListeners = jest.fn().mockReturnValue(socket)
    socket.destroy = jest.fn().mockReturnValue(socket)

    const result = probeJuiceFSEndpoint(endpoint, 'metadata', 100, {
      lookup: jest.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ address: '127.0.0.1', family: 4 }), 60)),
      ),
      connect: jest.fn().mockImplementation(() => {
        queueMicrotask(() => socket.emit('connect'))
        return socket
      }),
    })

    await expect(result).resolves.toBeUndefined()
    expect(socket.setTimeout).toHaveBeenCalledWith(expect.any(Number))
    expect((socket.setTimeout as jest.Mock).mock.calls[0][0]).toBeLessThan(80)
  })
})
