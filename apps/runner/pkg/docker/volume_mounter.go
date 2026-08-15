// Copyright 2025 Daytona Platforms Inc.
// SPDX-License-Identifier: AGPL-3.0

package docker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/daytonaio/runner/pkg/api/dto"
)

type VolumeMounter interface {
	BackendType() string
	MountCommand(context.Context, dto.VolumeDTO, *dto.VolumeMountCredentialDTO, string) (*exec.Cmd, error)
}

type S3VolumeMounter struct{ docker *DockerClient }

func (m *S3VolumeMounter) BackendType() string { return dto.VolumeBackendManagedS3 }
func (m *S3VolumeMounter) MountCommand(ctx context.Context, volume dto.VolumeDTO, _ *dto.VolumeMountCredentialDTO, target string) (*exec.Cmd, error) {
	if _, err := exec.LookPath("mount-s3"); err != nil {
		return nil, fmt.Errorf("mount-s3 command is not installed: %w", err)
	}
	if _, err := os.Stat("/dev/fuse"); err != nil {
		return nil, fmt.Errorf("FUSE device /dev/fuse is not available: %w", err)
	}
	if endpoint := strings.TrimSpace(m.docker.awsEndpointUrl); endpoint != "" {
		parsedEndpoint, err := url.ParseRequestURI(endpoint)
		if err != nil || parsedEndpoint.Scheme == "" || parsedEndpoint.Host == "" {
			return nil, fmt.Errorf("AWS_ENDPOINT_URL must be an absolute URL with a valid host: %q", endpoint)
		}
	}
	return m.docker.getS3MountCmd(ctx, volumeMountPrefix+volume.VolumeId, target), nil
}

type JuiceFSVolumeMounter struct{ docker *DockerClient }

const juiceFSEndpointProbeTimeout = 5 * time.Second
const defaultJuiceFSCapacityGiB int64 = 50

func juiceFSCapacityGiB(config *dto.JuiceFSVolumeSourceDTO) int64 {
	if config == nil || config.CapacityGiB == 0 {
		return defaultJuiceFSCapacityGiB
	}
	return config.CapacityGiB
}

var juiceFSDefaultPorts = map[string]int{
	"redis": 6379, "rediss": 6379,
	"postgres": 5432, "postgresql": 5432,
	"mysql": 3306, "mariadb": 3306,
	"tikv": 2379, "etcd": 2379,
	"http": 80, "https": 443,
}

type juiceFSEndpoint struct {
	raw            string
	hostname       string
	port           int
	displayAddress string
}

type juiceFSStatus struct {
	Setting *struct {
		Bucket string `json:"Bucket"`
	} `json:"Setting"`
}

func (m *JuiceFSVolumeMounter) BackendType() string { return dto.VolumeBackendJuiceFS }
func (m *JuiceFSVolumeMounter) MountCommand(ctx context.Context, volume dto.VolumeDTO, credential *dto.VolumeMountCredentialDTO, target string) (*exec.Cmd, error) {
	if volume.Backend == nil || volume.Backend.JuiceFS == nil {
		return nil, fmt.Errorf("JUICEFS_RUNTIME_UNAVAILABLE: JuiceFS backend configuration is required")
	}
	if _, err := exec.LookPath("juicefs"); err != nil {
		return nil, fmt.Errorf("JUICEFS_RUNTIME_UNAVAILABLE: juicefs command is not installed: %w", err)
	}
	if _, err := os.Stat("/dev/fuse"); err != nil {
		return nil, fmt.Errorf("JUICEFS_RUNTIME_UNAVAILABLE: FUSE device /dev/fuse is not available: %w", err)
	}
	config := volume.Backend.JuiceFS
	if config.CacheSizeMiB < 0 {
		return nil, fmt.Errorf("JUICEFS_RUNTIME_UNAVAILABLE: JuiceFS cache size must be a non-negative integer")
	}
	if config.CapacityGiB < 0 {
		return nil, fmt.Errorf("JUICEFS_MOUNT_FAILED: JuiceFS capacity must be a positive integer")
	}
	metadataEndpoint, err := parseJuiceFSEndpoint("metadata", config.MetaURL, false)
	if err != nil {
		return nil, fmt.Errorf("JUICEFS_METADATA_UNREACHABLE: invalid metadata endpoint: %w", err)
	}
	var configuredBucketEndpoint *juiceFSEndpoint
	if strings.TrimSpace(config.Bucket) != "" {
		configuredBucketEndpoint, err = parseJuiceFSEndpoint("bucket", config.Bucket, true)
		if err != nil {
			return nil, fmt.Errorf("JUICEFS_BUCKET_UNREACHABLE: invalid bucket endpoint: %w", err)
		}
	}
	if err := probeJuiceFSEndpoint(ctx, "metadata", metadataEndpoint); err != nil {
		return nil, err
	}
	metadataBucket, err := inspectJuiceFSStatus(ctx, config, credential)
	if err != nil {
		return nil, err
	}
	effectiveBucketEndpoint := configuredBucketEndpoint
	if effectiveBucketEndpoint == nil && strings.TrimSpace(metadataBucket) != "" {
		effectiveBucketEndpoint, err = parseJuiceFSEndpoint("bucket", metadataBucket, true)
		if err != nil {
			return nil, fmt.Errorf("JUICEFS_BUCKET_UNREACHABLE: metadata returned an invalid bucket endpoint: %w", err)
		}
	}
	if effectiveBucketEndpoint != nil {
		if err := probeJuiceFSEndpoint(ctx, "bucket", effectiveBucketEndpoint); err != nil {
			return nil, err
		}
	}
	cacheDir := filepath.Join("/var/lib/daytona/juicefs-cache", volume.VolumeId)
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		return nil, fmt.Errorf("JUICEFS_RUNTIME_UNAVAILABLE: failed to create JuiceFS cache directory: %w", err)
	}
	return m.docker.getJuiceFSMountCmd(ctx, volume, credential, target), nil
}

