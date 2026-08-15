// Copyright 2025 Daytona Platforms Inc.
// SPDX-License-Identifier: AGPL-3.0

package dto

import "testing"

func TestVolumeBackendTypeDefaultsToManagedS3(t *testing.T) {
	if got := (VolumeDTO{}).BackendType(); got != VolumeBackendManagedS3 {
		t.Fatalf("expected legacy volume backend to default to %q, got %q", VolumeBackendManagedS3, got)
	}
}

func TestVolumeBackendTypeUsesExplicitBackend(t *testing.T) {
	volume := VolumeDTO{Backend: &VolumeBackendDTO{Type: VolumeBackendJuiceFS}}
	if got := volume.BackendType(); got != VolumeBackendJuiceFS {
		t.Fatalf("expected %q, got %q", VolumeBackendJuiceFS, got)
	}
}
