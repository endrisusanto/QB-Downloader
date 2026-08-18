#!/usr/bin/env node

/**
 * QuickBuild Resume / HTTP Range Diagnostic Probe
 * Tests whether QuickBuild server responds with HTTP 206 Partial Content,
 * inspects all response headers, and verifies byte-for-byte SHA256 integrity.
 *
 * Usage:
 *   node tools/test_resume.cjs <URL> <USERNAME> <TOKEN> [API_SUFFIX]
 * Or interactive:
 *   node tools/test_resume.cjs
 */

const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function fetchChunk(url, username, password, rangeHeader = null, maxBytes = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";
    const client = isHttps ? https : http;

    const headers = {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Connection: "keep-alive",
    };

    if (username && password) {
      const auth = Buffer.from(`${username}:${password}`).toString("base64");
      headers["Authorization"] = `Basic ${auth}`;
    }

    if (rangeHeader) {
      headers["Range"] = rangeHeader;
    }

    const options = {
      method: "GET",
      headers,
      rejectUnauthorized: false,
    };

    const req = client.request(parsedUrl, options, (res) => {
      // Handle redirects manually
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, url).toString();
        console.log(`  ↪ [Redirect ${res.statusCode}] -> ${nextUrl}`);
        res.resume(); // discard
        return fetchChunk(nextUrl, username, password, rangeHeader, maxBytes)
          .then(resolve)
          .catch(reject);
      }

      const chunks = [];
      let bytesReceived = 0;

      res.on("data", (chunk) => {
        if (maxBytes && bytesReceived + chunk.length > maxBytes) {
          const needed = maxBytes - bytesReceived;
          chunks.push(chunk.subarray(0, needed));
          bytesReceived += needed;
          req.destroy(); // stop streaming once we have enough test bytes
        } else {
          chunks.push(chunk);
          bytesReceived += chunk.length;
          if (maxBytes && bytesReceived >= maxBytes) {
            req.destroy();
          }
        }
      });

      res.on("close", () => {
        const body = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          headers: res.headers,
          data: body,
          bytesReceived: body.length,
        });
      });

      res.on("error", (err) => {
        // If aborted intentionally, return received bytes
        if (req.destroyed && bytesReceived > 0) {
          const body = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            headers: res.headers,
            data: body,
            bytesReceived: body.length,
          });
        } else {
          reject(err);
        }
      });
    });

    req.on("error", (err) => {
      if (req.destroyed) return;
      reject(err);
    });

    req.end();
  });
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

async function fetchJsonOrText(url, username, password) {
  const res = await fetchChunk(url, username, password, null, 1024 * 1024);
  return res.data.toString("utf8");
}