func parseJuiceFSEndpoint(kind, value string, rejectUserInfo bool) (*juiceFSEndpoint, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, fmt.Errorf("JuiceFS %s is required", kind)
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.Hostname() == "" {
		return nil, fmt.Errorf("JuiceFS %s must be an absolute URL with a scheme and host", kind)
	}
	if rejectUserInfo && parsed.User != nil {
		return nil, fmt.Errorf("JuiceFS %s must not contain embedded credentials", kind)
	}
	if !rejectUserInfo && parsed.User != nil {
		if _, hasPassword := parsed.User.Password(); hasPassword {
			return nil, fmt.Errorf("JuiceFS metadata must not contain a password; use volume mount credentials")
		}
	}
	port := 0
	if parsed.Port() != "" {
		port, err = strconv.Atoi(parsed.Port())
		if err != nil || port <= 0 || port > 65535 {
			return nil, fmt.Errorf("JuiceFS %s has an invalid port", kind)
		}
	} else {
		port = juiceFSDefaultPorts[strings.ToLower(parsed.Scheme)]
		if port == 0 {
			return nil, fmt.Errorf("JuiceFS %s URL scheme %q has no known default port; include an explicit port", kind, parsed.Scheme)
		}
	}
	return &juiceFSEndpoint{
		raw:            value,
		hostname:       parsed.Hostname(),
		port:           port,
		displayAddress: net.JoinHostPort(parsed.Hostname(), strconv.Itoa(port)),
	}, nil
}

func probeJuiceFSEndpoint(ctx context.Context, kind string, endpoint *juiceFSEndpoint) error {
	probeCtx, cancel := context.WithTimeout(ctx, juiceFSEndpointProbeTimeout)
	defer cancel()
	connection, err := (&net.Dialer{}).DialContext(probeCtx, "tcp", endpoint.displayAddress)
	if err == nil {
		_ = connection.Close()
		return nil
	}
	return fmt.Errorf("JUICEFS_%s_UNREACHABLE: Runner cannot reach JuiceFS %s endpoint %s: %s", strings.ToUpper(kind), kind, endpoint.displayAddress, classifyJuiceFSNetworkError(err))
}

func classifyJuiceFSNetworkError(err error) string {
	var dnsError *net.DNSError
	if errors.As(err, &dnsError) {
		if dnsError.IsTimeout {
			return "DNS lookup timed out"
		}
		return "DNS lookup failed"
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, os.ErrDeadlineExceeded) {
		return "connection timed out"
	}
	if errors.Is(err, syscall.ECONNREFUSED) {
		return "connection refused"
	}
	if errors.Is(err, syscall.ENETUNREACH) || errors.Is(err, syscall.EHOSTUNREACH) {
		return "network is unreachable"
	}
	return "connection failed"
}

func inspectJuiceFSStatus(ctx context.Context, config *dto.JuiceFSVolumeSourceDTO, credential *dto.VolumeMountCredentialDTO) (string, error) {
	statusCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(statusCtx, "juicefs", "status", strings.TrimSpace(config.MetaURL))
	cmd.Env = os.Environ()
	if credential != nil && credential.JuiceFS != nil && credential.JuiceFS.MetaPassword != "" {
		cmd.Env = append(cmd.Env, "META_PASSWORD="+credential.JuiceFS.MetaPassword)
	}
	output, err := cmd.Output()
	if err != nil {
		details := ""
		if exitError, ok := err.(*exec.ExitError); ok {
			details = sanitizeJuiceFSError(string(exitError.Stderr), config, credential)
		}
		if statusCtx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("JUICEFS_METADATA_INVALID_OR_UNAUTHORIZED: juicefs status timed out")
		}
		if details != "" {
			return "", fmt.Errorf("JUICEFS_METADATA_INVALID_OR_UNAUTHORIZED: juicefs status failed: %s", details)
		}
		return "", fmt.Errorf("JUICEFS_METADATA_INVALID_OR_UNAUTHORIZED: juicefs status failed")
	}
	return parseJuiceFSStatus(output)
}

func parseJuiceFSStatus(output []byte) (string, error) {
	var status juiceFSStatus
	if err := json.Unmarshal(output, &status); err != nil {
		return "", fmt.Errorf("JUICEFS_METADATA_INVALID_OR_UNAUTHORIZED: juicefs status returned invalid JSON")
	}
	if status.Setting == nil {
		return "", fmt.Errorf("JUICEFS_METADATA_INVALID_OR_UNAUTHORIZED: juicefs status did not return filesystem settings")
	}
	return strings.TrimSpace(status.Setting.Bucket), nil
}

type VolumeMounterRegistry struct {
	mounters map[string]VolumeMounter
}

func newVolumeMounterRegistry(docker *DockerClient) *VolumeMounterRegistry {
	mounters := []VolumeMounter{
		&S3VolumeMounter{docker: docker},
		&JuiceFSVolumeMounter{docker: docker},
	}
	registry := &VolumeMounterRegistry{mounters: make(map[string]VolumeMounter, len(mounters))}
	for _, mounter := range mounters {
		registry.mounters[mounter.BackendType()] = mounter
	}
	return registry
}

func (r *VolumeMounterRegistry) Get(backendType string) (VolumeMounter, error) {
	mounter, ok := r.mounters[backendType]
	if !ok {
		return nil, fmt.Errorf("unsupported volume backend %q", backendType)
	}
	return mounter, nil
}
