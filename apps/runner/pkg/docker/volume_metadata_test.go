// Copyright 2025 Daytona Platforms Inc.
// SPDX-License-Identifier: AGPL-3.0

package docker

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/daytonaio/runner/pkg/api/dto"
)

func TestMetadataWithVolumesNeverSerializesCredentials(t *testing.T) {
	volumes := []dto.VolumeDTO{{
		VolumeId:  "00000000-0000-0000-0000-000000000001",
		MountPath: "/data",
		Backend: &dto.VolumeBackendDTO{
			Type: dto.VolumeBackendJuiceFS,
			JuiceFS: &dto.JuiceFSVolumeSourceDTO{
				MetaURL:      "redis://metadata:6379/1",
				CacheSizeMiB: 10240,
			},
		},
	}}
	metadata := metadataWithVolumes(nil, volumes)
	serialized, err := json.Marshal(metadata)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(serialized), "META_PASSWORD") || strings.Contains(string(serialized), "secret") {
		t.Fatalf("metadata contains credentials: %s", serialized)
	}
}
