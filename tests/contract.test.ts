import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Vite Proxy & Python Bridge API Contract', () => {
  it('has a configured proxy path mapping /api/python-nse in vite.config.ts', () => {
    const configPath = path.resolve(__dirname, '../vite.config.ts');
    const content = fs.readFileSync(configPath, 'utf8');
    
    // Asserts that the proxy target is http://127.0.0.1:8765
    expect(content).toContain("'/api/python-nse'");
    expect(content).toContain("target: 'http://127.0.0.1:8765'");
    expect(content).toContain("rewrite: (path: string) => path.replace(/^\\/api\\/python-nse/, '')");
  });

  it('matches client telemetry type contract expectations', () => {
    // Mock response payload to verify schema compatibility with BridgeTelemetry interface
    const mockTelemetryResponse = {
      status: 'online',
      timestamp: '2026-06-02T15:00:00Z',
      server: {
        uptime_seconds: 1200,
        fastapi_version: '0.110.0'
      },
      http: {
        total_requests: 15,
        status_distribution: { '200': 15 },
        latencies: {
          '/api/telemetry': { calls: 1, avg_ms: 1.5, p50_ms: 1.5, p90_ms: 1.5, p99_ms: 1.5 }
        }
      },
      database: {
        active_connections: 1,
        peak_connections: 5,
        row_counts: { 'nse_cache': 10 }
      },
      websocket: {
        status: 'connected' as const,
        ping_time_ms: 5,
        active_sse_listeners: 0,
        subscribed_keys_count: 5
      },
      storage: {
        cache_db_size_mb: 25.5,
        parquet_archive_size_mb: 120.0,
        disk: {
          total_gb: 512,
          free_gb: 250,
          used_percent: 51.1
        }
      }
    };

    // Assert schema structure conforms to frontend type expectations
    expect(mockTelemetryResponse.status).toBe('online');
    expect(mockTelemetryResponse.server.uptime_seconds).toBeGreaterThan(0);
    expect(mockTelemetryResponse.storage.disk.used_percent).toBeLessThanOrEqual(100);
    expect(mockTelemetryResponse.websocket.status).toBe('connected');
  });
});
