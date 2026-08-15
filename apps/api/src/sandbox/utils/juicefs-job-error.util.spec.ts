/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { enrichJuiceFSJobError } from './juicefs-job-error.util'

describe('enrichJuiceFSJobError', () => {
  it('adds runner and region context to categorized JuiceFS errors', () => {
    expect(
      enrichJuiceFSJobError(
        'JUICEFS_BUCKET_UNREACHABLE: Runner cannot reach JuiceFS bucket endpoint minio:9000: connection refused',
        'cn-east',
        'runner-id',
      ),
    ).toBe(
      'Runner runner-id in region cn-east: JUICEFS_BUCKET_UNREACHABLE: Runner cannot reach JuiceFS bucket endpoint minio:9000: connection refused',
    )
  })

  it('does not alter unrelated job errors', () => {
    expect(enrichJuiceFSJobError('image pull failed', 'cn-east', 'runner-id')).toBe('image pull failed')
  })
})
