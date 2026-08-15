// Copyright 2025 Daytona Platforms Inc.
// SPDX-License-Identifier: AGPL-3.0

package docker

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/daytonaio/runner/pkg/api/dto"
)

func TestJuiceFSMountCommandKeepsPasswordOutOfArguments(t *testing.T) {
	volume := dto.VolumeDTO{
		VolumeId: "00000000-0000-0000-0000-000000000001",
		Backend: &dto.VolumeBackendDTO{
			Type: dto.VolumeBackendJuiceFS,
			JuiceFS: &dto.JuiceFSVolumeSourceDTO{
				MetaURL:      "redis://metadata:6379/1",
				Bucket:       "https://minio.internal:9000/juicefs-data",
				CacheSizeMiB: 2048,
			},
		},
	}
	credential := &dto.VolumeMountCredentialDTO{
		JuiceFS: &dto.JuiceFSVolumeMountCredentialDTO{MetaPassword: "top-secret"},
	}

	cmd := (&DockerClient{}).getJuiceFSMountCmd(context.Background(), volume, credential, "/mnt/volume")
	wantArgs := []string{
		"juicefs", "mount", "-d",
		"--cache-dir", "/var/lib/daytona/juicefs-cache/00000000-0000-0000-0000-000000000001",
		"--cache-size", "2048",
		"--bucket", "https://minio.internal:9000/juicefs-data",
		"redis://metadata:6379/1", "/mnt/volume",
	}
	if !slices.Equal(cmd.Args, wantArgs) {
		t.Fatalf("unexpected JuiceFS arguments: %#v", cmd.Args)
	}
	if strings.Contains(strings.Join(cmd.Args, " "), "top-secret") {
		t.Fatal("metadata password was included in command arguments")
	}
	if !slices.Contains(cmd.Env, "META_PASSWORD=top-secret") {
		t.Fatal("metadata password was not provided through the child process environment")
	}
	for _, arg := range cmd.Args {
		if arg == "--file-mode" || arg == "--dir-mode" || arg == "--subdir" {
			t.Fatalf("JuiceFS command must not override POSIX permissions or use --subdir: %s", arg)
		}
	}
}

func TestS3MountCommandUsesExplicitPathStyleEndpoint(t *testing.T) {
	dockerClient := &DockerClient{
		awsEndpointUrl:     " http://minio:9000 ",
		awsAccessKeyId:     "minioadmin",
		awsSecretAccessKey: "minioadmin",
		awsRegion:          "us-east-1",
	}

	cmd := dockerClient.getS3MountCmd(
		context.Background(),
		"daytona-volume-00000000-0000-0000-0000-000000000001",
		"/tmp/daytona-volume-00000000-0000-0000-0000-000000000001",
	)
	wantArgs := []string{
		"mount-s3",
		"--allow-other",
		"--allow-delete",
		"--allow-overwrite",
		"--file-mode", "0666",
		"--dir-mode", "0777",
		"--endpoint-url", "http://minio:9000",
		"--force-path-style",
		"daytona-volume-00000000-0000-0000-0000-000000000001",
		"/tmp/daytona-volume-00000000-0000-0000-0000-000000000001",
	}
	if !slices.Equal(cmd.Args, wantArgs) {
		t.Fatalf("unexpected S3 mount arguments: %#v", cmd.Args)
	}
}

func TestValidateJuiceFSURLs(t *testing.T) {
	metadata, err := parseJuiceFSEndpoint("metadata", "redis://metadata/1", false)
	if err != nil {
		t.Fatalf("valid metadata URL was rejected: %v", err)
	}
	if metadata.port != 6379 {
		t.Fatalf("unexpected Redis default port: %d", metadata.port)
	}
	if _, err := parseJuiceFSEndpoint("bucket", "https://minio:9000/juicefs-data", true); err != nil {
		t.Fatalf("valid bucket URL was rejected: %v", err)
	}
	if _, err := parseJuiceFSEndpoint("bucket", "minio:9000/juicefs-data", true); err == nil {
		t.Fatal("relative bucket URL was accepted")
	}
	if _, err := parseJuiceFSEndpoint("bucket", "https://user:secret@minio:9000/juicefs-data", true); err == nil {
		t.Fatal("bucket URL containing credentials was accepted")
	}
	if _, err := parseJuiceFSEndpoint("metadata", "custom://metadata/cluster", false); err == nil {
		t.Fatal("unknown metadata scheme without a port was accepted")
	}
}

func TestSanitizeMountErrorRedactsMetadataPassword(t *testing.T) {
	credential := &dto.VolumeMountCredentialDTO{
		JuiceFS: &dto.JuiceFSVolumeMountCredentialDTO{MetaPassword: "top-secret"},
	}
	details := sanitizeMountError("connection failed with top-secret\nretry aborted", dto.VolumeDTO{}, credential)
	if strings.Contains(details, "top-secret") {
		t.Fatal("metadata password was included in mount error")
	}
	if details != "connection failed with [REDACTED] retry aborted" {
		t.Fatalf("unexpected sanitized error: %q", details)
	}
}

func TestParseJuiceFSStatusReturnsDefaultBucket(t *testing.T) {
	bucket, err := parseJuiceFSStatus([]byte(`{"Setting":{"Bucket":"https://minio.internal:9000/juicefs-data"},"Sessions":[],"Stat":{}}`))
	if err != nil {
		t.Fatalf("valid JuiceFS status was rejected: %v", err)
	}
	if bucket != "https://minio.internal:9000/juicefs-data" {
		t.Fatalf("unexpected bucket: %q", bucket)
	}
}

func TestSanitizeMountErrorRedactsURLPathAndQuery(t *testing.T) {
	volume := dto.VolumeDTO{Backend: &dto.VolumeBackendDTO{JuiceFS: &dto.JuiceFSVolumeSourceDTO{
		MetaURL: "redis://metadata:6379/1?token=secret",
		Bucket:  "https://minio.internal:9000/juicefs-data?signature=secret",
	}}}
	message := "failed redis://metadata:6379/1?token=secret and https://minio.internal:9000/juicefs-data?signature=secret"
	details := sanitizeMountError(message, volume, nil)
	if strings.Contains(details, "token=secret") || strings.Contains(details, "signature=secret") || strings.Contains(details, "juicefs-data") {
		t.Fatalf("sensitive URL components were included in mount error: %q", details)
	}
	if !strings.Contains(details, "metadata:6379") || !strings.Contains(details, "minio.internal:9000") {
		t.Fatalf("sanitized endpoints were not retained: %q", details)
	}
}
