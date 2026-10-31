// calibredb stderr patterns that classify a routed-command failure. Shared by app/write-policy.ts
// (refusal steer, transient retry) and domain/error-codes.ts (the #249 error code), so both agree.

// calibredb never prints "401" for an auth-enabled server, only the credentials prompt (#237)
export const WRITE_REFUSED_STDERR = /forbidden|unauthorized|\b401\b|\b403\b|username and password is required/i;

// Observed in the #233 probes (calibredb 9.x client, `--with-library http://localhost:8099/#lib`
// `set_metadata`; exit code 1 in every case; record: docs/dev/probes/233-transient-stderr.md):
//   stopped server        → "ConnectionRefusedError: [Errno 61] Connection refused" (CONFIRMED, real server)
//   killed mid-request    → "ConnectionResetError: [Errno 54] Connection reset by peer" (CONFIRMED, real server)
//   closed, no response   → "http.client.RemoteDisconnected: Remote end closed connection without response"
//                           (UNCONFIRMED — seen only with a fake server; matched defensively)
export const CONNECTION_STDERR = /connection refused|connection reset|remote end closed connection/i;

// A drop AFTER the request went out: the server may already have committed the write (#33 rule).
// `connection refused` is excluded — that request never reached the server.
export const DROPPED_MID_REQUEST_STDERR = /connection reset|remote end closed connection/i;
