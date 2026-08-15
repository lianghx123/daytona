/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

const JUICEFS_ERROR_PREFIXES = [
  'JUICEFS_RUNTIME_UNAVAILABLE:',
  'JUICEFS_METADATA_UNREACHABLE:',
  'JUICEFS_METADATA_INVALID_OR_UNAUTHORIZED:',
  'JUICEFS_BUCKET_UNREACHABLE:',
  'JUICEFS_MOUNT_FAILED:',
]

export function enrichJuiceFSJobError(
  errorMessage: string | null | undefined,
  regionId: string,
  runnerId: string,
): string | null | undefined {
  if (!errorMessage || !JUICEFS_ERROR_PREFIXES.some((prefix) => errorMessage.includes(prefix))) {
    return errorMessage
  }
  return `Runner ${runnerId} in region ${regionId}: ${errorMessage}`
}