async function runTest() {
  console.log("=".repeat(70));
  console.log("   QuickBuild Resume & Range Header Diagnostic Probe");
  console.log("=".repeat(70));

  let [,, argUrl, argUser, argPass, argSuffix] = process.argv;

  let input = argUrl || (await prompt("Enter Artifact URL, Build ID, or Build Page URL: "));
  if (!input) {
    console.error("❌ Input is required.");
    process.exit(1);
  }

  let username = argUser || (await prompt("QuickBuild Username: "));
  let password = argPass || (await prompt("QuickBuild Password / Access Token: "));
  let suffix = argSuffix || "QDgil8FjqA27El7lpOaC3YACGlCzhR9yq4FV1gnyZC";

  let baseUrl = "https://android.qb.sec.samsung.net";
  let buildId = null;
  let artifactName = null;
  let testUrl = input;

  // Extract build ID if user entered build URL or raw ID
  const buildMatch = input.match(/(?:builds?|download|filelist|artifacts)\/([A-Za-z0-9._-]+)/i) || input.match(/^([0-9]{5,})$/);
  if (buildMatch) {
    buildId = buildMatch[1];
    if (input.startsWith("http://") || input.startsWith("https://")) {
      const u = new URL(input);
      baseUrl = `${u.protocol}//${u.host}`;
    }
  }

  if (input.includes("/download/") && !input.endsWith("/download/") && input.split("/download/")[1].includes("/")) {
    // User passed a direct artifact URL
    testUrl = input;
  } else if (buildId) {
    console.log(`\n🔍 Detected Build ID: ${buildId}`);
    console.log(`🌐 Fetching artifact list from QuickBuild REST API...`);
    
    let artifactList = [];
    for (const restPath of [`/rest/ads5/filelist/${buildId}`, `/rest/files/artifacts/${buildId}`]) {
      try {
        const text = await fetchJsonOrText(`${baseUrl}${restPath}`, username, password);
        const matches = [...text.matchAll(/([A-Za-z0-9._-]+\.(?:tar|tar\.md5|zip|bin|img|md5|apk))/gi)].map(m => m[1]);
        if (matches.length > 0) {
          artifactList = [...new Set(matches)];
          break;
        }
      } catch (err) {
        // ignore and try next
      }
    }

    if (artifactList.length > 0) {
      console.log(`📦 Found ${artifactList.length} artifacts:`, artifactList.slice(0, 3).join(", "));
      artifactName = artifactList[0];
    } else {
      artifactName = await prompt("Enter artifact filename to test (e.g. AP_xxx.tar.md5): ");
    }

    const sep = suffix ? `?${suffix.replace(/^[?&]/, "")}` : "";
    const candidates = [
      `${baseUrl}/rest/ads5/download/${buildId}?filename=${encodeURIComponent(artifactName)}${sep ? `&${suffix.replace(/^[?&]/, "")}` : ""}`,
      `${baseUrl}/download/${buildId}/${encodeURIComponent(artifactName)}${sep}`,
      `${baseUrl}/download/${buildId}/artifacts/${encodeURIComponent(artifactName)}${sep}`,
      `${baseUrl}/rest/ads5/download/${buildId}?filename=${encodeURIComponent(artifactName)}`,
      `${baseUrl}/download/${buildId}/${encodeURIComponent(artifactName)}`,
    ];

    console.log(`\n🔎 Probing download endpoints for ${artifactName}...`);
    let workingCandidate = null;

    for (const cand of candidates) {
      process.stdout.write(`  Testing: ${cand.length > 75 ? cand.slice(0, 75) + "..." : cand} `);
      try {
        const probeRes = await fetchChunk(cand, username, password, null, 1024);
        console.log(`[HTTP ${probeRes.statusCode} - ${probeRes.headers["content-type"] || "binary"}]`);
        if (probeRes.statusCode === 200 && !probeRes.headers["content-type"]?.includes("text/html")) {
          workingCandidate = cand;
          break;
        }
      } catch (err) {
        console.log(`[Error: ${err.message}]`);
      }
    }

    if (workingCandidate) {
      testUrl = workingCandidate;
      console.log(`\n✅ Selected Working Download URL: ${testUrl}`);
    } else {
      testUrl = candidates[0];
    }
  }

  console.log("\nTarget URL:", testUrl);
  console.log("Username:  ", username ? username : "(none)");
  console.log("Password:  ", password ? "********" : "(none)");

  // -------------------------------------------------------------
  // Step 1: Initial download (0 to 2MB)
  // -------------------------------------------------------------
  console.log("\n-------------------------------------------------------------");
  console.log("STEP 1: Requesting First Chunk (0 -> 2 MB) without Range header");
  console.log("-------------------------------------------------------------");

  const step1 = await fetchChunk(testUrl, username, password, null, CHUNK_SIZE);
  console.log(`HTTP Status:   ${step1.statusCode} ${step1.statusMessage}`);
  console.log(`Content-Type:  ${step1.headers["content-type"] || "N/A"}`);
  console.log(`Content-Length:${step1.headers["content-length"] || "N/A"} (${formatBytes(Number(step1.headers["content-length"]))})`);
  console.log(`Accept-Ranges: ${step1.headers["accept-ranges"] || "N/A"}`);
  console.log(`ETag:          ${step1.headers["etag"] || "N/A"}`);
  console.log(`Bytes read:    ${step1.data.length} bytes`);
  console.log(`SHA256 (0..2M):${sha256(step1.data)}`);

  if (step1.headers["content-type"]?.includes("text/html")) {
    console.error("\n⚠️ WARNING: Received HTML content instead of binary file!");
    console.error("👉 This usually means QuickBuild redirected to SSO login (sts.secsso.net).");
    console.error("👉 Make sure you are using a direct artifact download URL with the valid QD token suffix.");
  }

  if (step1.statusCode < 200 || step1.statusCode >= 300) {
    console.error(`\n❌ Failed with HTTP status ${step1.statusCode}. Check URL / credentials.`);
    process.exit(1);
  }

  // -------------------------------------------------------------
  // Step 2: Resume download with Range: bytes=2097152-
  // -------------------------------------------------------------
  console.log("\n-------------------------------------------------------------");
  console.log(`STEP 2: Simulating Resume with [Range: bytes=${CHUNK_SIZE}-]`);
  console.log("-------------------------------------------------------------");

  const rangeVal = `bytes=${CHUNK_SIZE}-`;
  const step2 = await fetchChunk(testUrl, username, password, rangeVal, CHUNK_SIZE);

  console.log(`HTTP Status:   ${step2.statusCode} ${step2.statusMessage}`);
  console.log(`Content-Range: ${step2.headers["content-range"] || "N/A"}`);
  console.log(`Accept-Ranges: ${step2.headers["accept-ranges"] || "N/A"}`);
  console.log(`Content-Length:${step2.headers["content-length"] || "N/A"}`);
  console.log(`Bytes read:    ${step2.data.length} bytes`);
  console.log(`SHA256 (2M..4M):${sha256(step2.data)}`);

  // Also test query parameter variants if Range was ignored
  if (step2.statusCode === 200 && sha256(step2.data) === sha256(step1.data)) {
    console.log("\n🔎 Probing query parameter seeking (?offset, ?start, ?range, ?bytes)...");
    for (const param of [`offset=${CHUNK_SIZE}`, `start=${CHUNK_SIZE}`, `range=${CHUNK_SIZE}-`, `from=${CHUNK_SIZE}`]) {
      const sepChar = testUrl.includes("?") ? "&" : "?";
      const qUrl = `${testUrl}${sepChar}${param}`;
      try {
        const qRes = await fetchChunk(qUrl, username, password, null, CHUNK_SIZE);
        const qHash = sha256(qRes.data);
        const isDifferent = qHash !== sha256(step1.data);
        console.log(`  Param [${param}]: HTTP ${qRes.statusCode}, Content-Length: ${qRes.headers["content-length"]}, Hash: ${qHash.slice(0, 16)}... ${isDifferent ? "🎉 OFFSET ACCEPTED!" : "(ignored, sent from 0)"}`);
      } catch (err) {
        console.log(`  Param [${param}]: ${err.message}`);
      }
    }
  }

  // -------------------------------------------------------------
  // Step 3: Reference 0 -> 4MB contiguous baseline
  // -------------------------------------------------------------
  console.log("\n-------------------------------------------------------------");
  console.log("STEP 3: Verifying Data Integrity Against 4 MB Reference Stream");
  console.log("-------------------------------------------------------------");

  const step3 = await fetchChunk(testUrl, username, password, null, CHUNK_SIZE * 2);
  const combinedResumed = Buffer.concat([step1.data, step2.data]);

  const hashResumed = sha256(combinedResumed);
  const hashReference = sha256(step3.data);

  console.log(`Resumed (Chunk 1 + Chunk 2) SHA256:   ${hashResumed}`);
  console.log(`Baseline Contiguous (0..4MB) SHA256: ${hashReference}`);

  console.log("\n" + "=".repeat(70));
  if (step2.statusCode === 206) {
    console.log("🎉 RESULT: HTTP 206 PARTIAL CONTENT CONFIRMED!");
    if (hashResumed === hashReference) {
      console.log("✅ INTEGRITY: 100% PERFECT MATCH! Byte alignment and resume work flawlessly.");
    } else {
      console.log("⚠️ WARNING: Status was 206, but byte hash differed. Check offset calculation.");
    }
  } else if (step2.statusCode === 200) {
    console.log("❌ RESULT: SERVER RETURNED HTTP 200 (IGNORED RANGE HEADER).");
    console.log("👉 The server ignores 'Range: bytes=...' for this specific URL pattern.");
  } else {
    console.log(`❌ RESULT: UNEXPECTED STATUS ${step2.statusCode} ${step2.statusMessage}`);
  }
  console.log("=".repeat(70) + "\n");
}

runTest().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
