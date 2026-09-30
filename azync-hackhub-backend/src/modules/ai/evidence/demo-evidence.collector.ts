import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { request as httpRequest, type IncomingMessage } from 'http';
import { request as httpsRequest } from 'https';
import type { EvidenceDraft } from './evidence.types';
import { resolveSafePublicUrl } from './safe-url.policy';
import { sha256, unavailableEvidence } from './evidence.utils';

class ProbeTimeoutError extends Error {
  constructor() {
    super('TIMEOUT');
  }
}

@Injectable()
export class DemoEvidenceCollector {
  constructor(private readonly config: ConfigService) {}

  async collect(demoUrl: string): Promise<EvidenceDraft> {
    const timeoutMs = Number(
      this.config.get('DEMO_PROBE_TIMEOUT_MS') ?? 10_000,
    );
    const maxBytes = Number(this.config.get('DEMO_PROBE_MAX_BYTES') ?? 256_000);
    const maxRedirects = Number(
      this.config.get('DEMO_PROBE_MAX_REDIRECTS') ?? 3,
    );
    const startedAt = Date.now();
    const deadlineAt = startedAt + timeoutMs;
    let currentUrl = demoUrl;
    let redirects = 0;

    try {
      while (true) {
        const resolved = await this.withDeadline(
          resolveSafePublicUrl(currentUrl),
          deadlineAt,
        );
        const safeUrl = resolved.url;
        const response = await this.requestPinned(
          safeUrl,
          resolved.addresses[0],
          this.remainingMs(deadlineAt),
        );

          if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400) {
            const location = response.headers.location;
            // There is no evidence body to retain for a redirect. Tear it
            // down before resolving and probing the next (independently
            // vetted) URL, rather than allowing a redirect body to trickle.
            response.destroy();
            if (!location || redirects >= maxRedirects)
              throw new Error('SSRF_BLOCKED');
            currentUrl = new URL(Array.isArray(location) ? location[0] : location, safeUrl).toString();
            redirects += 1;
            continue;
          }

          let observed = 0;
          let bodyTruncated = false;
          const hash = await this.consumeBody(
            response,
            maxBytes,
            deadlineAt,
            (bytes, truncated) => {
              observed = bytes;
              bodyTruncated = truncated;
            },
          );
          const statusCode = response.statusCode ?? 0;
          const reachable = statusCode >= 200 && statusCode < 300;
          const facts = {
            requestedUrl: demoUrl,
            finalUrl: safeUrl.toString(),
            redirectCount: redirects,
            statusCode,
            reachable,
            contentType: response.headers['content-type'] ?? null,
            contentLengthObserved: observed,
            responseTimeMs: Date.now() - startedAt,
            bodyTruncated,
            tlsUsed: safeUrl.protocol === 'https:',
          };
          const bucket = new Date();
          bucket.setMinutes(0, 0, 0);
          return {
            type: 'DEMO_URL',
            source: 'http_probe',
            status: 'VERIFIED',
            reference: demoUrl,
            sourceRevision: `${demoUrl}:${bucket.toISOString()}`,
            locator: { requestedUrl: demoUrl, finalUrl: safeUrl.toString() },
            facts,
            contentHash: hash,
            errorCode: bodyTruncated ? 'TRUNCATED' : null,
            expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
          };
      }
    } catch (error) {
      const code =
        error instanceof Error &&
        ['INVALID_REFERENCE', 'SSRF_BLOCKED', 'SOURCE_UNAVAILABLE'].includes(
          error.message,
        )
          ? error.message
          : error instanceof ProbeTimeoutError
            ? 'TIMEOUT'
            : 'SOURCE_UNAVAILABLE';
      const unavailable = unavailableEvidence(
        'DEMO_URL',
        'http_probe',
        demoUrl,
        code,
      );
      unavailable.expiresAt = new Date(Date.now() + 5 * 60 * 1_000);
      return unavailable;
    }
  }

  private async consumeBody(
    response: IncomingMessage,
    maxBytes: number,
    deadlineAt: number,
    completed: (bytes: number, truncated: boolean) => void,
  ): Promise<string | null> {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    const timer = setTimeout(
      () => response.destroy(new ProbeTimeoutError()),
      this.remainingMs(deadlineAt),
    );
    try {
      for await (const chunk of response) {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = maxBytes - total;
        if (value.byteLength > remaining) {
          if (remaining > 0) chunks.push(value.subarray(0, remaining));
          total = maxBytes;
          truncated = true;
          response.destroy();
          break;
        }
        chunks.push(value);
        total += value.byteLength;
      }
    } finally {
      clearTimeout(timer);
    }
    completed(total, truncated);
    return sha256(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
  }

  private requestPinned(
    url: URL,
    target: { address: string; family: 4 | 6 },
    timeoutMs: number,
  ): Promise<IncomingMessage> {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = request(
        {
          protocol: url.protocol,
          hostname: target.address,
          family: target.family,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          // Preserve the original authority for virtual hosts and HTTPS SNI,
          // while connecting only to the vetted DNS result above.
          headers: {
            host: url.host,
            'user-agent': 'Azync-Evidence-Collector/1.0',
            accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          },
          servername: url.hostname,
        },
        resolve,
      );
      // ClientRequest#setTimeout is an *idle* timeout: a peer can keep it
      // alive forever by dribbling bytes. This wall-clock timer covers the
      // entire connection/request phase; consumeBody separately uses the
      // same overall deadline for the response phase.
      const timer = setTimeout(
        () => req.destroy(new ProbeTimeoutError()),
        timeoutMs,
      );
      const clearTimer = () => clearTimeout(timer);
      req.once('response', (response) => {
        clearTimer();
        resolve(response);
      });
      req.once('error', (error) => {
        clearTimer();
        reject(error);
      });
      req.end();
    });
  }

  private remainingMs(deadlineAt: number): number {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new ProbeTimeoutError();
    return remaining;
  }

  private async withDeadline<T>(promise: Promise<T>, deadlineAt: number): Promise<T> {
    const timeoutMs = this.remainingMs(deadlineAt);
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new ProbeTimeoutError()), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
